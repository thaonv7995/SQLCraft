import { createGunzip } from 'node:zlib';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { Readable } from 'node:stream';
import type { Logger } from 'pino';
import { createMcCatObjectReadStream } from './docker';
import { uploadBufferToS3ViaMinio } from './docker';
import { mainDb } from './db';

type ScanStatus = 'queued' | 'running' | 'done' | 'failed';

type DdlSummary = {
  totalTables: number;
  columnCount: number;
  detectedPrimaryKeys: number;
  detectedForeignKeys: number;
  tables: Array<{ name: string; columnCount: number; detectedPrimaryKeys: number; detectedForeignKeys: number }>;
};

function normalizeTableName(raw: string): string {
  const t = raw.trim().replace(/;$/, '');
  const last = t.split('.').at(-1) ?? t;
  const s = last.trim();
  if (s.startsWith('"') && s.endsWith('"')) return s.slice(1, -1).replace(/""/g, '"');
  if (s.startsWith('`') && s.endsWith('`')) return s.slice(1, -1);
  if (s.startsWith('[') && s.endsWith(']')) return s.slice(1, -1);
  return s;
}

function isCopyHeader(line: string): { tableRaw: string } | null {
  const m = line.match(/^\s*COPY\s+([^\s(]+)(?:\s*\([^)]+\))?\s+FROM\s+stdin;\s*$/i);
  if (!m?.[1]) return null;
  return { tableRaw: m[1] };
}

class RowCountTransform extends Transform {
  private carry = '';
  private inCopy = false;
  private copyTable: string | null = null;
  private inInsert = false;
  private insertTable: string | null = null;
  private seenValues = false;
  private pending = '';
  private depth = 0;
  private inSingle = false;
  private inDouble = false;

  public rowCounts: Record<string, number> = {};
  public bytesSeen = 0;

  _transform(chunk: Buffer, _enc: BufferEncoding, cb: (err?: Error | null) => void) {
    try {
      const text = this.carry + chunk.toString('utf8');
      this.bytesSeen += chunk.length;
      const lines = text.split('\n');
      this.carry = lines.pop() ?? '';
      for (const rawLine of lines) {
        const line = rawLine.replace(/\r$/, '');

        if (this.inCopy) {
          if (line.trim() === '\\.') {
            this.inCopy = false;
            this.copyTable = null;
            continue;
          }
          if (line.length > 0 && this.copyTable) {
            const t = this.copyTable;
            this.rowCounts[t] = (this.rowCounts[t] ?? 0) + 1;
          }
          continue;
        }

        const copy = isCopyHeader(line);
        if (copy) {
          this.inCopy = true;
          this.copyTable = normalizeTableName(copy.tableRaw);
          continue;
        }

        if (!this.inInsert) {
          const m = line.match(/^\s*insert\s+(?:into\s+)?([^\s(]+)/i);
          if (!m?.[1]) continue;
          this.inInsert = true;
          this.insertTable = normalizeTableName(m[1]);
          this.seenValues = /\bvalues\b/i.test(line);
          this.pending = '';
          this.depth = 0;
          this.inSingle = false;
          this.inDouble = false;
        }

        this.scanInsertValues(line + '\n');
      }

      cb();
    } catch (e) {
      cb(e as Error);
    }
  }

  private bump() {
    const t = this.insertTable;
    if (!t) return;
    this.rowCounts[t] = (this.rowCounts[t] ?? 0) + 1;
  }

  private scanInsertValues(s: string) {
    for (let i = 0; i < s.length; i++) {
      const ch = s[i]!;

      if (ch === "'" && !this.inDouble) {
        if (this.inSingle && s[i + 1] === "'") {
          i += 1;
          continue;
        }
        this.inSingle = !this.inSingle;
        continue;
      }
      if (ch === '"' && !this.inSingle) {
        if (this.inDouble && s[i + 1] === '"') {
          i += 1;
          continue;
        }
        this.inDouble = !this.inDouble;
        continue;
      }

      if (this.inSingle || this.inDouble) continue;

      if (!this.seenValues) {
        this.pending = (this.pending + ch).slice(-12);
        if (/\bvalues\b/i.test(this.pending)) {
          this.seenValues = true;
          this.depth = 0;
        }
        continue;
      }

      if (ch === '(') {
        if (this.depth === 0) this.bump();
        this.depth += 1;
      } else if (ch === ')') {
        this.depth = Math.max(0, this.depth - 1);
      } else if (ch === ';' && this.depth === 0) {
        // end statement
        this.inInsert = false;
        this.insertTable = null;
        this.seenValues = false;
        this.pending = '';
        this.depth = 0;
        this.inSingle = false;
        this.inDouble = false;
        return;
      }
    }
  }
}

function countColumnsInCreateTableBody(body: string): { columns: number; pk: number; fk: number } {
  // Very lightweight heuristic:
  // - split top-level comma list within (...) and treat entries that start with identifier as columns
  // - pk: inline PRIMARY KEY or table constraint PRIMARY KEY
  // - fk: inline REFERENCES or FOREIGN KEY constraint
  const parts: string[] = [];
  let cur = '';
  let depth = 0;
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i]!;
    if (ch === "'" && !inDouble) {
      if (inSingle && body[i + 1] === "'") {
        cur += "''";
        i += 1;
        continue;
      }
      inSingle = !inSingle;
      cur += ch;
      continue;
    }
    if (ch === '"' && !inSingle) {
      if (inDouble && body[i + 1] === '"') {
        cur += '""';
        i += 1;
        continue;
      }
      inDouble = !inDouble;
      cur += ch;
      continue;
    }
    if (!inSingle && !inDouble) {
      if (ch === '(') depth += 1;
      if (ch === ')') depth = Math.max(0, depth - 1);
      if (ch === ',' && depth === 0) {
        const t = cur.trim();
        if (t) parts.push(t);
        cur = '';
        continue;
      }
    }
    cur += ch;
  }
  const last = cur.trim();
  if (last) parts.push(last);

  let cols = 0;
  let pk = 0;
  let fk = 0;

  for (const p of parts) {
    const t = p.trim();
    const lower = t.toLowerCase();
    const isConstraint =
      lower.startsWith('constraint ') ||
      lower.startsWith('primary key') ||
      lower.startsWith('foreign key') ||
      lower.startsWith('unique ') ||
      lower.startsWith('key ') ||
      lower.startsWith('index ');
    if (!isConstraint) {
      // likely a column definition
      cols += 1;
      if (/\bprimary\s+key\b/i.test(t)) pk += 1;
      if (/\breferences\b/i.test(t)) fk += 1;
      continue;
    }
    if (/\bprimary\s+key\b/i.test(t)) pk += 1;
    if (/\bforeign\s+key\b/i.test(t) || /\breferences\b/i.test(t)) fk += 1;
  }

  return { columns: cols, pk, fk };
}

