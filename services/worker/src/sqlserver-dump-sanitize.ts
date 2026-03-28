/**
 * Teaching dumps often use table names like `Order` or `User` without brackets.
 * Those are reserved keywords in T-SQL and break `sqlcmd` restore.
 */
const RESERVED_AS_OBJECT_NAME = 'Order|User';

function stripBom(sql: string): string {
  return sql.replace(/^\uFEFF/, '');
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

/**
 * Legacy samples (InstPubs, Northwind) call {@code sp_addtype} to define alias types ({@code id}, {@code tid}, …).
 * On modern SQL Server in Linux containers that path often does not materialize types before {@code CREATE TABLE},
 * producing "Cannot find data type tid". {@code CREATE TYPE ... FROM ...} is the supported replacement.
 *
 * Matches: {@code execute sp_addtype id ,'varchar(11)' ,'NOT NULL'} (flexible whitespace, optional trailing ;).
 */
export function expandSqlServerSpAddtypeToCreateType(sql: string): string {
  return sql.replace(
    /^\s*(?:execute|exec)\s+sp_addtype\s+(\[[^\]]+\]|[A-Za-z_][\w]*)\s*,\s*'([^']*)'\s*,\s*'([^']*)'(?:\s*;)?\s*(?:--[^\r\n]*)?\s*$/gim,
    (_m, rawTypeName: string, physType: string, nullClause: string) => {
      const name = rawTypeName.trim();
      const bracketed =
        name.startsWith('[') && name.endsWith(']') ? name : `[${name.replace(/^\[|\]$/g, '')}]`;
      const nn = /\bnot\s+null\b/i.test(nullClause ?? '') ? ' NOT NULL' : ' NULL';
      return `CREATE TYPE ${bracketed} FROM ${physType.trim()}${nn};`;
    },
  );
}

/**
 * Bracket common reserved identifiers when they appear as table/object names in typical DDL/DML.
 * Conservative: only `Order` and `User` (high-signal, low risk of touching keywords like GROUP BY).
 */
export function sanitizeSqlServerDumpScript(sql: string): string {
  let s = modernizeLegacySqlServerCatalogViews(
    expandSqlServerSpAddtypeToCreateType(stripSqlServerUseStatements(stripBom(sql))),
  );
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

  return s;
}

export function sanitizeSqlServerDumpPayload(input: string | Buffer): string | Buffer {
  const text = typeof input === 'string' ? input : input.toString('utf8');
  const out = sanitizeSqlServerDumpScript(text);
  return typeof input === 'string' ? out : Buffer.from(out, 'utf8');
}
