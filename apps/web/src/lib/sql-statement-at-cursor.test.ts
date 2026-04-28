import { describe, expect, it } from 'vitest';
import { getSqlStatementAtCursor, splitSqlStatements } from './sql-statement-at-cursor';

describe('splitSqlStatements', () => {
  it('splits on semicolons', () => {
    const sql = 'SELECT 1; SELECT 2';
    const r = splitSqlStatements(sql);
    expect(r).toHaveLength(2);
    expect(sql.slice(r[0].from, r[0].toExclusive).trim()).toBe('SELECT 1');
    expect(sql.slice(r[1].from, r[1].toExclusive).trim()).toBe('SELECT 2');
  });

  it('does not split semicolons inside single-quoted strings', () => {
    const sql = "SELECT 'a;b'; SELECT 2";
    const r = splitSqlStatements(sql);
    expect(r).toHaveLength(2);
    expect(sql.slice(r[0].from, r[0].toExclusive).trim()).toBe("SELECT 'a;b'");
  });

  it('does not split inside line comments', () => {
    const sql = 'SELECT 1 -- ; fake\n; SELECT 2';
    const r = splitSqlStatements(sql);
    expect(r.length).toBeGreaterThanOrEqual(1);
    const joined = r.map((x) => sql.slice(x.from, x.toExclusive).trim()).filter(Boolean);
    expect(joined.some((s) => s.includes('SELECT 2'))).toBe(true);
  });

  it('does not split inside dollar-quoted strings', () => {
    const sql = 'SELECT $$a;b$$; SELECT 2';
    const r = splitSqlStatements(sql);
    expect(r).toHaveLength(2);
    expect(sql.slice(r[0].from, r[0].toExclusive).trim()).toBe('SELECT $$a;b$$');
  });

  it('splits MySQL DELIMITER blocks using the active delimiter', () => {
    const sql = `DELIMITER $$
CREATE PROCEDURE foo() BEGIN SELECT 1; END $$
DELIMITER ;`;
    const r = splitSqlStatements(sql);
    const non = r
      .map((range) => sql.slice(range.from, range.toExclusive).trim())
      .filter(Boolean);
    expect(non).toEqual(['CREATE PROCEDURE foo() BEGIN SELECT 1; END']);
  });

  it('does not treat $$ as a dollar-quote once a DELIMITER directive switched modes', () => {
    const sql = `DELIMITER $$
SELECT 1 $$
SELECT 2 $$
DELIMITER ;`;
    const non = splitSqlStatements(sql)
      .map((range) => sql.slice(range.from, range.toExclusive).trim())
      .filter(Boolean);
    expect(non).toEqual(['SELECT 1', 'SELECT 2']);
  });
});

describe('getSqlStatementAtCursor', () => {
  it('returns the statement under the cursor', () => {
    const sql = 'SELECT 1;\nSELECT 2';
    const semi = sql.indexOf(';');
    expect(getSqlStatementAtCursor(sql, 0).trim()).toBe('SELECT 1');
    expect(getSqlStatementAtCursor(sql, semi).trim()).toBe('SELECT 1');
    expect(getSqlStatementAtCursor(sql, sql.length).trim()).toBe('SELECT 2');
  });

  it('treats caret after semicolon (same line or gap) as the previous statement', () => {
    const sql = 'SELECT *\nFROM doctors;\nSELECT 2';
    const semi = sql.indexOf(';');
    const afterSemi = semi + 1;
    const onNextLineBeforeSelect2 = sql.indexOf('SELECT 2');
    expect(getSqlStatementAtCursor(sql, afterSemi).trim()).toBe('SELECT *\nFROM doctors');
    expect(getSqlStatementAtCursor(sql, onNextLineBeforeSelect2 - 1).trim()).toBe('SELECT *\nFROM doctors');
    expect(getSqlStatementAtCursor(sql, onNextLineBeforeSelect2).trim()).toBe('SELECT 2');
  });

  it('treats spaces after semicolon as still the previous statement until the next token', () => {
    const sql = 'SELECT 1;   \n\t SELECT 2';
    const semi = sql.indexOf(';');
    const afterSemi = semi + 1;
    const select2 = sql.indexOf('SELECT 2');
    expect(getSqlStatementAtCursor(sql, afterSemi).trim()).toBe('SELECT 1');
    expect(getSqlStatementAtCursor(sql, select2 - 1).trim()).toBe('SELECT 1');
    expect(getSqlStatementAtCursor(sql, select2).trim()).toBe('SELECT 2');
  });

  it('falls back to previous non-empty when cursor is in an empty segment', () => {
    const sql = 'SELECT 1;;';
    const idx = sql.lastIndexOf(';');
    expect(getSqlStatementAtCursor(sql, idx).trim()).toBe('SELECT 1');
  });

  it('returns the CREATE PROCEDURE body without DELIMITER directives when cursor is inside it', () => {
    const sql = `DELIMITER $$

CREATE PROCEDURE GetPatientVitals(IN patientId INT)
BEGIN
    SELECT v.heart_rate
    FROM vitals v
    WHERE v.patient_id = patientId;
END $$

DELIMITER ;`;
    const cursor = sql.indexOf('SELECT v.heart_rate');
    const stmt = getSqlStatementAtCursor(sql, cursor);
    expect(stmt).toMatch(/^CREATE PROCEDURE GetPatientVitals\(IN patientId INT\)/);
    expect(stmt).toMatch(/END$/);
    expect(stmt).not.toMatch(/DELIMITER/i);
    expect(stmt).not.toMatch(/\$\$/);
  });

  it('returns the procedure body when the caret is on a DELIMITER directive line', () => {
    const sql = `DELIMITER $$
CREATE PROCEDURE foo() BEGIN SELECT 1; END $$
DELIMITER ;`;
    const onDirective = sql.indexOf('DELIMITER ;');
    expect(getSqlStatementAtCursor(sql, onDirective)).toBe(
      'CREATE PROCEDURE foo() BEGIN SELECT 1; END',
    );
  });
});