async function ddlOnlyScanFromArtifactHead(params: {
  artifactUrl: string;
  fileName: string;
  maxBytes: number;
}): Promise<DdlSummary> {
  const { artifactUrl, fileName, maxBytes } = params;
  const base: DdlSummary = { totalTables: 0, columnCount: 0, detectedPrimaryKeys: 0, detectedForeignKeys: 0, tables: [] };

  // We only need a small head slice where DDL typically lives.
  const stream = createMcCatObjectReadStream(artifactUrl);
  const chunks: Buffer[] = [];
  let seen = 0;
  for await (const chunk of stream) {
    const b = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    chunks.push(b);
    seen += b.length;
    if (seen >= maxBytes) {
      stream.destroy();
      break;
    }
  }

  let text = Buffer.concat(chunks).toString('utf8');
  if (/\.(gz|sql\.gz)$/i.test(fileName)) {
    // If gzipped, ddl scan via head bytes is unreliable; skip DDL.
    return base;
  }
  // Scan CREATE TABLE statements quickly with regex.
  const re = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([^\s(]+)\s*\(([\s\S]*?)\)\s*;?/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const name = normalizeTableName(m[1] ?? '');
    const body = m[2] ?? '';
    const counts = countColumnsInCreateTableBody(body);
    base.totalTables += 1;
    base.columnCount += counts.columns;
    base.detectedPrimaryKeys += counts.pk;
    base.detectedForeignKeys += counts.fk;
    base.tables.push({
      name,
      columnCount: counts.columns,
      detectedPrimaryKeys: counts.pk,
      detectedForeignKeys: counts.fk,
    });
    if (base.totalTables >= 4000) break; // safety guard
  }
  return base;
}

async function updateScan(scanId: string, patch: { status?: ScanStatus; progressBytes?: number; totalRows?: number; errorMessage?: string }) {
  const sets: string[] = ['updated_at = now()'];
  const vals: unknown[] = [scanId];
  let idx = 2;
  if (patch.status) {
    sets.push(`status = $${idx++}`);
    vals.push(patch.status);
  }
  if (typeof patch.progressBytes === 'number') {
    sets.push(`progress_bytes = $${idx++}`);
    vals.push(patch.progressBytes);
  }
  if (typeof patch.totalRows === 'number') {
    sets.push(`total_rows = $${idx++}`);
    vals.push(patch.totalRows);
  }
  if (typeof patch.errorMessage === 'string') {
    sets.push(`error_message = $${idx++}`);
    vals.push(patch.errorMessage);
  }

  await mainDb.query(`UPDATE sql_dump_scans SET ${sets.join(', ')} WHERE id = $1`, vals);
}

