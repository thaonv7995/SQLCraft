import { createGunzip } from 'node:zlib';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { Readable } from 'node:stream';
import type { SchemaSqlDialect } from '@sqlcraft/types';
import { buildDefinitionTables, parseSqlSchemaFromText } from '@sqlcraft/sql-dump-parser';
import type { Logger } from 'pino';
import { createMcCatObjectReadStream, uploadBufferToS3ViaMinio } from './docker';
import { mainDb } from './db';

type ScanStatus = 'queued' | 'running' | 'done' | 'failed';
type DdlSummary = ReturnType<typeof parseSqlSchemaFromText>;

function normalizeTableName(raw: string): string {
  const t = raw.trim().replace(/;$/, '');
  const last = t.split('.').at(-1) ?? t;
  const s = last.trim();
  if (s.startsWith('"') && s.endsWith('"')) return s.slice(1, -1).replace(/""/g, '"');
  if (s.startsWith('`') && s.endsWith('`')) return s.slice(1, -1);
  if (s.startsWith('[') && s.endsWith(']')) return s.slice(1, -1);
  return s;
}

function inferDialectFromBase(base: Record<string, unknown>): SchemaSqlDialect {
  const definition = base.definition as Record<string, unknown> | undefined;
  const metadata = definition?.metadata as Record<string, unknown> | undefined;
  const raw = String(base.inferredDialect ?? metadata?.inferredDialect ?? 'postgresql').trim().toLowerCase();
  if (raw === 'mysql' || raw === 'mariadb' || raw === 'sqlserver' || raw === 'sqlite') return raw;
  return 'postgresql';
}

function createSourceStream(stream: Readable, fileName: string): Readable {
  return /\.(gz|sql\.gz)$/i.test(fileName) ? stream.pipe(createGunzip()) : stream;
}

