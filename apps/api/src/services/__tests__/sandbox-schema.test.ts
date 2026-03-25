import { describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/config', () => ({
  config: {
    SANDBOX_DB_USER: 'sandbox_user',
    SANDBOX_DB_PASSWORD: 'sandbox_password',
    SANDBOX_DB_HOST: 'localhost',
    SANDBOX_DB_PORT: 5432,
  },
}));

import { diffSandboxSchema, parseBaseSchemaSnapshot } from '../sandbox-schema';

describe('parseBaseSchemaSnapshot()', () => {
  it('infers implicit unique indexes from unique columns and matches runtime pg index definitions', () => {
    const baseSnapshot = parseBaseSchemaSnapshot({
      tables: [
        {
          name: 'users',
          columns: [
            { name: 'id', type: 'SERIAL PRIMARY KEY' },
            { name: 'email', type: 'VARCHAR(255) NOT NULL UNIQUE' },
          ],
        },
        {
          name: 'categories',
          columns: [
            { name: 'id', type: 'SERIAL PRIMARY KEY' },
            { name: 'slug', type: 'VARCHAR(100) NOT NULL UNIQUE' },
          ],
        },
      ],
    });

    expect(baseSnapshot.indexes).toEqual([
      {
        name: 'categories_slug_key',
        tableName: 'categories',
        definition:
          'CREATE UNIQUE INDEX categories_slug_key ON public.categories USING btree (slug)',
      },
      {
        name: 'users_email_key',
        tableName: 'users',
        definition: 'CREATE UNIQUE INDEX users_email_key ON public.users USING btree (email)',
      },
    ]);

    const diff = diffSandboxSchema(baseSnapshot, {
      indexes: [
        {
          name: 'categories_slug_key',
          tableName: 'categories',
          definition:
            'CREATE UNIQUE INDEX categories_slug_key ON categories (slug)',
        },
        {
          name: 'users_email_key',
          tableName: 'users',
          definition:
            'CREATE UNIQUE INDEX users_email_key ON public.users USING btree (email)',
        },
      ],
      views: [],
      materializedViews: [],
      functions: [],
      partitions: [],
    });

    expect(diff.hasChanges).toBe(false);
    expect(diff.indexes.added).toHaveLength(0);
    expect(diff.indexes.removed).toHaveLength(0);
    expect(diff.indexes.changed).toHaveLength(0);
  });
});
