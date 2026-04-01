/**
 * Teaching dumps often use table names like `Order` or `User` without brackets.
 * Those are reserved keywords in T-SQL and break `sqlcmd` restore.
 */
const RESERVED_AS_OBJECT_NAME = 'Order|User';

function stripBom(sql: string): string {
  return sql.replace(/^\uFEFF/, '');
}

/** MySQL / mysqldump identifiers use backticks; T-SQL expects [] (or quoted). */
export function mysqlBackticksToBrackets(sql: string): string {
  return sql.replace(/`([^`]+)`/g, '[$1]');
}

/**
 * MySQL session lines that are invalid or noisy in SQL Server sqlcmd restores.
 */
export function stripMySqlSessionNoiseLines(sql: string): string {
  return sql
    .replace(/^\s*LOCK\s+TABLES\s+[^;]+;\s*$/gim, '')
    .replace(/^\s*UNLOCK\s+TABLES\s*;\s*$/gim, '')
    .replace(/^\s*SET\s+NAMES\s+[^;\r\n]+;?\s*$/gim, '')
    .replace(/^\s*SET\s+FOREIGN_KEY_CHECKS\s*=\s*\d+\s*;?\s*$/gim, '')
    .replace(/^\s*SET\s+UNIQUE_CHECKS\s*=\s*\d+\s*;?\s*$/gim, '')
    .replace(/^\s*SET\s+SQL_MODE\s*=\s*[^;\r\n]+;?\s*$/gim, '')
    .replace(/^\s*ALTER\s+TABLE\s+[^;\r\n]+DISABLE\s+KEYS\s*;\s*$/gim, '')
    .replace(/^\s*ALTER\s+TABLE\s+[^;\r\n]+ENABLE\s+KEYS\s*;\s*$/gim, '');
}

/**
 * US-style or day-first M/D/YY(YY) in VALUES — unquoted slashes are parsed as division in T‑SQL
 * (e.g. Msg 102 near '87' for 6/15/87). Quote as a single literal for implicit datetime conversion.
 */
export function tryRewriteUsStyleSlashDate(rest: string): { len: number; text: string } | null {
  const m = rest.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})(?=\s*(?:[,);]|$))/);
  if (!m) return null;
  const y = m[3];
  if (y.length !== 2 && y.length !== 4) return null;
  const a = +m[1];
  const b = +m[2];
  const usOk = a >= 1 && a <= 12 && b >= 1 && b <= 31;
  const dmOk = a >= 1 && a <= 31 && b >= 1 && b <= 12;
  if (!usOk && !dmOk) return null;
  return { len: m[0].length, text: `'${m[1]}/${m[2]}/${m[3]}'` };
}

/**
 * SQL Server rejects multiple CASCADE paths (Msg 1785). MySQL/Postgres dumps often use CASCADE;
 * for sandbox restore, NO ACTION is enough and avoids cycle errors.
 */
export function normalizeFkCascadeSingleLine(line: string): string {
  return line
    .replace(/\bON\s+DELETE\s+CASCADE\b/gi, 'ON DELETE NO ACTION')
    .replace(/\bON\s+UPDATE\s+CASCADE\b/gi, 'ON UPDATE NO ACTION');
}

export function normalizeSqlServerForeignKeyCascade(sql: string): string {
  let s = sql;
  s = s.replace(/\bON\s+DELETE\s*[\r\n]+\s*CASCADE\b/gi, 'ON DELETE NO ACTION');
  s = s.replace(/\bON\s+UPDATE\s*[\r\n]+\s*CASCADE\b/gi, 'ON UPDATE NO ACTION');
  return normalizeFkCascadeSingleLine(s);
}

function shouldDeferFkCascadeLine(line: string, mode: 'delete' | 'update'): boolean {
  if (/\bON\s+DELETE\s+CASCADE\b/i.test(line) || /\bON\s+UPDATE\s+CASCADE\b/i.test(line)) return false;
  if (/\bON\s+DELETE\s+NO\s+ACTION\b/i.test(line) || /\bON\s+UPDATE\s+NO\s+ACTION\b/i.test(line)) return false;
  if (mode === 'delete') return /\bON\s+DELETE\s*$/i.test(line.trimEnd());
  return /\bON\s+UPDATE\s*$/i.test(line.trimEnd());
}

/**
 * In plain T-SQL (outside '…' strings, `--` line comments, and C-style block comments):
 * - Quote unquoted **ISO** datetimes `YYYY-MM-DD` / `YYYY-MM-DD hh:mm:ss[.fff]` before `,` `)` `;`
 *   (otherwise parsed as subtraction, Msg 102 near a year digit).
 * - Quote unquoted **slash** datetimes `YYYY/MM/DD` / `YYYY/MM/DDThh:mm:ss[.fff]` (same time rules as ISO).
 * - Replace PostgreSQL-style **TRUE** / **FALSE** with **1** / **0** in value position (BIT-friendly).
 *
 * Dumps often split INSERT / VALUES across lines; this walks the full script once.
 */
export function quoteUnquotedIsoDatesOutsideStringsAndComments(sql: string): string {
  let out = '';
  let i = 0;
  let inString = false;
  let inLineComment = false;
  let inBlockComment = false;

  const tryRewritePlainLiteral = (pos: number): { len: number; text: string } | null => {
    const before = pos > 0 ? sql[pos - 1] : '';
    const prevOk = pos === 0 || /[\s(,]/.test(before);
    const notIdPart = !/[\w]/.test(before);
    if (!prevOk || !notIdPart) return null;

    const rest = sql.slice(pos);

    const iso = rest.match(
      /^(\d{4}-\d{1,2}-\d{1,2}(?:[T ]\d{2}:\d{2}:\d{2}(?:\.\d{1,7})?)?)(?=\s*(?:[,);]|$))/i,
    );
    if (iso) return { len: iso[1].length, text: `'${iso[1]}'` };

    const slash = rest.match(
      /^(\d{4}\/\d{1,2}\/\d{1,2}(?:[T ]\d{2}:\d{2}:\d{2}(?:\.\d{1,7})?)?)(?=\s*(?:[,);]|$))/i,
    );
    if (slash) return { len: slash[1].length, text: `'${slash[1]}'` };

    const usSlash = tryRewriteUsStyleSlashDate(rest);
    if (usSlash) return usSlash;

    const mysqlNull = rest.match(/^\\N(?=[\s,);]|$)/);
    if (mysqlNull) {
      const before = pos > 0 ? sql[pos - 1] : '';
      if (pos === 0 || /[\s,(]/.test(before)) {
        return { len: 2, text: 'NULL' };
      }
    }

    const bool = rest.match(/^(TRUE|FALSE)\b(?=\s*(?:[,);]|$))/i);
    if (bool) {
      const bit = bool[1].toUpperCase() === 'TRUE' ? '1' : '0';
      return { len: bool[0].length, text: bit };
    }

    return null;
  };

  while (i < sql.length) {
    const c = sql[i];
    const c2 = sql[i + 1];

    if (inLineComment) {
      out += c;
      if (c === '\n') {
        inLineComment = false;
      } else if (c === '\r') {
        if (c2 === '\n') {
          out += c2;
          i += 2;
          inLineComment = false;
          continue;
        }
        inLineComment = false;
      }
      i++;
      continue;
    }

    if (inBlockComment) {
      out += c;
      if (c === '*' && c2 === '/') {
        out += c2;
        i += 2;
        inBlockComment = false;
        continue;
      }
      i++;
      continue;
    }

    if (inString) {
      out += c;
      if (c === "'") {
        if (c2 === "'") {
          out += c2;
          i += 2;
          continue;
        }
        inString = false;
      }
      i++;
      continue;
    }

    if (c === "'") {
      inString = true;
      out += c;
      i++;
      continue;
    }
    if (c === '-' && c2 === '-') {
      inLineComment = true;
      out += '--';
      i += 2;
      continue;
    }
    if (c === '/' && c2 === '*') {
      inBlockComment = true;
      out += '/*';
      i += 2;
      continue;
    }

    const rw = tryRewritePlainLiteral(i);
    if (rw) {
      out += rw.text;
      i += rw.len;
      continue;
    }

    out += c;
    i++;
  }

  return out;
}

/**
 * Remove `USE otherdb` lines so `sqlcmd -d <sandboxDb>` keeps all batches in the sandbox database.
 * SSMS exports often start with `USE [MyCatalog];` which would create objects outside `s_*`.
 */
export function stripSqlServerUseStatements(sql: string): string {
  return sql.replace(
    /^\s*USE\s+(?:\[[^\]]*\]|[^\s;\r\n]+)(?:\s*;)?\s*(?:--[^\r\n]*)?\r?$/gim,
    '',
  );
}

/**
 * Scripts like InstPubs query `sysdatabases`, which only resolves when the session is in `master`.
 * After {@link stripSqlServerUseStatements}, batches run in the sandbox DB and `sys.databases`
 * is the portable catalog view (valid from any database).
 */
export function modernizeLegacySqlServerCatalogViews(sql: string): string {
  let s = sql.replace(/\bmaster\s*\.\s*dbo\s*\.\s*sysdatabases\b/gi, 'sys.databases');
  s = s.replace(/\bsys\s*\.\s*sysdatabases\b/gi, 'sys.databases');
  s = s.replace(/\bdbo\s*\.\s*sysdatabases\b/gi, 'sys.databases');
  s = s.replace(/\bsysdatabases\b/gi, 'sys.databases');
  return s;
}

/** InstPubs / legacy Pubs alias types (dbo schema). */
const INST_PUBS_DBO_TYPES_BOOTSTRAP = `/* SQLForge: ensure dbo.id / dbo.tid / dbo.empid before CREATE TABLE (InstPubs-style) */
IF TYPE_ID(N'id') IS NULL EXEC (N'CREATE TYPE [dbo].[id] FROM varchar(11) NOT NULL');
IF TYPE_ID(N'tid') IS NULL EXEC (N'CREATE TYPE [dbo].[tid] FROM varchar(6) NOT NULL');
IF TYPE_ID(N'empid') IS NULL EXEC (N'CREATE TYPE [dbo].[empid] FROM char(9) NOT NULL');
GO

