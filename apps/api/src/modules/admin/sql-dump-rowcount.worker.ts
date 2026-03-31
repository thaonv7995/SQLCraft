import { parentPort, workerData } from 'node:worker_threads';
import { createReadStream } from 'node:fs';

type WorkerInput = {
  filePath: string;
};

type WorkerOutput =
  | { ok: true; rowCounts: Record<string, number>; totalRows: number }
  | { ok: false; error: string };

function isCopyHeader(line: string): { tableRaw: string } | null {
  const m = line.match(/^\s*COPY\s+([^\s(]+)(?:\s*\([^)]+\))?\s+FROM\s+stdin;\s*$/i);
  if (!m?.[1]) return null;
  return { tableRaw: m[1] };
}

function normalizeTableName(raw: string): string {
  const t = raw.trim().replace(/;$/, '');
  // Keep only last qualified segment, strip common quotes.
  const last = t.split('.').at(-1) ?? t;
  const s = last.trim();
  if (s.startsWith('"') && s.endsWith('"')) return s.slice(1, -1).replace(/""/g, '"');
  if (s.startsWith('`') && s.endsWith('`')) return s.slice(1, -1);
  if (s.startsWith('[') && s.endsWith(']')) return s.slice(1, -1);
  return s;
}

function countInsertRowsFromValuesChunk(
  chunk: string,
  state: {
    inSingle: boolean;
    inDouble: boolean;
    depth: number;
    pending: string;
    tableName: string | null;
    seenValues: boolean;
    bufferSinceInsert: string;
  },
  rowCounts: Record<string, number>,
): { consumed: number; endedStatement: boolean } {
  // state.pending is carried across chunks to avoid missing tokens.
  let i = 0;
  let ended = false;
  const s = chunk;

  const bump = () => {
    const t = state.tableName;
    if (!t) return;
    rowCounts[t] = (rowCounts[t] ?? 0) + 1;
  };

  while (i < s.length) {
    const ch = s[i]!;

    if (ch === "'" && !state.inDouble) {
      if (state.inSingle && s[i + 1] === "'") {
        i += 2;
        continue;
      }
      state.inSingle = !state.inSingle;
      i += 1;
      continue;
    }
    if (ch === '"' && !state.inSingle) {
      if (state.inDouble && s[i + 1] === '"') {
        i += 2;
        continue;
      }
      state.inDouble = !state.inDouble;
      i += 1;
      continue;
    }

    if (!state.inSingle && !state.inDouble) {
      if (!state.seenValues) {
        // Look for VALUES keyword in a rolling window.
        state.pending = (state.pending + ch).slice(-12);
        if (/\bvalues\b/i.test(state.pending)) {
          state.seenValues = true;
          state.depth = 0;
        }
      } else {
        // Count top-level (...) groups after VALUES.
        if (ch === '(') {
          if (state.depth === 0) bump();
          state.depth += 1;
        } else if (ch === ')') {
          state.depth = Math.max(0, state.depth - 1);
        } else if (ch === ';' && state.depth === 0) {
          ended = true;
          i += 1;
          break;
        }
      }
    }

    i += 1;
  }

  return { consumed: i, endedStatement: ended };
}

async function scanRowCounts(filePath: string): Promise<{ rowCounts: Record<string, number>; totalRows: number }> {
  const rowCounts: Record<string, number> = {};
  let totalRows = 0;

  let carry = '';

  // COPY mode
  let inCopy = false;
  let copyTable: string | null = null;

  // INSERT mode
  let inInsert = false;
  const insertState = {
    inSingle: false,
    inDouble: false,
    depth: 0,
    pending: '',
    tableName: null as string | null,
    seenValues: false,
    bufferSinceInsert: '',
  };

  const stream = createReadStream(filePath, { encoding: 'utf8', highWaterMark: 1024 * 1024 });
  for await (const chunk of stream) {
    const text = carry + chunk;

    // Fast-path line mode for COPY detection/counting.
    // We still need to preserve data for INSERT parsing; so we process line-by-line and also feed insert scanner.
    const lines = text.split('\n');
    carry = lines.pop() ?? '';

    for (const rawLine of lines) {
      const line = rawLine.replace(/\r$/, '');

      if (inCopy) {
        if (line.trim() === '\\.') {
          inCopy = false;
          copyTable = null;
          continue;
        }
        if (line.length > 0) {
          const t = copyTable;
          if (t) {
            rowCounts[t] = (rowCounts[t] ?? 0) + 1;
            totalRows += 1;
          }
        }
        continue;
      }

      const copy = isCopyHeader(line);
      if (copy) {
        inCopy = true;
        copyTable = normalizeTableName(copy.tableRaw);
        continue;
      }

      // INSERT detection: only start when not already inside insert statement.
      if (!inInsert) {
        const m = line.match(/^\s*insert\s+(?:into\s+)?([^\s(]+)/i);
        if (m?.[1]) {
          inInsert = true;
          insertState.tableName = normalizeTableName(m[1]);
          insertState.seenValues = /\bvalues\b/i.test(line);
          insertState.pending = '';
          insertState.depth = 0;
          insertState.inSingle = false;
          insertState.inDouble = false;
        } else {
          continue;
        }
      }

      // Feed the insert row counter with this line + newline (to catch ';' end).
      const feed = line + '\n';
      const { endedStatement } = countInsertRowsFromValuesChunk(feed, insertState, rowCounts);
      if (endedStatement) {
        // Update totalRows for this statement by diffing rowCounts increase is expensive.
        // Instead accumulate from rowCounts afterwards: do per-statement delta by local counter.
        // We'll do a conservative recount: sum at end. (still OK for worker; rowCounts already correct)
        inInsert = false;
        insertState.tableName = null;
        insertState.seenValues = false;
        insertState.pending = '';
        insertState.depth = 0;
        insertState.inSingle = false;
        insertState.inDouble = false;
      }
    }
  }

  // Flush remaining carry for copy termination is irrelevant; insert ending may be missing ';' (rare) — ignore.
  totalRows = Object.values(rowCounts).reduce((sum, n) => sum + n, 0);
  return { rowCounts, totalRows };
}

async function main() {
  const input = workerData as WorkerInput;
  const out: WorkerOutput = await (async () => {
    try {
      const { rowCounts, totalRows } = await scanRowCounts(input.filePath);
      return { ok: true, rowCounts, totalRows };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { ok: false, error: msg };
    }
  })();
  parentPort?.postMessage(out);
}

void main();

