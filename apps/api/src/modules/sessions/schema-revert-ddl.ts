import { normalizeSchemaSqlEngine, type SchemaSqlEngine } from '@sqlcraft/types';
import type {
  SandboxSchemaDiff,
  SandboxSchemaFunction,
  SandboxSchemaIndex,
  SandboxSchemaPartition,
} from '@sqlcraft/sandbox-schema-diff';
import { NotFoundError, ValidationError } from '../../lib/errors';
import type { RevertSchemaDiffChangeBody } from './sessions.schema';

export function assertSchemaRevertSupported(dialect: string | null | undefined): SchemaSqlEngine {
  const engine = normalizeSchemaSqlEngine(dialect ?? 'postgresql');
  if (
    engine === 'postgresql' ||
    engine === 'mysql' ||
    engine === 'mariadb' ||
    engine === 'sqlserver'
  ) {
    return engine;
  }
  throw new ValidationError(
    'Schema revert is only available for PostgreSQL, MySQL/MariaDB, and SQL Server sandboxes. This session uses a different database engine.',
  );
}

function matchesRevertTarget<T extends { name: string }>(
  item: T,
  target: RevertSchemaDiffChangeBody,
): boolean {
  if (item.name !== target.name) {
    return false;
  }
  if ('tableName' in item && typeof item.tableName === 'string' && target.tableName) {
    return item.tableName === target.tableName;
  }
  if ('signature' in item && typeof item.signature === 'string' && target.signature) {
    return item.signature === target.signature;
  }
  return true;
}

// ─── PostgreSQL ─────────────────────────────────────────────────────────────

