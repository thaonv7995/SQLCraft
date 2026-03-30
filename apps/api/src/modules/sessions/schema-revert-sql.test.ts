import { describe, expect, it } from 'vitest';
import type { SandboxSchemaDiff } from '@sqlcraft/sandbox-schema-diff';
import { buildMysqlRevertStatements, buildSqlServerRevertStatements } from './schema-revert-ddl';

function emptySection<T>() {
  return { base: [], current: [], added: [], removed: [], changed: [] as Array<{ base: T; current: T }> };
}

function minimalDiff(overrides: Partial<SandboxSchemaDiff>): SandboxSchemaDiff {
  return {
    hasChanges: true,
    indexes: emptySection(),
    views: emptySection(),
    materializedViews: emptySection(),
    functions: emptySection(),
    partitions: emptySection(),
    ...overrides,
  };
}

describe('buildMysqlRevertStatements', () => {
  it('drops index when reverting an added index', () => {
    const diff = minimalDiff({
      indexes: {
        ...emptySection(),
        added: [
          {
            name: 'idx_orders_user',
            tableName: 'orders',
            definition:
              'CREATE INDEX `idx_orders_user` ON `orders` (`user_id`)',
          },
        ],
      },
    });
    const stmts = buildMysqlRevertStatements(
      {
        resourceType: 'indexes',
        changeType: 'added',
        name: 'idx_orders_user',
        tableName: 'orders',
      },
      diff,
    );
    expect(stmts).toEqual(['DROP INDEX `idx_orders_user` ON `orders`;']);
  });

  it('re-applies removed index DDL', () => {
    const diff = minimalDiff({
      indexes: {
        ...emptySection(),
        removed: [
          {
            name: 'idx_old',
            tableName: 't',
            definition: 'CREATE INDEX `idx_old` ON `t` (`c`)',
          },
        ],
      },
    });
    const stmts = buildMysqlRevertStatements(
      { resourceType: 'indexes', changeType: 'removed', name: 'idx_old', tableName: 't' },
      diff,
    );
    expect(stmts).toEqual(['CREATE INDEX `idx_old` ON `t` (`c`);']);
  });
});

describe('buildSqlServerRevertStatements', () => {
  it('drops index when reverting an added index (dbo table)', () => {
    const diff = minimalDiff({
      indexes: {
        ...emptySection(),
        added: [
          {
            name: 'IX_Orders_User',
            tableName: 'Orders',
            definition:
              'CREATE INDEX [IX_Orders_User] ON [dbo].[Orders] ([UserId] ASC)',
          },
        ],
      },
    });
    const stmts = buildSqlServerRevertStatements(
      {
        resourceType: 'indexes',
        changeType: 'added',
        name: 'IX_Orders_User',
        tableName: 'Orders',
      },
      diff,
    );
    expect(stmts).toEqual(['DROP INDEX [IX_Orders_User] ON [dbo].[Orders];']);
  });
});
