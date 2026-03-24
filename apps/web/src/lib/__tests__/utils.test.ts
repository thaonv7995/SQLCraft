import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  cn,
  formatDuration,
  formatRows,
  truncateSql,
  formatRelativeTime,
  getDifficultyColor,
  getStatusColor,
  generateInitials,
  classifyQueryType,
} from '../utils';

// ─── cn() ─────────────────────────────────────────────────────────────────────

describe('cn()', () => {
  it('merges class names', () => {
    expect(cn('foo', 'bar')).toBe('foo bar');
  });

  it('deduplicates tailwind classes', () => {
    expect(cn('p-2', 'p-4')).toBe('p-4');
  });

  it('handles conditional classes', () => {
    expect(cn('base', false && 'hidden', 'extra')).toBe('base extra');
  });
});

// ─── formatDuration() ─────────────────────────────────────────────────────────

describe('formatDuration()', () => {
  it('renders milliseconds when < 1000', () => {
    expect(formatDuration(0)).toBe('0ms');
    expect(formatDuration(500)).toBe('500ms');
    expect(formatDuration(999)).toBe('999ms');
  });

  it('renders seconds when >= 1000', () => {
    expect(formatDuration(1000)).toBe('1.00s');
    expect(formatDuration(2500)).toBe('2.50s');
  });
});

// ─── formatRows() ─────────────────────────────────────────────────────────────

describe('formatRows()', () => {
  it('shows raw count for small numbers', () => {
    expect(formatRows(0)).toBe('0');
    expect(formatRows(500)).toBe('500');
    expect(formatRows(999)).toBe('999');
  });

  it('uses K suffix for thousands', () => {
    expect(formatRows(1_000)).toBe('1.0K');
    expect(formatRows(12_500)).toBe('12.5K');
  });

  it('uses M suffix for millions', () => {
    expect(formatRows(1_000_000)).toBe('1.0M');
    expect(formatRows(2_500_000)).toBe('2.5M');
  });
});

// ─── truncateSql() ────────────────────────────────────────────────────────────

describe('truncateSql()', () => {
  it('returns the full SQL when shorter than limit', () => {
    const sql = 'SELECT * FROM users';
    expect(truncateSql(sql, 80)).toBe(sql);
  });

  it('truncates and appends ellipsis', () => {
    const sql = 'SELECT very_long_column FROM very_long_table_name WHERE condition = true';
    const result = truncateSql(sql, 30);
    expect(result).toHaveLength(33); // 30 chars + '...'
    expect(result.endsWith('...')).toBe(true);
  });

  it('collapses multiple whitespace characters', () => {
    const sql = 'SELECT  *   FROM    users';
    expect(truncateSql(sql)).toBe('SELECT * FROM users');
  });

  it('trims leading/trailing whitespace', () => {
    expect(truncateSql('  SELECT 1  ')).toBe('SELECT 1');
  });

  it('returns empty string for null, undefined, or non-string', () => {
    expect(truncateSql(null)).toBe('');
    expect(truncateSql(undefined)).toBe('');
    expect(truncateSql(123 as unknown as string)).toBe('');
  });
});

// ─── formatRelativeTime() ────────────────────────────────────────────────────

describe('formatRelativeTime()', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns "just now" for recent timestamps', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-01T12:00:30Z'));
    expect(formatRelativeTime(new Date('2024-01-01T12:00:00Z'))).toBe('just now');
  });

  it('returns minutes ago', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-01T12:05:00Z'));
    expect(formatRelativeTime(new Date('2024-01-01T12:00:00Z'))).toBe('5m ago');
  });

  it('returns hours ago', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-01T15:00:00Z'));
    expect(formatRelativeTime(new Date('2024-01-01T12:00:00Z'))).toBe('3h ago');
  });

  it('returns days ago', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-04T12:00:00Z'));
    expect(formatRelativeTime(new Date('2024-01-01T12:00:00Z'))).toBe('3d ago');
  });
});

// ─── getDifficultyColor() ─────────────────────────────────────────────────────

describe('getDifficultyColor()', () => {
  it('returns secondary for beginner', () => {
    expect(getDifficultyColor('beginner')).toBe('text-secondary');
    expect(getDifficultyColor('Beginner')).toBe('text-secondary');
  });

  it('returns primary for intermediate', () => {
    expect(getDifficultyColor('intermediate')).toBe('text-primary');
  });

  it('returns error for advanced', () => {
    expect(getDifficultyColor('advanced')).toBe('text-error');
  });

  it('returns default for unknown difficulty', () => {
    expect(getDifficultyColor('unknown')).toBe('text-on-surface-variant');
    expect(getDifficultyColor('')).toBe('text-on-surface-variant');
  });
});

// ─── getStatusColor() ────────────────────────────────────────────────────────

describe('getStatusColor()', () => {
  it('returns secondary for ready/success/completed', () => {
    expect(getStatusColor('ready')).toBe('text-secondary');
    expect(getStatusColor('success')).toBe('text-secondary');
    expect(getStatusColor('completed')).toBe('text-secondary');
  });

  it('returns tertiary for pending/running/provisioning', () => {
    expect(getStatusColor('pending')).toBe('text-tertiary');
    expect(getStatusColor('running')).toBe('text-tertiary');
    expect(getStatusColor('provisioning')).toBe('text-tertiary');
  });

  it('returns error for error/failed', () => {
    expect(getStatusColor('error')).toBe('text-error');
    expect(getStatusColor('failed')).toBe('text-error');
  });

  it('returns primary for active', () => {
    expect(getStatusColor('active')).toBe('text-primary');
  });
});

// ─── generateInitials() ──────────────────────────────────────────────────────

describe('generateInitials()', () => {
  it('returns first letters of first two words', () => {
    expect(generateInitials('Alice Johnson')).toBe('AJ');
    expect(generateInitials('Bob Chen Lee')).toBe('BC');
  });

  it('handles single-word names', () => {
    expect(generateInitials('Alice')).toBe('A');
  });

  it('uppercases the result', () => {
    expect(generateInitials('alice johnson')).toBe('AJ');
  });
});

// ─── classifyQueryType() ──────────────────────────────────────────────────────

describe('classifyQueryType()', () => {
  it.each([
    ['SELECT * FROM users', 'SELECT'],
    ['INSERT INTO orders VALUES (1)', 'INSERT'],
    ['UPDATE users SET name = "x"', 'UPDATE'],
    ['DELETE FROM users WHERE id = 1', 'DELETE'],
    ['CREATE TABLE foo (id INT)', 'CREATE'],
    ['DROP TABLE foo', 'DROP'],
    ['ALTER TABLE foo ADD COLUMN bar TEXT', 'ALTER'],
    ['EXPLAIN SELECT * FROM users', 'EXPLAIN'],
    ['WITH cte AS (SELECT 1) SELECT * FROM cte', 'QUERY'],
  ])('classifies "%s" as %s', (sql, expected) => {
    expect(classifyQueryType(sql)).toBe(expected);
  });

  it('is case-insensitive', () => {
    expect(classifyQueryType('select 1')).toBe('SELECT');
    expect(classifyQueryType('insert into x values (1)')).toBe('INSERT');
  });
});
