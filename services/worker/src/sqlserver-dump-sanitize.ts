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
    .replace(/^\s*SET\s+SQL_MODE\s*=\s*[^;\r\n]+;?\s*$/gim, '');
}

/**
 * Unquoted ISO dates/datetimes in INSERT ... VALUES are parsed as integer subtraction in T-SQL
 * (e.g. 2024-06-01 → 2024 - 06 - 01), yielding Msg 102 "Incorrect syntax near '4'" on the year digit.
 *
 * Dumps often split INSERT / VALUES / row across lines; the date may appear on line 9 with no
 * "INSERT" on that line, so a line-only rewriter misses it. This pass walks the full script,
 * skips single-quoted strings and SQL comments, and quotes bare YYYY-MM-DD / datetime only in
 * plain text (typically VALUES tuples).
 */
export function quoteUnquotedIsoDatesOutsideStringsAndComments(sql: string): string {
  const iso =
    /^(\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}:\d{2}(?:\.\d{1,7})?)?)(?=\s*[,);])/i;
  let out = '';
  let i = 0;
  let inString = false;
  let inLineComment = false;
  let inBlockComment = false;

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

    const rest = sql.slice(i);
    const m = rest.match(iso);
    if (m && m.index === 0) {
      const before = i > 0 ? sql[i - 1] : '';
      const prevOk = i === 0 || /[\s(,]/.test(before);
      const notIdPart = !/[\w]/.test(before);
      if (prevOk && notIdPart) {
        out += `'${m[1]}'`;
        i += m[1].length;
        continue;
      }
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

  return s;
}

export function sanitizeSqlServerDumpPayload(input: string | Buffer): string | Buffer {
  const text = typeof input === 'string' ? input : input.toString('utf8');
  const out = sanitizeSqlServerDumpScript(text);
  return typeof input === 'string' ? out : Buffer.from(out, 'utf8');
}
