/**
 * Split SQL text into statement spans separated by `;` outside of strings/comments/dollar-quotes.
 * Each range is [from, toExclusive) where toExclusive is the index of the semicolon terminator,
 * or end-of-string for the last fragment.
 */
export interface SqlStatementRange {
  from: number;
  /** Exclusive end: index of `;` that ends this statement, or `sql.length` if none. */
  toExclusive: number;
}

export function splitSqlStatements(sql: string): SqlStatementRange[] {
  const ranges: SqlStatementRange[] = [];
  const n = sql.length;
  let stmtStart = 0;
  let i = 0;

  while (i < n) {
    const c = sql[i];
    const next = sql[i + 1];

    if (c === '-' && next === '-') {
      i += 2;
      while (i < n && sql[i] !== '\n') {
        i += 1;
      }
      continue;
    }
    if (c === '/' && next === '*') {
      i += 2;
      while (i < n - 1 && !(sql[i] === '*' && sql[i + 1] === '/')) {
        i += 1;
      }
      i = Math.min(i + 2, n);
      continue;
    }
    if (c === "'") {
      i += 1;
      while (i < n) {
        if (sql[i] === "'") {
          if (sql[i + 1] === "'") {
            i += 2;
            continue;
          }
          i += 1;
          break;
        }
        i += 1;
      }
      continue;
    }
    if (c === '"') {
      i += 1;
      while (i < n) {
        if (sql[i] === '"') {
          if (sql[i + 1] === '"') {
            i += 2;
            continue;
          }
          i += 1;
          break;
        }
        i += 1;
      }
      continue;
    }
    if (c === '$') {
      const rest = sql.slice(i);
      const m = /^\$([A-Za-z0-9_]*)\$/.exec(rest);
      if (m) {
        const delim = m[0];
        i += delim.length;
        const end = sql.indexOf(delim, i);
        if (end === -1) {
          i = n;
        } else {
          i = end + delim.length;
        }
        continue;
      }
    }

    if (c === ';') {
      ranges.push({ from: stmtStart, toExclusive: i });
      stmtStart = i + 1;
      i += 1;
      continue;
    }
    i += 1;
  }

  ranges.push({ from: stmtStart, toExclusive: n });
  return ranges;
}

/** First index in [from, toExclusive) that is not whitespace, or toExclusive if none. */
function firstNonWhitespaceIndex(sql: string, from: number, toExclusive: number): number {
  let i = from;
  while (i < toExclusive && /\s/.test(sql[i])) {
    i += 1;
  }
  return i;
}

/**
 * Returns the trimmed SQL statement that contains `cursor` (0-based index in `sql`).
 * Semicolons inside strings/comments/dollar-quotes do not split statements.
 *
 * The caret **after** a terminating `;` (and any following whitespace before the next
 * non-whitespace token) still counts as part of that statement, so Run matches what
 * users expect on the last line of a multi-line query.
 */
export function getSqlStatementAtCursor(sql: string, cursor: number): string {
  const n = sql.length;
  const c = Math.max(0, Math.min(cursor, n));
  const ranges = splitSqlStatements(sql);
  if (ranges.length === 0) {
    return sql.trim();
  }

  // Partition [0, n] into half-open zones [low, high): statement k owns the zone
  // ending at the first non-whitespace of ranges[k+1], so gaps after `;` belong to k.
  let low = 0;
  let idx = ranges.length - 1;
  for (let k = 0; k < ranges.length; k += 1) {
    const high =
      k < ranges.length - 1
        ? firstNonWhitespaceIndex(sql, ranges[k + 1].from, ranges[k + 1].toExclusive)
        : n + 1;
    if (c >= low && c < high) {
      idx = k;
      break;
    }
    low = high;
  }

  let text = sql.slice(ranges[idx].from, ranges[idx].toExclusive).trim();
  if (!text) {
    for (let j = idx - 1; j >= 0; j -= 1) {
      const t = sql.slice(ranges[j].from, ranges[j].toExclusive).trim();
      if (t) {
        return t;
      }
    }
    for (let j = idx + 1; j < ranges.length; j += 1) {
      const t = sql.slice(ranges[j].from, ranges[j].toExclusive).trim();
      if (t) {
        return t;
      }
    }
    return sql.trim();
  }
  return text;
}
