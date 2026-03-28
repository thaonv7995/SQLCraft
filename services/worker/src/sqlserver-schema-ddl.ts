function stripInlinePrimaryKey(type: string): string {
  return type.replace(/\bPRIMARY\s+KEY\b/gi, '').replace(/\s{2,}/g, ' ').trim();
}

/**
 * Map PostgreSQL-oriented (or bad-import) type strings to T-SQL so template DDL runs on SQL Server.
 * Pass-through when the string already looks like SQL Server types.
 */
export function normalizeSqlServerColumnType(raw: string): string {
  const t = raw.replace(/\s{2,}/g, ' ').trim();
  if (!t) return 'NVARCHAR(MAX)';

  if (/^id$/i.test(t)) {
    return 'INT';
  }
  // Bad imports use the column name as the type, e.g. "id NOT NULL PRIMARY KEY"
  if (/^id\b(?=\s)/i.test(t)) {
    return t.replace(/^id\b/i, 'INT');
  }

  const pgPrefixes: Array<{ re: RegExp; repl: string }> = [
    { re: /^SERIAL\b/i, repl: 'INT IDENTITY(1,1)' },
    { re: /^BIGSERIAL\b/i, repl: 'BIGINT IDENTITY(1,1)' },
    { re: /^SMALLSERIAL\b/i, repl: 'SMALLINT IDENTITY(1,1)' },
    { re: /^TEXT\b/i, repl: 'NVARCHAR(MAX)' },
    { re: /^UUID\b/i, repl: 'UNIQUEIDENTIFIER' },
    { re: /^BOOLEAN\b/i, repl: 'BIT' },
    { re: /^BOOL\b/i, repl: 'BIT' },
    { re: /^JSONB?\b/i, repl: 'NVARCHAR(MAX)' },
    { re: /^INTEGER\b/i, repl: 'INT' },
    { re: /^INT4\b/i, repl: 'INT' },
    { re: /^INT8\b/i, repl: 'BIGINT' },
    { re: /^INT2\b/i, repl: 'SMALLINT' },
    { re: /^FLOAT8\b/i, repl: 'FLOAT' },
    { re: /^FLOAT4\b/i, repl: 'REAL' },
    { re: /^DOUBLE\s+PRECISION\b/i, repl: 'FLOAT' },
    { re: /^TIMESTAMP\s+WITH\s+TIME\s+ZONE\b/i, repl: 'DATETIMEOFFSET' },
    { re: /^TIMESTAMP\s+WITHOUT\s+TIME\s+ZONE\b/i, repl: 'DATETIME2' },
    { re: /^TIMESTAMPTZ\b/i, repl: 'DATETIMEOFFSET' },
    { re: /^TIMESTAMP\b/i, repl: 'DATETIME2' },
    { re: /^DATE\b/i, repl: 'DATE' },
  ];

  for (const { re, repl } of pgPrefixes) {
    if (re.test(t)) {
      return t.replace(re, repl);
    }
  }

  if (/^CHARACTER\s+VARYING\b/i.test(t)) {
    return t.replace(/^CHARACTER\s+VARYING(\(\s*\d+\s*\))?/i, (_, len: string | undefined) =>
      len ? `NVARCHAR${len}` : 'NVARCHAR(MAX)',
    );
  }

  if (/^VARCHAR\b(?!\s*\()/i.test(t)) {
    return t.replace(/^VARCHAR\b/i, 'NVARCHAR(MAX)');
  }

  return t;
}

function bracketIdent(name: string): string {
  return `[${name.replace(/\]/g, ']]')}]`;
}

function escapeNString(value: string): string {
  return value.replace(/'/g, "''");
}

export type SqlServerDdlTable = {
  name: string;
  columns: Array<{ name: string; type: string }>;
};

/**
 * Builds T-SQL batches (sqlcmd GO-separated) to create dbo tables from catalog
 * definitions when artifact restore did not materialize objects (idempotent).
 */
export function buildCreateTableDdlSqlServer(tables: SqlServerDdlTable[]): string {
  const batches: string[] = [];
  for (const table of tables) {
    const primaryKeyColumns = table.columns
      .filter((column) => /\bPRIMARY\s+KEY\b/i.test(column.type))
      .map((column) => column.name);

    const columnDefinitions = table.columns.map((column) => {
      const stripped =
        primaryKeyColumns.length > 0 ? stripInlinePrimaryKey(column.type) : column.type;
      const normalizedType = normalizeSqlServerColumnType(stripped);
      return `    ${bracketIdent(column.name)} ${normalizedType}`;
    });

    const tableConstraints =
      primaryKeyColumns.length > 0
        ? [`    PRIMARY KEY (${primaryKeyColumns.map((c) => bracketIdent(c)).join(', ')})`]
        : [];

    const inner = [...columnDefinitions, ...tableConstraints].join(',\n');
    const safeName = escapeNString(table.name);
    batches.push(
      `IF NOT EXISTS (SELECT 1 FROM sys.tables t INNER JOIN sys.schemas s ON t.schema_id = s.schema_id WHERE t.name = N'${safeName}' AND s.name = N'dbo')\n` +
        `BEGIN\n` +
        `  CREATE TABLE dbo.${bracketIdent(table.name)} (\n${inner}\n  );\n` +
        `END`,
    );
  }
  return batches.join('\nGO\n');
}
