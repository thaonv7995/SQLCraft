export interface SandboxSchemaIndex {
  name: string;
  tableName: string;
  definition: string;
}

export interface SandboxSchemaView {
  name: string;
  definition: string;
}

export interface SandboxSchemaMaterializedView {
  name: string;
  definition: string;
}

export interface SandboxSchemaFunction {
  name: string;
  signature: string;
  language: string | null;
  definition: string;
  /** SQL Server: sys.objects.type (P, FN, …) — used for DROP PROCEDURE vs DROP FUNCTION when reverting. */
  objectType?: string | null;
}

export interface SandboxSchemaPartition {
  name: string;
  parentTable: string;
  strategy: string | null;
  definition: string | null;
}

export interface SandboxSchemaSnapshot {
  indexes: SandboxSchemaIndex[];
  views: SandboxSchemaView[];
  materializedViews: SandboxSchemaMaterializedView[];
  functions: SandboxSchemaFunction[];
  partitions: SandboxSchemaPartition[];
}

export interface SandboxSchemaDiffSection<T> {
  base: T[];
  current: T[];
  added: T[];
  removed: T[];
  changed: Array<{ base: T; current: T }>;
}

export interface SandboxSchemaDiff {
  hasChanges: boolean;
  indexes: SandboxSchemaDiffSection<SandboxSchemaIndex>;
  views: SandboxSchemaDiffSection<SandboxSchemaView>;
  materializedViews: SandboxSchemaDiffSection<SandboxSchemaMaterializedView>;
  functions: SandboxSchemaDiffSection<SandboxSchemaFunction>;
  partitions: SandboxSchemaDiffSection<SandboxSchemaPartition>;
}

/** Compact snapshot stored on query execution rows (PostgreSQL sandboxes). */
export interface QuerySchemaDiffSnapshot {
  schemaTemplateId: string;
  hasChanges: boolean;
  totalChanges: number;
  brief: string;
}
