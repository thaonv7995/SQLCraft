import { describe, it, expect } from 'vitest';
import { buildExplainResultFromPgRow, repairExplainPlanResult, validateSql } from '../query-executor';

describe('validateSql', () => {
  describe('empty / blank input', () => {
    it('rejects an empty string', () => {
      const result = validateSql('');
      expect(result.valid).toBe(false);
      expect(result.reason).toMatch(/empty/i);
    });

    it('rejects a whitespace-only string', () => {
      const result = validateSql('   \n\t  ');
      expect(result.valid).toBe(false);
    });
  });

  describe('blocked DDL patterns', () => {
    it('blocks DROP TABLE', () => {
      const result = validateSql('DROP TABLE users');
      expect(result.valid).toBe(false);
      expect(result.reason).toMatch(/drop/i);
    });

    it('allows DROP INDEX for sandbox optimization challenges', () => {
      const result = validateSql('DROP INDEX IF EXISTS idx_users_active');
      expect(result.valid).toBe(true);
    });

    it('blocks DROP with leading whitespace', () => {
      const result = validateSql('  drop table orders;');
      expect(result.valid).toBe(false);
    });

    it('blocks TRUNCATE', () => {
      const result = validateSql('TRUNCATE TABLE sessions');
      expect(result.valid).toBe(false);
      expect(result.reason).toMatch(/truncate/i);
    });

    it('blocks CREATE USER', () => {
      const result = validateSql("CREATE USER hacker WITH PASSWORD 'p4ss'");
      expect(result.valid).toBe(false);
      expect(result.reason).toMatch(/create user/i);
    });

    it('blocks ALTER USER', () => {
      const result = validateSql("ALTER USER admin WITH SUPERUSER");
      expect(result.valid).toBe(false);
    });

    it('blocks GRANT', () => {
      const result = validateSql('GRANT ALL PRIVILEGES ON users TO hacker');
      expect(result.valid).toBe(false);
    });

    it('blocks REVOKE', () => {
      const result = validateSql('REVOKE ALL ON TABLE users FROM public');
      expect(result.valid).toBe(false);
    });

    it('blocks pg_catalog access', () => {
      const result = validateSql('SELECT * FROM pg_catalog.pg_tables');
      expect(result.valid).toBe(false);
    });

    it('blocks pg_read_file', () => {
      const result = validateSql("SELECT pg_read_file('/etc/passwd')");
      expect(result.valid).toBe(false);
    });

    it('blocks COPY TO', () => {
      const result = validateSql("COPY users TO '/tmp/dump.csv'");
      expect(result.valid).toBe(false);
    });

    it('blocks COPY FROM', () => {
      const result = validateSql("COPY users FROM '/tmp/data.csv'");
      expect(result.valid).toBe(false);
    });

    it('blocks pg_sleep', () => {
      const result = validateSql('SELECT pg_sleep(10)');
      expect(result.valid).toBe(false);
    });
  });

  describe('DELETE / UPDATE without WHERE', () => {
    it('blocks DELETE without WHERE clause', () => {
      const result = validateSql('DELETE FROM users');
      expect(result.valid).toBe(false);
      expect(result.reason).toMatch(/where/i);
    });

    it('blocks DELETE with trailing semicolon but no WHERE', () => {
      const result = validateSql('DELETE FROM orders;');
      expect(result.valid).toBe(false);
    });

    it('blocks UPDATE without WHERE clause', () => {
      const result = validateSql("UPDATE users SET status = 'disabled'");
      expect(result.valid).toBe(false);
      expect(result.reason).toMatch(/where/i);
    });

    it('allows DELETE with WHERE clause', () => {
      const result = validateSql('DELETE FROM users WHERE id = 1');
      expect(result.valid).toBe(true);
    });

    it('allows UPDATE with WHERE clause', () => {
      const result = validateSql("UPDATE users SET name = 'Alice' WHERE id = 42");
      expect(result.valid).toBe(true);
    });
  });

  describe('allowed statements', () => {
    it('allows a basic SELECT', () => {
      expect(validateSql('SELECT * FROM users').valid).toBe(true);
    });

    it('allows a JOIN query', () => {
      const sql = `
        SELECT u.name, COUNT(o.id)
        FROM users u
        LEFT JOIN orders o ON u.id = o.user_id
        GROUP BY u.id
      `;
      expect(validateSql(sql).valid).toBe(true);
    });

    it('allows INSERT', () => {
      const result = validateSql("INSERT INTO events (type) VALUES ('click')");
      expect(result.valid).toBe(true);
    });

    it('allows CREATE INDEX for optimization workflows', () => {
      const result = validateSql('CREATE INDEX idx_orders_status ON orders(status)');
      expect(result.valid).toBe(true);
    });

    it('allows CREATE TABLE', () => {
      const result = validateSql('CREATE TABLE temp_data (id SERIAL PRIMARY KEY, val TEXT)');
      expect(result.valid).toBe(true);
    });

    it('allows EXPLAIN SELECT', () => {
      const result = validateSql('EXPLAIN SELECT * FROM orders WHERE status = $1');
      expect(result.valid).toBe(true);
    });

    it('allows a CTE query', () => {
      const sql = `
        WITH monthly AS (
          SELECT DATE_TRUNC('month', created_at) AS month, SUM(total) AS revenue
          FROM orders GROUP BY 1
        )
        SELECT * FROM monthly
      `;
      expect(validateSql(sql).valid).toBe(true);
    });
  });

  describe('case insensitivity', () => {
    it('blocks mixed-case DROP', () => {
      expect(validateSql('Drop Table users').valid).toBe(false);
    });

    it('blocks mixed-case TRUNCATE', () => {
      expect(validateSql('Truncate TABLE sessions').valid).toBe(false);
    });

    it('blocks uppercase GRANT', () => {
      expect(validateSql('GRANT SELECT ON users TO public').valid).toBe(false);
    });
  });
});

