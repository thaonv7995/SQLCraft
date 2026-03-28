import { describe, expect, it } from 'vitest';
import { inferSqlDialectFromDump } from '../sql-dialect-infer';

describe('inferSqlDialectFromDump()', () => {
  it('detects PostgreSQL pg_dump signatures', () => {
    const sql = `-- PostgreSQL database dump\n\nCOPY public.orders (id) FROM stdin;\n1\n\\.`;
    expect(inferSqlDialectFromDump(sql)).toEqual({
      inferredDialect: 'postgresql',
      dialectConfidence: 'high',
    });
  });

  it('detects MySQL mysqldump signatures', () => {
    const sql = `-- MySQL dump 8.0\nCREATE TABLE \`users\` (\n  id int NOT NULL AUTO_INCREMENT,\n  PRIMARY KEY (id)\n) ENGINE=InnoDB;`;
    expect(inferSqlDialectFromDump(sql).inferredDialect).toBe('mysql');
    expect(['high', 'medium']).toContain(inferSqlDialectFromDump(sql).dialectConfidence);
  });

  it('detects SQLite pragmas', () => {
    const sql = `PRAGMA foreign_keys=OFF;\nCREATE TABLE x (a int);`;
    expect(inferSqlDialectFromDump(sql)).toEqual({
      inferredDialect: 'sqlite',
      dialectConfidence: 'high',
    });
  });

  it('falls back to PostgreSQL with low confidence when ambiguous', () => {
    const sql = `CREATE TABLE t (id int);`;
    expect(inferSqlDialectFromDump(sql)).toEqual({
      inferredDialect: 'postgresql',
      dialectConfidence: 'low',
    });
  });
});
