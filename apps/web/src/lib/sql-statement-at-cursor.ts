/**
 * Split SQL text into statement spans separated by the active delimiter (`;` by default,
 * or whatever the most recent MySQL `DELIMITER` directive switched to) — outside of
 * strings, comments, and Postgres dollar-quoted strings.
 *
 * Each range is `[from, toExclusive)` where `toExclusive` is the index of the terminating
 * delimiter (or `sql.length` for the final fragment). MySQL `DELIMITER` directive lines
 * are treated as zero-content boundaries: they advance `from` of the following range and
 * do not appear in any returned range — so `Run statement at cursor` cleanly executes the
 * `CREATE PROCEDURE` body without the directive prefix.
 */
export interface SqlStatementRange {
  from: number;
  /** Exclusive end: index of the active delimiter that terminated this statement, or `sql.length`. */
  toExclusive: number;
}

export function splitSqlStatements(sql: string): SqlStatementRange[] {
  const ranges: SqlStatementRange[] = [];
  const n = sql.length;
  let stmtStart = 0;
  let i = 0;
  let delim = ';';
  /**
   * Once a MySQL `DELIMITER` directive is seen anywhere in the buffer we stop interpreting
   * `$tag$…$tag$` as Postgres dollar-quoted strings — `DELIMITER $$` switches the splitter,
   * not the lexer state, and we'd otherwise swallow the whole procedure body as one literal.
   */
  let mysqlDelimiterMode = false;

  const onlyWhitespaceFromStmtStart = (idx: number): boolean => {
    for (let k = stmtStart; k < idx; k += 1) {
      const ch = sql[k]!;
      if (ch !== ' ' && ch !== '\t' && ch !== '\r' && ch !== '\n') {
        return false;
      }
    }
    return true;
  };

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
    if (c === '`') {
      i += 1;
      while (i < n) {
        if (sql[i] === '`') {
          if (sql[i + 1] === '`') {
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
    if (c === '$' && !mysqlDelimiterMode) {
      const rest = sql.slice(i);
      const m = /^\$([A-Za-z0-9_]*)\$/.exec(rest);
      if (m) {
        const dq = m[0];
        i += dq.length;
        const end = sql.indexOf(dq, i);
        if (end === -1) {
          i = n;
        } else {
          i = end + dq.length;
        }
        continue;
      }
    }

    if ((c === 'D' || c === 'd') && onlyWhitespaceFromStmtStart(i)) {
      const directive = matchDelimiterDirective(sql, i);
      if (directive) {
        ranges.push({ from: stmtStart, toExclusive: i });
        stmtStart = directive.endIndex;
        i = directive.endIndex;
        delim = directive.newDelimiter;
        mysqlDelimiterMode = true;
        continue;
      }
    }

    if (matchesAt(sql, i, delim)) {
      ranges.push({ from: stmtStart, toExclusive: i });
      stmtStart = i + delim.length;
      i += delim.length;
      continue;
    }

    i += 1;
  }

  ranges.push({ from: stmtStart, toExclusive: n });
  return ranges;
}

interface DelimiterDirectiveMatch {
  newDelimiter: string;
  /** Index immediately after the directive (and the trailing newline if present). */
  endIndex: number;
}

/** Match `^\s*DELIMITER<spaces><token>[trailing spaces](newline | EOF)` at `idx`. */
function matchDelimiterDirective(sql: string, idx: number): DelimiterDirectiveMatch | null {
  const KEYWORD = 'delimiter';
  if (sql.length - idx < KEYWORD.length + 2) return null;
  for (let k = 0; k < KEYWORD.length; k += 1) {
    const ch = sql[idx + k];
    if (!ch) return null;
    if (ch.toLowerCase() !== KEYWORD[k]) return null;
  }

  let j = idx + KEYWORD.length;
  if (j >= sql.length) return null;
  const sep = sql[j];
  if (sep !== ' ' && sep !== '\t') return null;
  while (j < sql.length && (sql[j] === ' ' || sql[j] === '\t')) j += 1;

  const tokenStart = j;
  while (
    j < sql.length &&
    sql[j] !== ' ' &&
    sql[j] !== '\t' &&
    sql[j] !== '\r' &&
    sql[j] !== '\n'
  ) {
    j += 1;
  }
  const token = sql.slice(tokenStart, j);
  if (!token) return null;

  while (j < sql.length && (sql[j] === ' ' || sql[j] === '\t')) j += 1;

  if (j < sql.length && sql[j] !== '\r' && sql[j] !== '\n') {
    return null;
  }

  if (j < sql.length && sql[j] === '\r') j += 1;
  if (j < sql.length && sql[j] === '\n') j += 1;

  return { newDelimiter: token, endIndex: j };
}

function matchesAt(sql: string, idx: number, needle: string): boolean {
  if (!needle) return false;
  if (idx + needle.length > sql.length) return false;
  for (let k = 0; k < needle.length; k += 1) {
    if (sql[idx + k] !== needle[k]) return false;
  }
  return true;
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

  const text = sql.slice(ranges[idx].from, ranges[idx].toExclusive).trim();
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