describe('buildExplainResultFromPgRow', () => {
  const planEnvelope = [
    {
      Plan: {
        'Node Type': 'Seq Scan',
        'Total Cost': 333.45,
        'Actual Rows': 100,
        'Actual Total Time': 1.23,
      },
    },
  ];

  it('reads Total Cost when column is lowercase query plan (node-pg default)', () => {
    const { planSummary } = buildExplainResultFromPgRow({ 'query plan': planEnvelope });
    expect(planSummary.totalCost).toBe(333.45);
    expect(planSummary.nodeType).toBe('Seq Scan');
  });

  it('reads Total Cost when column is QUERY PLAN', () => {
    const { planSummary } = buildExplainResultFromPgRow({ 'QUERY PLAN': planEnvelope });
    expect(planSummary.totalCost).toBe(333.45);
  });

  it('unwraps a single-column row to the plan payload', () => {
    const { planSummary } = buildExplainResultFromPgRow({ 'query plan': planEnvelope });
    expect(planSummary.totalCost).toBe(333.45);
  });

  it('parses JSON string payloads', () => {
    const { planSummary } = buildExplainResultFromPgRow({
      'query plan': JSON.stringify(planEnvelope),
    });
    expect(planSummary.totalCost).toBe(333.45);
  });

  it('coerces Total Cost from string', () => {
    const { planSummary } = buildExplainResultFromPgRow({
      'query plan': [{ Plan: { 'Node Type': 'Result', 'Total Cost': '12.5' } }],
    });
    expect(planSummary.totalCost).toBe(12.5);
  });

  it('reads Total Cost from snake_case keys on Plan node', () => {
    const { planSummary } = buildExplainResultFromPgRow({
      'query plan': [{ Plan: { node_type: 'Seq Scan', total_cost: 42 } }],
    });
    expect(planSummary.totalCost).toBe(42);
    expect(planSummary.nodeType).toBe('Seq Scan');
  });

  it('reads integer Total Cost on object envelope with Planning sibling (ANALYZE JSON)', () => {
    const row = {
      'query plan': {
        Plan: {
          'Node Type': 'Seq Scan',
          'Total Cost': 3,
          'Actual Rows': 100,
          'Actual Total Time': 0.01,
        },
        Planning: { 'Shared Hit Blocks': 77 },
        'Planning Time': 0.239,
        'Execution Time': 0.04,
      },
    };
    const { planSummary } = buildExplainResultFromPgRow(row);
    expect(planSummary.totalCost).toBe(3);
    expect(planSummary.actualTime).toBe(0.01);
  });

  it('reads Total Cost when the only column is ?column?', () => {
    const { planSummary } = buildExplainResultFromPgRow({ '?column?': planEnvelope });
    expect(planSummary.totalCost).toBe(333.45);
  });

  it('finds EXPLAIN JSON among multiple columns with non-standard names', () => {
    const { planSummary } = buildExplainResultFromPgRow({
      junk: 'not-json',
      custom: planEnvelope,
    });
    expect(planSummary.totalCost).toBe(333.45);
  });
});

describe('repairExplainPlanResult', () => {
  it('fills totalCost from rawPlan when planSummary was empty', () => {
    const repaired = repairExplainPlanResult({
      rawPlan: { Plan: { 'Node Type': 'Seq Scan', 'Total Cost': 3 } },
      planSummary: {},
    });
    expect(repaired.planSummary.totalCost).toBe(3);
    expect(repaired.planSummary.nodeType).toBe('Seq Scan');
  });

  it('coerces string Total Cost on planSummary using rawPlan merge', () => {
    const repaired = repairExplainPlanResult({
      rawPlan: { Plan: { 'Node Type': 'Seq Scan', 'Total Cost': 3 } },
      planSummary: { totalCost: '3' as unknown as number },
    });
    expect(repaired.planSummary.totalCost).toBe(3);
  });
});