`;

/**
 * Detect scripts that rely on legacy alias UDTs so we prepend a bootstrap batch.
 * Covers quoted/unquoted {@code sp_addtype} variants we strip, and common InstPubs column lines.
 */
export function needsInstPubsStyleAliasTypes(sql: string): boolean {
  if (/\bsp_addtype\b/i.test(sql)) return true;
  if (/\btitle_id\s+tid\b/i.test(sql)) return true;
  if (/\bau_id\s+id\b/i.test(sql)) return true;
  if (/\bemp_id\s+empid\b/i.test(sql)) return true;
  if (/\([^)]*\w+\s+tid\s*[\n\r,)]/i.test(sql)) return true;
  return false;
}

/**
 * Remove {@code EXEC/EXECUTE sp_addtype} lines so bootstrap (or prior types) are the single source of truth.
 * Matches unquoted names, bracketed names, and quoted / N-quoted names; flexible whitespace.
 */
export function stripSqlServerSpAddtypeStatements(sql: string): string {
  const line =
    /^\s*(?:execute|exec)\s+sp_addtype\s+(?:N?'([^']*)'|(\[[^\]]+\])|([A-Za-z_][\w]*))\s*,\s*N?'([^']*)'\s*,\s*N?'([^']*)'(?:\s*;)?\s*(?:--[^\r\n]*)?\s*$/gim;
  return sql.replace(line, '');
}

/**
 * Bracket common reserved identifiers when they appear as table/object names in typical DDL/DML.
 * Conservative: only `Order` and `User` (high-signal, low risk of touching keywords like GROUP BY).
 */
export function sanitizeSqlServerDumpScript(sql: string): string {
  let s = stripSqlServerUseStatements(stripBom(sql));
  s = mysqlBackticksToBrackets(s);
  s = stripMySqlSessionNoiseLines(s);
  if (needsInstPubsStyleAliasTypes(s)) {
    s = INST_PUBS_DBO_TYPES_BOOTSTRAP + s;
  }
  s = stripSqlServerSpAddtypeStatements(s);
  s = modernizeLegacySqlServerCatalogViews(s);
  const R = RESERVED_AS_OBJECT_NAME;

  s = s.replace(
    new RegExp(`\\bCREATE\\s+TABLE\\s+(?:(\\[dbo\\]\\.)|(dbo\\.))?(${R})\\b(\\s*\\()`, 'gi'),
    (_m, bracketedDbo, plainDbo, name, paren) => {
      const schema = bracketedDbo ?? plainDbo ?? '';
      return `CREATE TABLE ${schema}[${name}]${paren}`;
    },
  );

  s = s.replace(new RegExp(`\\bALTER\\s+TABLE\\s+(${R})\\b`, 'gi'), (_m, name) => `ALTER TABLE [${name}]`);

  s = s.replace(
    new RegExp(`\\bDROP\\s+TABLE\\s+(IF\\s+EXISTS\\s+)?(${R})\\b`, 'gi'),
    (_m, ifExists, name) => (ifExists ? `DROP TABLE IF EXISTS [${name}]` : `DROP TABLE [${name}]`),
  );

  s = s.replace(new RegExp(`\\bINSERT\\s+INTO\\s+(${R})\\b`, 'gi'), (_m, name) => `INSERT INTO [${name}]`);

  s = s.replace(
    new RegExp(`\\bREFERENCES\\s+(${R})\\b\\s*(\\()`, 'gi'),
    (_m, name, paren) => `REFERENCES [${name}]${paren}`,
  );

  s = s.replace(new RegExp(`\\bJOIN\\s+(${R})\\b(\\s+)`, 'gi'), (_m, name, sp) => `JOIN [${name}]${sp}`);

  s = s.replace(new RegExp(`\\bFROM\\s+(${R})\\b(\\s+)`, 'gi'), (_m, name, sp) => `FROM [${name}]${sp}`);

  s = s.replace(new RegExp(`\\bUPDATE\\s+(${R})\\b(\\s+)`, 'gi'), (_m, name, sp) => `UPDATE [${name}]${sp}`);

  s = s.replace(new RegExp(`\\bDELETE\\s+FROM\\s+(${R})\\b`, 'gi'), (_m, name) => `DELETE FROM [${name}]`);

  s = s.replace(new RegExp(`\\bTRUNCATE\\s+TABLE\\s+(${R})\\b`, 'gi'), (_m, name) => `TRUNCATE TABLE [${name}]`);

  s = quoteUnquotedIsoDatesOutsideStringsAndComments(s);

  s = normalizeSqlServerForeignKeyCascade(s);

  return s;
}

export function sanitizeSqlServerDumpPayload(input: string | Buffer): string | Buffer {
  const text = typeof input === 'string' ? input : input.toString('utf8');
  const out = sanitizeSqlServerDumpScript(text);
  return typeof input === 'string' ? out : Buffer.from(out, 'utf8');
}

// ─── Streaming Transform ───────────────────────────────────────────────────────

import { Transform, type TransformCallback } from 'node:stream';

/**
 * Apply all line-level sanitization passes to a single line.
 * This covers USE strip, backtick→bracket, MySQL noise strip, sp_addtype strip,
 * catalog view modernize, and reserved keyword bracketing.
 *
 * Returns `''` (empty string) for stripped lines to preserve blank-line positions
 * matching the buffer-based output.
 */
function sanitizeLineLevel(line: string): string {
  // Strip USE statements
  if (/^\s*USE\s+(?:\[[^\]]*\]|[^\s;\r\n]+)(?:\s*;)?\s*(?:--[^\r\n]*)?\s*$/i.test(line)) {
    return '';
  }

  // Strip MySQL session noise
  if (/^\s*LOCK\s+TABLES\s+/i.test(line) && /;\s*$/.test(line)) return '';
  if (/^\s*UNLOCK\s+TABLES\s*;\s*$/i.test(line)) return '';
  if (/^\s*SET\s+NAMES\s+/i.test(line) && /;?\s*$/.test(line)) return '';
  if (/^\s*SET\s+FOREIGN_KEY_CHECKS\s*=/i.test(line) && /;?\s*$/.test(line)) return '';
  if (/^\s*SET\s+UNIQUE_CHECKS\s*=/i.test(line) && /;?\s*$/.test(line)) return '';
  if (/^\s*SET\s+SQL_MODE\s*=/i.test(line) && /;?\s*$/.test(line)) return '';
  if (/^\s*ALTER\s+TABLE\s+/i.test(line) && /DISABLE\s+KEYS\s*;\s*$/i.test(line)) return '';
  if (/^\s*ALTER\s+TABLE\s+/i.test(line) && /ENABLE\s+KEYS\s*;\s*$/i.test(line)) return '';

  // Strip sp_addtype
  if (/^\s*(?:execute|exec)\s+sp_addtype\b/i.test(line)) return '';

  let s = line;

  // Strip MySQL integer display widths and UNSIGNED/ZEROFILL (invalid in T-SQL)
  // e.g. TINYINT(4) → TINYINT, INT(11) UNSIGNED → INT
  s = s.replace(/\b(TINYINT|SMALLINT|MEDIUMINT|INT|BIGINT)\s*\(\s*\d+\s*\)(\s+(?:UNSIGNED|ZEROFILL))+/gi, '$1');
  s = s.replace(/\b(TINYINT|SMALLINT|MEDIUMINT|INT|BIGINT)\s*\(\s*\d+\s*\)/gi, '$1');
  s = s.replace(/\b(TINYINT|SMALLINT|MEDIUMINT|INT|BIGINT)\b(\s+(?:UNSIGNED|ZEROFILL))+/gi, '$1');

  // MySQL backticks → brackets
  s = mysqlBackticksToBrackets(s);

  // Modernize legacy catalog views
  s = modernizeLegacySqlServerCatalogViews(s);

  // Bracket reserved identifiers (Order, User)
  const R = RESERVED_AS_OBJECT_NAME;
  s = s.replace(
    new RegExp(`\\bCREATE\\s+TABLE\\s+(?:(\\[dbo\\]\\.)|(dbo\\.))?(${R})\\b(\\s*\\()`, 'gi'),
    (_m, bracketedDbo, plainDbo, name, paren) => {
      const schema = bracketedDbo ?? plainDbo ?? '';
      return `CREATE TABLE ${schema}[${name}]${paren}`;
    },
  );
  s = s.replace(new RegExp(`\\bALTER\\s+TABLE\\s+(${R})\\b`, 'gi'), (_m, name) => `ALTER TABLE [${name}]`);
  s = s.replace(
    new RegExp(`\\bDROP\\s+TABLE\\s+(IF\\s+EXISTS\\s+)?(${R})\\b`, 'gi'),
    (_m, ifExists, name) => (ifExists ? `DROP TABLE IF EXISTS [${name}]` : `DROP TABLE [${name}]`),
  );
  s = s.replace(new RegExp(`\\bINSERT\\s+INTO\\s+(${R})\\b`, 'gi'), (_m, name) => `INSERT INTO [${name}]`);
  s = s.replace(
    new RegExp(`\\bREFERENCES\\s+(${R})\\b\\s*(\\()`, 'gi'),
    (_m, name, paren) => `REFERENCES [${name}]${paren}`,
  );
  s = s.replace(new RegExp(`\\bJOIN\\s+(${R})\\b(\\s+)`, 'gi'), (_m, name, sp) => `JOIN [${name}]${sp}`);
  s = s.replace(new RegExp(`\\bFROM\\s+(${R})\\b(\\s+)`, 'gi'), (_m, name, sp) => `FROM [${name}]${sp}`);
  s = s.replace(new RegExp(`\\bUPDATE\\s+(${R})\\b(\\s+)`, 'gi'), (_m, name, sp) => `UPDATE [${name}]${sp}`);
  s = s.replace(new RegExp(`\\bDELETE\\s+FROM\\s+(${R})\\b`, 'gi'), (_m, name) => `DELETE FROM [${name}]`);
  s = s.replace(new RegExp(`\\bTRUNCATE\\s+TABLE\\s+(${R})\\b`, 'gi'), (_m, name) => `TRUNCATE TABLE [${name}]`);

  s = normalizeFkCascadeSingleLine(s);

  return s;
}

/**
 * Character-by-character date quoting + TRUE/FALSE rewriting for a single line,
 * with string/comment state carried from previous lines.
 *
 * Returns the processed line and the updated state.
 */
function quoteDatesAndBoolsInLine(
  line: string,
  state: { inString: boolean; inBlockComment: boolean },
): { output: string; state: { inString: boolean; inBlockComment: boolean } } {
  let out = '';
  let { inString, inBlockComment } = state;
  let i = 0;

  const tryRewritePlainLiteral = (pos: number): { len: number; text: string } | null => {
    const before = pos > 0 ? line[pos - 1] : '';
    const prevOk = pos === 0 || /[\s(,]/.test(before);
    const notIdPart = !/[\w]/.test(before);
    if (!prevOk || !notIdPart) return null;

    const rest = line.slice(pos);

    // `$`: this line is the only context in streaming mode; `)` may be on the next line.
    const iso = rest.match(
      /^(\d{4}-\d{1,2}-\d{1,2}(?:[T ]\d{2}:\d{2}:\d{2}(?:\.\d{1,7})?)?)(?=\s*(?:[,);]|$))/i,
    );
    if (iso) return { len: iso[1].length, text: `'${iso[1]}'` };

    const slash = rest.match(
      /^(\d{4}\/\d{1,2}\/\d{1,2}(?:[T ]\d{2}:\d{2}:\d{2}(?:\.\d{1,7})?)?)(?=\s*(?:[,);]|$))/i,
    );
    if (slash) return { len: slash[1].length, text: `'${slash[1]}'` };

    const usSlash = tryRewriteUsStyleSlashDate(rest);
    if (usSlash) return usSlash;

    const mysqlNull = rest.match(/^\\N(?=[\s,);]|$)/);
    if (mysqlNull) {
      const before = pos > 0 ? line[pos - 1] : '';
      if (pos === 0 || /[\s,(]/.test(before)) {
        return { len: 2, text: 'NULL' };
      }
    }

    const bool = rest.match(/^(TRUE|FALSE)\b(?=\s*(?:[,);]|$))/i);
    if (bool) {
      const bit = bool[1].toUpperCase() === 'TRUE' ? '1' : '0';
      return { len: bool[0].length, text: bit };
    }

    return null;
  };

  while (i < line.length) {
    const c = line[i];
    const c2 = line[i + 1];

    if (inBlockComment) {
      out += c;
      if (c === '*' && c2 === '/') {
        out += c2;
        i += 2;
        inBlockComment = false;
        continue;
      }
      i++;
      continue;
    }

    if (inString) {
      out += c;
      if (c === "'") {
        if (c2 === "'") {
          out += c2;
          i += 2;
          continue;
        }
        inString = false;
      }
      i++;
      continue;
    }

    if (c === "'") {
      inString = true;
      out += c;
      i++;
      continue;
    }
    if (c === '-' && c2 === '-') {
      // Line comment — rest of line is comment, no state carry needed
      out += line.slice(i);
      i = line.length;
      continue;
    }
    if (c === '/' && c2 === '*') {
      inBlockComment = true;
      out += '/*';
      i += 2;
      continue;
    }

    const rw = tryRewritePlainLiteral(i);
    if (rw) {
      out += rw.text;
      i += rw.len;
      continue;
    }

    out += c;
    i++;
  }

  return { output: out, state: { inString, inBlockComment } };
}

/**
 * Streaming equivalent of `sanitizeSqlServerDumpScript`. Processes line-by-line
 * with carried state for string literals and block comments across chunk boundaries.
 */
export function createSqlServerSanitizeTransform(): Transform {
  let partialLine = '';
  let bomStripped = false;
  let bootstrapEmitted = false;
  let needsBootstrap = false;
  // Date quoting state machine carries across lines
  let dateState: { inString: boolean; inBlockComment: boolean } = {
    inString: false,
    inBlockComment: false,
  };

  let pendingFkCascade: { line: string; mode: 'delete' | 'update' } | null = null;

  function processLine(line: string): string {
    // Detect if bootstrap is needed (idempotent check per line, before stripping)
    if (!needsBootstrap && !bootstrapEmitted) {
      if (/\bsp_addtype\b/i.test(line) || /\btitle_id\s+tid\b/i.test(line) ||
          /\bau_id\s+id\b/i.test(line) || /\bemp_id\s+empid\b/i.test(line) ||
          /\([^)]*\w+\s+tid\s*[\n\r,)]/i.test(line)) {
        needsBootstrap = true;
      }
    }

    return sanitizeLineLevel(line);
  }

  function applyDateQuoting(line: string): string {
    const result = quoteDatesAndBoolsInLine(line, dateState);
    dateState = result.state;
    return result.output;
  }

  function emitProcessedLine(line: string, output: string[]) {
    if (needsBootstrap && !bootstrapEmitted) {
      output.push(INST_PUBS_DBO_TYPES_BOOTSTRAP.trimEnd());
      bootstrapEmitted = true;
    }
    output.push(applyDateQuoting(line));
  }

  function handleSanitizedLine(sanitized: string, output: string[]) {
    if (pendingFkCascade) {
      if (/^\s*CASCADE\b/i.test(sanitized)) {
        const re =
          pendingFkCascade.mode === 'delete' ? /\bON\s+DELETE\s*$/i : /\bON\s+UPDATE\s*$/i;
        const replacement =
          pendingFkCascade.mode === 'delete' ? 'ON DELETE NO ACTION' : 'ON UPDATE NO ACTION';
        const merged =
          pendingFkCascade.line.replace(re, replacement) + sanitized.replace(/^\s*CASCADE\b/i, '');
        pendingFkCascade = null;
        handleSanitizedLine(merged, output);
        return;
      }
      emitProcessedLine(pendingFkCascade.line, output);
      pendingFkCascade = null;
      handleSanitizedLine(sanitized, output);
      return;
    }

    if (shouldDeferFkCascadeLine(sanitized, 'delete')) {
      pendingFkCascade = { line: sanitized, mode: 'delete' };
      return;
    }
    if (shouldDeferFkCascadeLine(sanitized, 'update')) {
      pendingFkCascade = { line: sanitized, mode: 'update' };
      return;
    }
    emitProcessedLine(sanitized, output);
  }

  return new Transform({
    decodeStrings: true,

    transform(chunk: Buffer, _encoding: BufferEncoding, callback: TransformCallback) {
      let text = chunk.toString('utf8');

      if (!bomStripped) {
        text = stripBom(text);
        bomStripped = true;
      }

      text = partialLine + text;
      partialLine = '';

      const lines = text.split('\n');
      partialLine = lines.pop() ?? '';

      const output: string[] = [];

      for (const rawLine of lines) {
        handleSanitizedLine(processLine(rawLine), output);
      }

      if (output.length > 0) {
        this.push(output.join('\n') + '\n');
      }

      callback();
    },

    flush(callback: TransformCallback) {
      const remaining: string[] = [];

      if (partialLine) {
        handleSanitizedLine(processLine(partialLine), remaining);
        partialLine = '';
      }

      if (pendingFkCascade) {
        emitProcessedLine(pendingFkCascade.line, remaining);
        pendingFkCascade = null;
      } else if (needsBootstrap && !bootstrapEmitted) {
        remaining.push(INST_PUBS_DBO_TYPES_BOOTSTRAP.trimEnd());
        bootstrapEmitted = true;
      }

      if (remaining.length > 0) {
        this.push(remaining.join('\n'));
      }

      callback();
    },
  });
}