function quotePgIdent(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

function toPgCreateViewSql(name: string, definition: string, materialized = false): string {
  const trimmed = definition.trim();
  if (/^create\s+/i.test(trimmed)) {
    return trimmed.endsWith(';') ? trimmed : `${trimmed};`;
  }
  const kind = materialized ? 'MATERIALIZED VIEW' : 'VIEW';
  return `CREATE ${kind} public.${quotePgIdent(name)} AS ${trimmed};`;
}

function toPgCreateFunctionSql(definition: string): string {
  const trimmed = definition.trim();
  if (!/^create\s+/i.test(trimmed)) {
    throw new ValidationError('Function definition is not executable');
  }
  return trimmed.endsWith(';') ? trimmed : `${trimmed};`;
}

function toPgCreatePartitionSql(partition: SandboxSchemaPartition): string {
  const trimmed = (partition.definition ?? '').trim();
  if (!trimmed) {
    throw new ValidationError('Partition definition is missing and cannot be recreated');
  }
  if (/^create\s+/i.test(trimmed)) {
    return trimmed.endsWith(';') ? trimmed : `${trimmed};`;
  }
  return `CREATE TABLE public.${quotePgIdent(partition.name)} PARTITION OF public.${quotePgIdent(partition.parentTable)} ${trimmed};`;
}

export function buildPostgresRevertStatements(
  target: RevertSchemaDiffChangeBody,
  diff: SandboxSchemaDiff,
): string[] {
  if (target.resourceType === 'indexes') {
    const section = diff.indexes;
    if (target.changeType === 'added') {
      const current = section.added.find((item) => matchesRevertTarget(item, target));
      if (!current) throw new NotFoundError('Target change was not found in schema diff');
      return [`DROP INDEX IF EXISTS public.${quotePgIdent(current.name)};`];
    }
    if (target.changeType === 'removed') {
      const base = section.removed.find((item) => matchesRevertTarget(item, target));
      if (!base) throw new NotFoundError('Target change was not found in schema diff');
      const d = base.definition.trim();
      return [d.endsWith(';') ? d : `${d};`];
    }
    const changed = section.changed.find((item) => matchesRevertTarget(item.current, target));
    if (!changed) throw new NotFoundError('Target change was not found in schema diff');
    const baseDef = changed.base.definition.trim();
    return [
      `DROP INDEX IF EXISTS public.${quotePgIdent(changed.current.name)};`,
      baseDef.endsWith(';') ? baseDef : `${baseDef};`,
    ];
  }

  if (target.resourceType === 'views' || target.resourceType === 'materializedViews') {
    const section =
      target.resourceType === 'materializedViews' ? diff.materializedViews : diff.views;
    const isMaterialized = target.resourceType === 'materializedViews';
    const dropSql = (name: string) =>
      `DROP ${isMaterialized ? 'MATERIALIZED VIEW' : 'VIEW'} IF EXISTS public.${quotePgIdent(name)};`;

    if (target.changeType === 'added') {
      const current = section.added.find((item) => matchesRevertTarget(item, target));
      if (!current) throw new NotFoundError('Target change was not found in schema diff');
      return [dropSql(current.name)];
    }
    if (target.changeType === 'removed') {
      const base = section.removed.find((item) => matchesRevertTarget(item, target));
      if (!base) throw new NotFoundError('Target change was not found in schema diff');
      return [toPgCreateViewSql(base.name, base.definition, isMaterialized)];
    }
    const changed = section.changed.find((item) => matchesRevertTarget(item.current, target));
    if (!changed) throw new NotFoundError('Target change was not found in schema diff');
    return [
      dropSql(changed.current.name),
      toPgCreateViewSql(changed.base.name, changed.base.definition, isMaterialized),
    ];
  }

  if (target.resourceType === 'functions') {
    const section = diff.functions;
    const dropSql = (name: string, signature: string) =>
      `DROP FUNCTION IF EXISTS public.${quotePgIdent(name)}(${signature});`;
    if (target.changeType === 'added') {
      const current = section.added.find((item) => matchesRevertTarget(item, target));
      if (!current) throw new NotFoundError('Target change was not found in schema diff');
      return [dropSql(current.name, current.signature)];
    }
    if (target.changeType === 'removed') {
      const base = section.removed.find((item) => matchesRevertTarget(item, target));
      if (!base) throw new NotFoundError('Target change was not found in schema diff');
      return [toPgCreateFunctionSql(base.definition)];
    }
    const changed = section.changed.find((item) => matchesRevertTarget(item.current, target));
    if (!changed) throw new NotFoundError('Target change was not found in schema diff');
    return [dropSql(changed.current.name, changed.current.signature), toPgCreateFunctionSql(changed.base.definition)];
  }

  const section = diff.partitions;
  const dropSql = (name: string) => `DROP TABLE IF EXISTS public.${quotePgIdent(name)};`;
  if (target.changeType === 'added') {
    const current = section.added.find((item) => matchesRevertTarget(item, target));
    if (!current) throw new NotFoundError('Target change was not found in schema diff');
    return [dropSql(current.name)];
  }
  if (target.changeType === 'removed') {
    const base = section.removed.find((item) => matchesRevertTarget(item, target));
    if (!base) throw new NotFoundError('Target change was not found in schema diff');
    return [toPgCreatePartitionSql(base)];
  }
  const changed = section.changed.find((item) => matchesRevertTarget(item.current, target));
  if (!changed) throw new NotFoundError('Target change was not found in schema diff');
  return [dropSql(changed.current.name), toPgCreatePartitionSql(changed.base)];
}

// ─── MySQL / MariaDB ──────────────────────────────────────────────────────────

function quoteMysqlIdent(identifier: string): string {
  return `\`${identifier.replace(/`/g, '``')}\``;
}

function mysqlDropIndex(indexName: string, tableName: string): string {
  return `DROP INDEX ${quoteMysqlIdent(indexName)} ON ${quoteMysqlIdent(tableName)}`;
}

function ensureMysqlIndexTable(index: SandboxSchemaIndex, context: string): string {
  if (!index.tableName?.trim()) {
    throw new ValidationError(`${context}: tableName is required to revert index changes on MySQL/MariaDB`);
  }
  return index.tableName;
}

function toMysqlCreateViewSql(name: string, definition: string): string {
  const trimmed = definition.trim();
  if (/^create\s+/i.test(trimmed)) {
    return trimmed.endsWith(';') ? trimmed : `${trimmed};`;
  }
  return `CREATE VIEW ${quoteMysqlIdent(name)} AS ${trimmed};`;
}

function mysqlDropView(name: string): string {
  return `DROP VIEW IF EXISTS ${quoteMysqlIdent(name)}`;
}

