/**
 * Split MySQL/MariaDB SQL into individual statements while honouring `DELIMITER`
 * directives.
 *
 * `DELIMITER` is a client-side directive (recognised by the `mysql` CLI) that the
 * MySQL server itself does not understand. When user input contains:
 *
 *   DELIMITER $$
 *   CREATE PROCEDURE foo() BEGIN SELECT 1; END $$
 *   DELIMITER ;
 *
 * sending the whole blob to `mysql2.query()` raises `ER_PARSE_ERROR` (1064).
 * This helper strips the directives and returns the executable statements
 * separated by the active delimiter (`;` by default).
 *
 * Outside of strings (`'…'`, `"…"`, `` `…` ``) and comments (`-- …`, `# …`,
 * `/* … *​/`), the active delimiter terminates a statement. Backslash escapes
 * inside `'…'` / `"…"` follow MySQL's default behaviour. Identifier quoting
 * uses backticks; doubled `` `` `` `` `` `` is treated as a literal backtick.
 */

export interface MysqlStatement {
  /** Statement text without surrounding whitespace; never empty. */
  sql: string;
  /** Inclusive start offset in the original input. */
  from: number;
  /** Exclusive end offset (position of the terminating delimiter, or input length). */
  to: number;
}

/** Strip `DELIMITER` directives and return executable statements (trimmed, non-empty). */
export function splitMysqlStatementsWithDelimiter(input: string): MysqlStatement[] {
  const out: MysqlStatement[] = [];
  const n = input.length;
  let stmtStart = 0;
  let i = 0;
  let delim = ';';

  const pushStatement = (end: number) => {
    const raw = input.slice(stmtStart, end);
    const trimmed = raw.trim();
    if (trimmed) {
      out.push({ sql: trimmed, from: stmtStart, to: end });
    }
  };

  const onlyWhitespaceFromStmtStart = (idx: number): boolean => {
    for (let k = stmtStart; k < idx; k += 1) {
      const ch = input[k]!;
      if (ch !== ' ' && ch !== '\t' && ch !== '\r' && ch !== '\n') {
        return false;
      }
    }
    return true;
  };

  while (i < n) {
    const c = input[i];
    const next = input[i + 1];

    if (c === '-' && next === '-') {
      i += 2;
      while (i < n && input[i] !== '\n') i += 1;
      continue;
    }
    if (c === '#') {
      i += 1;
      while (i < n && input[i] !== '\n') i += 1;
      continue;
    }
    if (c === '/' && next === '*') {
      i += 2;
      while (i < n - 1 && !(input[i] === '*' && input[i + 1] === '/')) i += 1;
      i = Math.min(i + 2, n);
      continue;
    }

    if (c === "'" || c === '"') {
      const quote = c;
      i += 1;
      while (i < n) {
        const ch = input[i];
        if (ch === '\\' && i + 1 < n) {
          i += 2;
          continue;
        }
        if (ch === quote) {
          if (input[i + 1] === quote) {
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
        if (input[i] === '`') {
          if (input[i + 1] === '`') {
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

    if ((c === 'D' || c === 'd') && onlyWhitespaceFromStmtStart(i)) {
      const directive = matchDelimiterDirective(input, i);
      if (directive) {
        pushStatement(i);
        i = directive.endIndex;
        stmtStart = i;
        delim = directive.newDelimiter;
        continue;
      }
    }

    if (matchesAt(input, i, delim)) {
      pushStatement(i);
      i += delim.length;
      stmtStart = i;
      continue;
    }

    i += 1;
  }

  pushStatement(n);
  return out;
}

interface DelimiterDirectiveMatch {
  /** New delimiter (raw token, never empty). */
  newDelimiter: string;
  /** Index immediately after the directive (and the trailing newline if present). */
  endIndex: number;
}

/**
 * Match a MySQL `DELIMITER` directive at `idx`. The directive must occupy its own
 * logical line: `^\s*DELIMITER<spaces><token>[trailing spaces](newline | EOF)`.
 * Caller must pre-verify that `idx` is at the start of a logical statement
 * (only whitespace between the previous statement boundary and `idx`).
 */
function matchDelimiterDirective(input: string, idx: number): DelimiterDirectiveMatch | null {
  const KEYWORD = 'delimiter';
  if (input.length - idx < KEYWORD.length + 2) return null;
  for (let k = 0; k < KEYWORD.length; k += 1) {
    const ch = input[idx + k];
    if (!ch) return null;
    if (ch.toLowerCase() !== KEYWORD[k]) return null;
  }

  let j = idx + KEYWORD.length;
  if (j >= input.length) return null;
  const sep = input[j];
  if (sep !== ' ' && sep !== '\t') return null;
  while (j < input.length && (input[j] === ' ' || input[j] === '\t')) j += 1;

  const tokenStart = j;
  while (
    j < input.length &&
    input[j] !== ' ' &&
    input[j] !== '\t' &&
    input[j] !== '\r' &&
    input[j] !== '\n'
  ) {
    j += 1;
  }
  const token = input.slice(tokenStart, j);
  if (!token) return null;

  while (j < input.length && (input[j] === ' ' || input[j] === '\t')) j += 1;

  if (j < input.length && input[j] !== '\r' && input[j] !== '\n') {
    return null;
  }

  if (j < input.length && input[j] === '\r') j += 1;
  if (j < input.length && input[j] === '\n') j += 1;

  return { newDelimiter: token, endIndex: j };
}

function matchesAt(input: string, idx: number, needle: string): boolean {
  if (!needle) return false;
  if (idx + needle.length > input.length) return false;
  for (let k = 0; k < needle.length; k += 1) {
    if (input[idx + k] !== needle[k]) return false;
  }
  return true;
}

/**
 * True when `sql` contains a `DELIMITER` directive at the start of any logical
 * line. Used to short-circuit splitting when the input clearly already uses the
 * default `;` delimiter (avoid scanning a long batched query unnecessarily).
 */
export function hasMysqlDelimiterDirective(sql: string): boolean {
  return /(^|\n)[ \t]*delimiter[ \t]+\S/i.test(sql);
}
