import { describe, expect, it } from 'vitest';
import {
  hasMysqlDelimiterDirective,
  splitMysqlStatementsWithDelimiter,
} from './mysql-statement-splitter';

describe('splitMysqlStatementsWithDelimiter', () => {
  it('splits basic semicolon-separated statements', () => {
    const sql = 'SELECT 1; SELECT 2;';
    const parts = splitMysqlStatementsWithDelimiter(sql).map((s) => s.sql);
    expect(parts).toEqual(['SELECT 1', 'SELECT 2']);
  });

  it('keeps a single CREATE PROCEDURE intact when DELIMITER is used', () => {
    const sql = `DELIMITER $$

CREATE PROCEDURE GetPatientVitals(IN patientId INT)
BEGIN
    SELECT
        p.id AS patient_id,
        v.heart_rate
    FROM vitals v
    JOIN patients p
        ON v.patient_id = p.id
    WHERE p.id = patientId;
END $$

DELIMITER ;`;
    const parts = splitMysqlStatementsWithDelimiter(sql).map((s) => s.sql);
    expect(parts).toHaveLength(1);
    expect(parts[0]).toMatch(/^CREATE PROCEDURE GetPatientVitals\(IN patientId INT\)/);
    expect(parts[0]).toMatch(/WHERE p\.id = patientId;\nEND$/);
    expect(parts[0]).not.toMatch(/DELIMITER/i);
  });

  it('handles `//` as a custom delimiter token', () => {
    const sql = `DELIMITER //
CREATE PROCEDURE foo() BEGIN SELECT 1; END //
DELIMITER ;`;
    const parts = splitMysqlStatementsWithDelimiter(sql).map((s) => s.sql);
    expect(parts).toEqual(['CREATE PROCEDURE foo() BEGIN SELECT 1; END']);
  });

  it('emits multiple statements separated by the active delimiter', () => {
    const sql = `DELIMITER $$
SELECT 1 $$
SELECT 2 $$
DELIMITER ;
SELECT 3;`;
    const parts = splitMysqlStatementsWithDelimiter(sql).map((s) => s.sql);
    expect(parts).toEqual(['SELECT 1', 'SELECT 2', 'SELECT 3']);
  });

  it('does not split delimiters inside single-quoted strings', () => {
    const sql = `SELECT 'a;b'; SELECT 'foo';`;
    const parts = splitMysqlStatementsWithDelimiter(sql).map((s) => s.sql);
    expect(parts).toEqual(["SELECT 'a;b'", "SELECT 'foo'"]);
  });

  it('does not split delimiters inside backtick identifiers', () => {
    const sql = 'SELECT `weird;name` FROM t; SELECT 2;';
    const parts = splitMysqlStatementsWithDelimiter(sql).map((s) => s.sql);
    expect(parts).toEqual(['SELECT `weird;name` FROM t', 'SELECT 2']);
  });

  it('honours backslash escape sequences inside string literals', () => {
    const sql = "SELECT 'a\\';b'; SELECT 2;";
    const parts = splitMysqlStatementsWithDelimiter(sql).map((s) => s.sql);
    expect(parts).toEqual(["SELECT 'a\\';b'", 'SELECT 2']);
  });

  it('ignores semicolons inside line, hash, and block comments', () => {
    const sql = `-- ; ignored
# also ; ignored
SELECT /* ; */ 1;
SELECT 2;`;
    const parts = splitMysqlStatementsWithDelimiter(sql).map((s) => s.sql);
    expect(parts).toEqual([
      `-- ; ignored\n# also ; ignored\nSELECT /* ; */ 1`,
      'SELECT 2',
    ]);
  });

  it('treats DELIMITER as a directive only at the start of a logical statement', () => {
    const sql = `SELECT 'DELIMITER $$' AS x;`;
    const parts = splitMysqlStatementsWithDelimiter(sql).map((s) => s.sql);
    expect(parts).toEqual([`SELECT 'DELIMITER $$' AS x`]);
  });

  it('returns an empty array when input is empty / only whitespace', () => {
    expect(splitMysqlStatementsWithDelimiter('')).toEqual([]);
    expect(splitMysqlStatementsWithDelimiter('   \n\t\n  ')).toEqual([]);
  });

  it('preserves source ranges for each statement', () => {
    const sql = `SELECT 1; SELECT 2;`;
    const parts = splitMysqlStatementsWithDelimiter(sql);
    expect(parts).toHaveLength(2);
    expect(sql.slice(parts[0].from, parts[0].to)).toBe('SELECT 1');
    expect(sql.slice(parts[1].from, parts[1].to)).toBe(' SELECT 2');
  });
});

describe('hasMysqlDelimiterDirective', () => {
  it('detects DELIMITER at start of input', () => {
    expect(hasMysqlDelimiterDirective('DELIMITER $$')).toBe(true);
    expect(hasMysqlDelimiterDirective('  DELIMITER //')).toBe(true);
    expect(hasMysqlDelimiterDirective('SELECT 1;\nDELIMITER //')).toBe(true);
  });

  it('returns false when DELIMITER is only inside a string literal', () => {
    expect(hasMysqlDelimiterDirective("SELECT 'DELIMITER $$' AS x")).toBe(false);
  });

  it('returns false for plain SQL', () => {
    expect(hasMysqlDelimiterDirective('SELECT 1;')).toBe(false);
    expect(hasMysqlDelimiterDirective('')).toBe(false);
  });
});