async function parseSchemaFromArtifactHead(params: {
  artifactUrl: string;
  fileName: string;
  maxBytes: number;
  base: Record<string, unknown>;
}): Promise<DdlSummary | null> {
  const stream = createMcCatObjectReadStream(params.artifactUrl);
  const source = createSourceStream(stream, params.fileName);
  const chunks: Buffer[] = [];
  let seen = 0;

  for await (const chunk of source) {
    const b = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    chunks.push(b);
    seen += b.length;
    if (seen >= params.maxBytes) {
      source.destroy();
      break;
    }
  }

  try {
    return parseSqlSchemaFromText(Buffer.concat(chunks).toString('utf8'), inferDialectFromBase(params.base));
  } catch {
    return null;
  }
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

        const copy = line.match(/^\s*COPY\s+([^\s(]+)(?:\s*\([^)]+\))?\s+FROM\s+stdin;\s*$/i);
        if (copy?.[1]) {
          this.inCopy = true;
          this.copyTable = normalizeTableName(copy[1]);
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

async function updateScan(scanId: string, patch: { status?: ScanStatus; progressBytes?: number; totalRows?: number; errorMessage?: string; touchHeartbeat?: boolean }) {
  // Always refresh `updated_at`. We also bump `last_heartbeat_at` for any
  // status change or when progress is being reported, so the stalled-scan
  // reconciler can rely on it as a true keep-alive signal.
  const sets: string[] = ['updated_at = now()'];
  const vals: unknown[] = [scanId];
  let idx = 2;
  const shouldTouchHeartbeat =
    patch.touchHeartbeat ??
    (patch.status === 'running' ||
      typeof patch.progressBytes === 'number' ||
      patch.status === undefined);
  if (shouldTouchHeartbeat) {
    sets.push('last_heartbeat_at = now()');
  }
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

function mergeSummaryWithRowCounts(summary: DdlSummary, rowCounts: Record<string, number>): DdlSummary {
  const totalRows = Object.values(rowCounts).reduce((sum, count) => sum + count, 0);
  return {
    ...summary,
    totalRows,
    tables: summary.tables.map((table) => ({
      ...table,
      rowCount: rowCounts[table.name] ?? 0,
    })),
  };
}

function readBaseSummary(base: Record<string, unknown>): DdlSummary | null {
  const tables = Array.isArray(base.tables) ? base.tables : null;
  if (!tables) return null;
  const definition = (base.definition as Record<string, unknown> | undefined) ?? {};
  const indexes = Array.isArray(definition.indexes) ? (definition.indexes as DdlSummary['indexes']) : [];
  return {
    totalTables: Number(base.totalTables ?? 0),
    totalRows: Number(base.totalRows ?? 0),
    columnCount: Number(base.columnCount ?? 0),
    detectedPrimaryKeys: Number(base.detectedPrimaryKeys ?? 0),
    detectedForeignKeys: Number(base.detectedForeignKeys ?? 0),
    databaseName: (base.databaseName as string | null | undefined) ?? null,
    schemaName: (base.schemaName as string | null | undefined) ?? null,
    tables: tables as DdlSummary['tables'],
    indexes,
  };
}

function buildFinalPatch(params: {
  base: Record<string, unknown>;
  summary: DdlSummary | null;
  input: { scanId: string; fileName: string; artifactUrl: string };
  rowCounts: Record<string, number>;
  artifactOnly: boolean;
}) {
  const { base, summary, input, rowCounts, artifactOnly } = params;
  const totalRows = Object.values(rowCounts).reduce((sum, count) => sum + count, 0);
  const definitionBase = (typeof base.definition === 'object' && base.definition ? (base.definition as Record<string, unknown>) : {});
  const metadataBase = (typeof (base as any).definition?.metadata === 'object' && (base as any).definition?.metadata
    ? ((base as any).definition.metadata as Record<string, unknown>)
    : {});
  const baseTables = Array.isArray(base.tables) ? (base.tables as Array<Record<string, unknown>>) : [];
  const inferredScale = totalRows > 0 ? ((base.inferredScale as unknown) ?? null) : null;

  const patch: Record<string, unknown> = {
    ...base,
    scanId: input.scanId,
    fileName: input.fileName,
    artifactUrl: input.artifactUrl,
    totalRows,
    rowCounts,
    inferredScale,
    totalTables: Number(summary?.totalTables ?? base.totalTables ?? 0),
    columnCount: Number(summary?.columnCount ?? base.columnCount ?? 0),
    detectedPrimaryKeys: Number(summary?.detectedPrimaryKeys ?? base.detectedPrimaryKeys ?? 0),
    detectedForeignKeys: Number(summary?.detectedForeignKeys ?? base.detectedForeignKeys ?? 0),
    databaseName: summary?.databaseName ?? (base.databaseName as string | null | undefined) ?? null,
    schemaName: summary?.schemaName ?? (base.schemaName as string | null | undefined) ?? null,
    tables: summary
      ? summary.tables.map((table) => ({
          name: table.name,
          rowCount: table.rowCount,
          columnCount: table.columnCount,
          columns: table.columns,
        }))
      : baseTables.map((t) => ({
          ...t,
          name: String(t.name ?? ''),
          rowCount: rowCounts[String(t.name ?? '')] ?? Number(t.rowCount ?? 0),
          columnCount: Number(t.columnCount ?? (Array.isArray(t.columns) ? t.columns.length : 0)),
          columns: Array.isArray(t.columns) ? t.columns : [],
        })),
    ...(artifactOnly ? { artifactOnly: true } : {}),
    definition: {
      ...definitionBase,
      tables: summary
        ? buildDefinitionTables(summary)
        : (Array.isArray((base as any).definition?.tables) ? (base as any).definition.tables : []),
      indexes: summary
        ? summary.indexes
        : (Array.isArray((base as any).definition?.indexes) ? (base as any).definition.indexes : []),
      metadata: {
        ...metadataBase,
        ...(artifactOnly ? { artifactOnly: true } : {}),
        totalRows,
        inferredScale,
        databaseName: summary?.databaseName ?? (metadataBase.databaseName as string | null | undefined) ?? null,
        schemaName: summary?.schemaName ?? (metadataBase.schemaName as string | null | undefined) ?? null,
        totalTables: Number(summary?.totalTables ?? metadataBase.totalTables ?? base.totalTables ?? 0),
        columnCount: Number(summary?.columnCount ?? metadataBase.columnCount ?? base.columnCount ?? 0),
        detectedPrimaryKeys: Number(summary?.detectedPrimaryKeys ?? metadataBase.detectedPrimaryKeys ?? base.detectedPrimaryKeys ?? 0),
        detectedForeignKeys: Number(summary?.detectedForeignKeys ?? metadataBase.detectedForeignKeys ?? base.detectedForeignKeys ?? 0),
      },
    },
  };

  if (!artifactOnly) {
    delete patch.artifactOnly;
    const metadata = ((patch.definition as Record<string, unknown>).metadata as Record<string, unknown> | undefined);
    if (metadata) delete metadata.artifactOnly;
  }

  return patch;
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
  const base = input.baseScanJson && typeof input.baseScanJson === 'object'
    ? (input.baseScanJson as Record<string, unknown>)
    : {};

  const workerSummary = await (async () => {
    if (artifactOnly) return null;

    const first = await parseSchemaFromArtifactHead({
      artifactUrl: input.artifactUrl,
      fileName: input.fileName,
      maxBytes: 64 * 1024 * 1024,
      base,
    }).catch(() => null);
    if (first?.totalTables) return first;

    const second = await parseSchemaFromArtifactHead({
      artifactUrl: input.artifactUrl,
      fileName: input.fileName,
      maxBytes: 192 * 1024 * 1024,
      base,
    }).catch(() => null);
    if (second?.totalTables) return second;

    return await parseSchemaFromArtifactHead({
      artifactUrl: input.artifactUrl,
      fileName: input.fileName,
      maxBytes: 256 * 1024 * 1024,
      base,
    }).catch(() => null);
  })();

  const baseStream: Readable = createMcCatObjectReadStream(input.artifactUrl);
  const rowCounter = new RowCountTransform();
  const source = createSourceStream(baseStream, input.fileName);

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

  try {
    const url = new URL(input.metadataUrl);
    const bucket = url.hostname;
    const objectKey = url.pathname.replace(/^\/+/, '');
    const baseSummary = artifactOnly ? null : readBaseSummary(base);
    const finalSummary = workerSummary
      ? mergeSummaryWithRowCounts(workerSummary, rowCounter.rowCounts)
      : baseSummary
        ? mergeSummaryWithRowCounts(baseSummary, rowCounter.rowCounts)
        : null;

    const patch = buildFinalPatch({
      base,
      summary: finalSummary,
      input: {
        scanId: input.scanId,
        fileName: input.fileName,
        artifactUrl: input.artifactUrl,
      },
      rowCounts: rowCounter.rowCounts,
      artifactOnly,
    });

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
