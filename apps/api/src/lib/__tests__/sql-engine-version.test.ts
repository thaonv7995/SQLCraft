import { describe, expect, it } from 'vitest';
import { inferEngineVersionFromDump } from '../sql-engine-version';

describe('inferEngineVersionFromDump()', () => {
  it('reads PostgreSQL pg_dump header', () => {
    const sql = `-- Dumped from database version 15.2\nCREATE TABLE t (id int);\n`;
    expect(inferEngineVersionFromDump(sql, 'postgresql')).toBe('15.2');
    expect(inferEngineVersionFromDump(sql, 'postgresql-16')).toBe('15.2');
  });

  it('reads alternate PostgreSQL dump banner', () => {
    const sql = `--\n-- PostgreSQL 14.11 database dump\n--\n`;
    expect(inferEngineVersionFromDump(sql, 'postgresql')).toBe('14.11');
  });

  it('reads MySQL mysqldump Server version', () => {
    const sql = `-- MySQL dump 10.19  Distrib 8.0.36, for Linux\n-- Server version\t8.0.36\n`;
    expect(inferEngineVersionFromDump(sql, 'mysql')).toBe('8.0.36');
    expect(inferEngineVersionFromDump(sql, 'mysql-8')).toBe('8.0.36');
  });

  it('reads SQLite header', () => {
    const sql = `-- SQLite version 3.45.1\n`;
    expect(inferEngineVersionFromDump(sql, 'sqlite')).toBe('3.45.1');
    expect(inferEngineVersionFromDump(sql, 'sqlite-3')).toBe('3.45.1');
  });

  it('returns null when header missing', () => {
    expect(inferEngineVersionFromDump('CREATE TABLE t (id int);', 'postgresql')).toBeNull();
  });
});
