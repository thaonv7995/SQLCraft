import { describe, expect, it } from 'vitest';
import { ListDatabasesQuerySchema } from '../databases.schema';
import { databaseMatchesListQuery } from '../databases.filters';
import type { DatabaseItem } from '../databases.types';

function sampleDb(overrides: Partial<DatabaseItem> = {}): DatabaseItem {
  return {
    id: 't1',
    name: 'Commerce Lab',
    slug: 'commerce-lab',
    description: 'Orders and customers',
    domain: 'ecommerce',
    scale: 'small',
    sourceScale: 'small',
    difficulty: 'beginner',
    dialect: 'postgresql',
    engineVersion: '16.2',
    engine: 'PostgreSQL 16.2',
    domainIcon: 'storefront',
    tags: ['Orders', 'Inventory'],
    rowCount: 100,
    sourceRowCount: 100,
    tableCount: 3,
    estimatedSizeGb: 0.1,
    schemaTemplateId: 't1',
    availableScales: ['small', 'tiny'],
    availableScaleMetadata: [],
    ...overrides,
  };
}

describe('databaseMatchesListQuery', () => {
  it('filters by dialect', () => {
    const db = sampleDb({ dialect: 'mysql' });
    const q = ListDatabasesQuerySchema.parse({ dialect: 'mysql', page: 1, limit: 20 });
    expect(databaseMatchesListQuery(db, q)).toBe(true);
    const q2 = ListDatabasesQuerySchema.parse({ dialect: 'postgresql', page: 1, limit: 20 });
    expect(databaseMatchesListQuery(db, q2)).toBe(false);
  });

  it('matches q on name slug description engine tags', () => {
    const db = sampleDb();
    const q = ListDatabasesQuerySchema.parse({ q: 'commerce', page: 1, limit: 20 });
    expect(databaseMatchesListQuery(db, q)).toBe(true);
    const q2 = ListDatabasesQuerySchema.parse({ q: '16.2', page: 1, limit: 20 });
    expect(databaseMatchesListQuery(db, q2)).toBe(true);
    const q3 = ListDatabasesQuerySchema.parse({ q: 'orders', page: 1, limit: 20 });
    expect(databaseMatchesListQuery(db, q3)).toBe(true);
    const q4 = ListDatabasesQuerySchema.parse({ q: 'nope', page: 1, limit: 20 });
    expect(databaseMatchesListQuery(db, q4)).toBe(false);
  });

  it('coerces empty q to no text filter', () => {
    const db = sampleDb();
    const q = ListDatabasesQuerySchema.parse({ q: '   ', page: 1, limit: 20 });
    expect(databaseMatchesListQuery(db, q)).toBe(true);
  });

  it('combines domain scale difficulty', () => {
    const db = sampleDb({ domain: 'fintech', difficulty: 'advanced', availableScales: ['large'] });
    const ok = ListDatabasesQuerySchema.parse({
      domain: 'fintech',
      difficulty: 'advanced',
      scale: 'large',
      page: 1,
      limit: 20,
    });
    expect(databaseMatchesListQuery(db, ok)).toBe(true);
    const bad = ListDatabasesQuerySchema.parse({
      domain: 'ecommerce',
      page: 1,
      limit: 20,
    });
    expect(databaseMatchesListQuery(db, bad)).toBe(false);
  });
});