/** Revert DDL for MySQL/MariaDB (indexes + views; other kinds are not supported yet). */
export function buildMysqlRevertStatements(
  target: RevertSchemaDiffChangeBody,
  diff: SandboxSchemaDiff,
): string[] {
  if (target.resourceType === 'materializedViews') {
    throw new ValidationError('Materialized views are not used in MySQL/MariaDB sandboxes.');
  }
  if (target.resourceType === 'functions' || target.resourceType === 'partitions') {
    throw new ValidationError(
      'Reverting functions or partitions is not yet supported for MySQL/MariaDB. Revert indexes or views only.',
    );
  }

  if (target.resourceType === 'indexes') {
    const section = diff.indexes;
    if (target.changeType === 'added') {
      const current = section.added.find((item) => matchesRevertTarget(item, target));
      if (!current) throw new NotFoundError('Target change was not found in schema diff');
      const table = ensureMysqlIndexTable(current, 'Revert added index');
      return [`${mysqlDropIndex(current.name, table)};`];
    }
    if (target.changeType === 'removed') {
      const base = section.removed.find((item) => matchesRevertTarget(item, target));
      if (!base) throw new NotFoundError('Target change was not found in schema diff');
      const d = base.definition.trim();
      return [d.endsWith(';') ? d : `${d};`];
    }
    const changed = section.changed.find((item) => matchesRevertTarget(item.current, target));
    if (!changed) throw new NotFoundError('Target change was not found in schema diff');
    const curTable = ensureMysqlIndexTable(changed.current, 'Revert changed index');
    const baseDef = changed.base.definition.trim();
    return [
      `${mysqlDropIndex(changed.current.name, curTable)};`,
      baseDef.endsWith(';') ? baseDef : `${baseDef};`,
    ];
  }

  const section = diff.views;
  if (target.changeType === 'added') {
    const current = section.added.find((item) => matchesRevertTarget(item, target));
    if (!current) throw new NotFoundError('Target change was not found in schema diff');
    return [`${mysqlDropView(current.name)};`];
  }
  if (target.changeType === 'removed') {
    const base = section.removed.find((item) => matchesRevertTarget(item, target));
    if (!base) throw new NotFoundError('Target change was not found in schema diff');
    return [toMysqlCreateViewSql(base.name, base.definition)];
  }
  const changed = section.changed.find((item) => matchesRevertTarget(item.current, target));
  if (!changed) throw new NotFoundError('Target change was not found in schema diff');
  return [`${mysqlDropView(changed.current.name)};`, toMysqlCreateViewSql(changed.base.name, changed.base.definition)];
}

// ─── SQL Server ───────────────────────────────────────────────────────────────

function escapeSqlServerBracket(ident: string): string {
  return ident.replace(/\]/g, ']]');
}

function sqlServerBr(ident: string): string {
  return `[${escapeSqlServerBracket(ident)}]`;
}

function parseSqlServerTableRef(tableName: string): { schema: string; table: string } {
  const t = tableName.trim();
  const dot = t.indexOf('.');
  if (dot === -1) return { schema: 'dbo', table: t };
  return { schema: t.slice(0, dot), table: t.slice(dot + 1) };
}

function sqlServerDropIndex(indexName: string, tableName: string): string {
  const { schema, table } = parseSqlServerTableRef(tableName);
  return `DROP INDEX ${sqlServerBr(indexName)} ON ${sqlServerBr(schema)}.${sqlServerBr(table)}`;
}

function ensureSqlServerIndexTable(index: SandboxSchemaIndex, context: string): string {
  if (!index.tableName?.trim()) {
    throw new ValidationError(`${context}: tableName is required to revert index changes on SQL Server`);
  }
  return index.tableName;
}

function toSqlServerCreateViewSql(name: string, definition: string): string {
  const trimmed = definition.trim();
  if (/^create\s+/i.test(trimmed)) {
    return trimmed.endsWith(';') ? trimmed : `${trimmed};`;
  }
  return `CREATE VIEW ${sqlServerBr('dbo')}.${sqlServerBr(name)} AS ${trimmed};`;
}

function sqlServerDropView(name: string): string {
  return `DROP VIEW IF EXISTS ${sqlServerBr('dbo')}.${sqlServerBr(name)}`;
}