export async function runSqlDumpScanJob(
  input: {
    scanId: string;
    artifactUrl: string;
    fileName: string;
    byteSize: number;
    metadataUrl: string;
    baseScanJson?: unknown;
    artifactOnly?: boolean;
  },
  log: Logger,
): Promise<{ rowCounts: Record<string, number>; totalRows: number }> {
  await updateScan(input.scanId, { status: 'running', progressBytes: 0 });

  const artifactOnly = Boolean(input.artifactOnly);
  const ddlSummary = artifactOnly
    ? null
    : await ddlOnlyScanFromArtifactHead({
        artifactUrl: input.artifactUrl,
        fileName: input.fileName,
        maxBytes: 64 * 1024 * 1024,
      }).catch(() => null);

  const baseStream: Readable = createMcCatObjectReadStream(input.artifactUrl);
  const rowCounter = new RowCountTransform();

  let source: Readable = baseStream;
  if (/\.(gz|sql\.gz)$/i.test(input.fileName)) {
    source = source.pipe(createGunzip());
  }

  // Update progress at most every ~1s
  let last = Date.now();
  const progressTimer = setInterval(() => {
    void updateScan(input.scanId, { progressBytes: rowCounter.bytesSeen }).catch(() => undefined);
  }, 1000);

  try {
    await pipeline(source, rowCounter);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await updateScan(input.scanId, {
      status: 'failed',
      progressBytes: rowCounter.bytesSeen,
      errorMessage: msg.slice(0, 2000),
    });
    throw e;
  } finally {
    clearInterval(progressTimer);
  }

  const totalRows = Object.values(rowCounter.rowCounts).reduce((s, n) => s + n, 0);
  await updateScan(input.scanId, { status: 'done', progressBytes: input.byteSize, totalRows });

  // Upload sidecar JSON (scan result) for API/UI to fetch later.
  try {
    const url = new URL(input.metadataUrl);
    const bucket = url.hostname;
    const objectKey = url.pathname.replace(/^\/+/, '');
    const base =
      input.baseScanJson && typeof input.baseScanJson === 'object'
        ? (input.baseScanJson as Record<string, unknown>)
        : {};

    const ddlTables = Array.isArray((ddlSummary as any)?.tables) ? ddlSummary!.tables : null;
    const tablesOut =
      ddlTables && ddlTables.length
        ? ddlTables.map((t) => {
            const rowCount = rowCounter.rowCounts[t.name] ?? 0;
            const columns = Array.from({ length: t.columnCount }, (_, idx) => {
              const i = idx + 1;
              return {
                name: `col_${i}`,
                type: '—',
                nullable: true,
                isPrimary: idx < t.detectedPrimaryKeys,
                isForeign: idx < t.detectedForeignKeys,
              };
            });
            return {
              name: t.name,
              rowCount,
              columnCount: t.columnCount,
              columns,
            };
          })
        : [];

    const patch = {
      ...base,
      scanId: input.scanId,
      fileName: input.fileName,
      artifactUrl: input.artifactUrl,
      totalRows,
      rowCounts: rowCounter.rowCounts,
      totalTables: ddlSummary?.totalTables ?? (base as any).totalTables ?? 0,
      columnCount: ddlSummary?.columnCount ?? (base as any).columnCount ?? 0,
      detectedPrimaryKeys: ddlSummary?.detectedPrimaryKeys ?? (base as any).detectedPrimaryKeys ?? 0,
      detectedForeignKeys: ddlSummary?.detectedForeignKeys ?? (base as any).detectedForeignKeys ?? 0,
      tables: tablesOut,
      artifactOnly,
      definition: {
        ...(typeof base.definition === 'object' && base.definition ? (base.definition as Record<string, unknown>) : {}),
        metadata: {
          ...((typeof (base as any).definition?.metadata === 'object' && (base as any).definition?.metadata
            ? (base as any).definition.metadata
            : {}) as Record<string, unknown>),
          totalRows,
          totalTables: Number(
            ddlSummary?.totalTables ??
              (base as any).definition?.metadata?.totalTables ??
              (base as any).totalTables ??
              0,
          ),
          columnCount: Number(
            ddlSummary?.columnCount ??
              (base as any).definition?.metadata?.columnCount ??
              (base as any).columnCount ??
              0,
          ),
          detectedPrimaryKeys: Number(
            ddlSummary?.detectedPrimaryKeys ??
              (base as any).definition?.metadata?.detectedPrimaryKeys ??
              (base as any).detectedPrimaryKeys ??
              0,
          ),
          detectedForeignKeys: Number(
            ddlSummary?.detectedForeignKeys ??
              (base as any).definition?.metadata?.detectedForeignKeys ??
              (base as any).detectedForeignKeys ??
              0,
          ),
        },
      },
    };
    await uploadBufferToS3ViaMinio({
      bucket,
      objectKey,
      body: Buffer.from(JSON.stringify(patch), 'utf8'),
    });
  } catch (e) {
    log.warn({ err: e, scanId: input.scanId }, 'Failed to upload sql-dump scan metadata JSON');
  }

  log.info({ scanId: input.scanId, totalRows, tables: Object.keys(rowCounter.rowCounts).length }, 'sql-dump scan done');

  return { rowCounts: rowCounter.rowCounts, totalRows };
}

