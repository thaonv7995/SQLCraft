import type { SchemaSqlDialect } from '@sqlcraft/types';

export type SqlDialectConfidence = 'high' | 'medium' | 'low';

/**
 * Heuristic dialect detection from raw dump text (before comment stripping).
 * Uses a bounded window for very large files.
 */
export function inferSqlDialectFromDump(rawUtf8: string): {
  inferredDialect: SchemaSqlDialect;
  dialectConfidence: SqlDialectConfidence;
} {
  const windowSize = 12 * 1024 * 1024;
  const window = rawUtf8.length <= windowSize ? rawUtf8 : rawUtf8.slice(0, windowSize);

  let pg = 0;
  let mysql = 0;
  let mariadb = 0;
  let sqlite = 0;
  let mssql = 0;

  if (/--\s*PostgreSQL database dump/i.test(window)) pg += 12;
  if (/--\s*Dumped by pg_dump/i.test(window)) pg += 12;
  if (/--\s*Dumped from database/i.test(window)) pg += 6;
  if (/\\connect\b/i.test(window)) pg += 5;
  if (/\bCOPY\s+[^\n]+\s+FROM\s+stdin\b/i.test(window)) pg += 15;

  if (/--\s*MySQL dump/i.test(window)) mysql += 14;
  if (/mysqldump\b/i.test(window)) mysql += 8;
  if (/ENGINE=InnoDB/i.test(window)) mysql += 10;
  if (/AUTO_INCREMENT\s*=/i.test(window)) mysql += 6;
  if (/\/\*!\d{5}/.test(window)) mysql += 7;
  if (/LOCK TABLES `/i.test(window)) mysql += 5;
  if (/CHARACTER SET utf8/i.test(window)) mysql += 3;
  if (/--\s*MariaDB dump/i.test(window)) mariadb += 14;
  if (/MariaDB server version/i.test(window)) mariadb += 8;

  if (/^\s*PRAGMA\b/im.test(window)) sqlite += 12;
  if (/--\s*SQLite/i.test(window)) sqlite += 10;

  if (/--\s*Microsoft SQL Server/i.test(window)) mssql += 14;
  if (/\bSET\s+ANSI_NULLS\s+ON\b/i.test(window) && /\bGO\b/.test(window)) mssql += 4;

  const ranked = [
    { dialect: 'postgresql' as const, score: pg },
    { dialect: 'mysql' as const, score: mysql + mariadb * 0.5 },
    { dialect: 'mariadb' as const, score: mariadb },
    { dialect: 'sqlite' as const, score: sqlite },
    { dialect: 'sqlserver' as const, score: mssql },
  ].sort((a, b) => b.score - a.score);

  const best = ranked[0]!;
  const second = ranked[1]!;

  if (best.score === 0) {
    return { inferredDialect: 'postgresql', dialectConfidence: 'low' };
  }
  if (best.score >= 12 && best.score - second.score >= 4) {
    return { inferredDialect: best.dialect, dialectConfidence: 'high' };
  }
  if (best.score >= 6 && best.score - second.score >= 2) {
    return { inferredDialect: best.dialect, dialectConfidence: 'medium' };
  }
  if (best.score > second.score) {
    return { inferredDialect: best.dialect, dialectConfidence: 'low' };
  }

  return { inferredDialect: 'postgresql', dialectConfidence: 'low' };
}