function sqlServerDropRoutine(name: string, objectType: string | null | undefined): string {
  const t = (objectType ?? '').toUpperCase();
  if (t === 'P' || t === 'PC' || t === 'RF' || t === 'X') {
    return `DROP PROCEDURE IF EXISTS ${sqlServerBr('dbo')}.${sqlServerBr(name)};`;
  }
  return `DROP FUNCTION IF EXISTS ${sqlServerBr('dbo')}.${sqlServerBr(name)};`;
}

function toSqlServerCreateRoutineSql(definition: string): string {
  const trimmed = definition.trim();
  if (!/^create\s+/i.test(trimmed)) {
    throw new ValidationError('Routine definition is not executable');
  }
  return trimmed.endsWith(';') ? trimmed : `${trimmed};`;
}

/** Revert T-SQL for SQL Server (indexes, views, functions/procedures). */
export function buildSqlServerRevertStatements(
  target: RevertSchemaDiffChangeBody,
  diff: SandboxSchemaDiff,
): string[] {
  if (target.resourceType === 'materializedViews') {
    throw new ValidationError(
      'Materialized views are not used in SQL Server sandboxes for schema diff.',
    );
  }
  if (target.resourceType === 'partitions') {
    throw new ValidationError('Reverting partitions is not yet supported for SQL Server.');
  }

  if (target.resourceType === 'indexes') {
    const section = diff.indexes;
    if (target.changeType === 'added') {
      const current = section.added.find((item) => matchesRevertTarget(item, target));
      if (!current) throw new NotFoundError('Target change was not found in schema diff');
      const table = ensureSqlServerIndexTable(current, 'Revert added index');
      return [`${sqlServerDropIndex(current.name, table)};`];
    }
    if (target.changeType === 'removed') {
      const base = section.removed.find((item) => matchesRevertTarget(item, target));
      if (!base) throw new NotFoundError('Target change was not found in schema diff');
      const d = base.definition.trim();
      return [d.endsWith(';') ? d : `${d};`];
    }
    const changed = section.changed.find((item) => matchesRevertTarget(item.current, target));
    if (!changed) throw new NotFoundError('Target change was not found in schema diff');
    const curTable = ensureSqlServerIndexTable(changed.current, 'Revert changed index');
    const baseDef = changed.base.definition.trim();
    return [
      `${sqlServerDropIndex(changed.current.name, curTable)};`,
      baseDef.endsWith(';') ? baseDef : `${baseDef};`,
    ];
  }

  if (target.resourceType === 'views') {
    const section = diff.views;
    if (target.changeType === 'added') {
      const current = section.added.find((item) => matchesRevertTarget(item, target));
      if (!current) throw new NotFoundError('Target change was not found in schema diff');
      return [`${sqlServerDropView(current.name)};`];
    }
    if (target.changeType === 'removed') {
      const base = section.removed.find((item) => matchesRevertTarget(item, target));
      if (!base) throw new NotFoundError('Target change was not found in schema diff');
      return [toSqlServerCreateViewSql(base.name, base.definition)];
    }
    const changed = section.changed.find((item) => matchesRevertTarget(item.current, target));
    if (!changed) throw new NotFoundError('Target change was not found in schema diff');
    return [
      `${sqlServerDropView(changed.current.name)};`,
      toSqlServerCreateViewSql(changed.base.name, changed.base.definition),
    ];
  }

  if (target.resourceType === 'functions') {
    const section = diff.functions;
    const dropRoutine = (item: SandboxSchemaFunction) =>
      sqlServerDropRoutine(item.name, item.objectType);
    if (target.changeType === 'added') {
      const current = section.added.find((item) => matchesRevertTarget(item, target));
      if (!current) throw new NotFoundError('Target change was not found in schema diff');
      return [dropRoutine(current)];
    }
    if (target.changeType === 'removed') {
      const base = section.removed.find((item) => matchesRevertTarget(item, target));
      if (!base) throw new NotFoundError('Target change was not found in schema diff');
      return [toSqlServerCreateRoutineSql(base.definition)];
    }
    const changed = section.changed.find((item) => matchesRevertTarget(item.current, target));
    if (!changed) throw new NotFoundError('Target change was not found in schema diff');
    return [dropRoutine(changed.current), toSqlServerCreateRoutineSql(changed.base.definition)];
  }

  throw new ValidationError('No revert statements generated for this change');
}
