import { format } from 'sql-formatter';

/** Format SQL entirely in the browser (no API). Uses PostgreSQL dialect — suitable for sandbox labs. */
export function formatSqlInBrowser(sql: string): string {
  const trimmed = sql.trim();
  if (!trimmed) {
    return sql;
  }
  return format(trimmed, {
    language: 'postgresql',
    tabWidth: 2,
    useTabs: false,
    keywordCase: 'upper',
    indentStyle: 'standard',
    linesBetweenQueries: 2,
  });
}
