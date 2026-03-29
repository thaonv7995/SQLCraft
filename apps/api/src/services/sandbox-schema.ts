import { config } from '../lib/config';
import {
  parseBaseSchemaSnapshot,
  fetchSandboxSchemaSnapshot as fetchSnapshotFromConnectionString,
  diffSandboxSchema,
  buildPostgresSandboxConnectionString,
  type SandboxSchemaDiff,
  type SandboxSchemaDiffSection,
  type SandboxSchemaFunction,
  type SandboxSchemaIndex,
  type SandboxSchemaMaterializedView,
  type SandboxSchemaPartition,
  type SandboxSchemaSnapshot,
  type SandboxSchemaView,
} from '@sqlcraft/sandbox-schema-diff';

export type {
  SandboxSchemaDiff,
  SandboxSchemaDiffSection,
  SandboxSchemaFunction,
  SandboxSchemaIndex,
  SandboxSchemaMaterializedView,
  SandboxSchemaPartition,
  SandboxSchemaSnapshot,
  SandboxSchemaView,
};

export { parseBaseSchemaSnapshot, diffSandboxSchema };

export async function fetchSandboxSchemaSnapshot(params: {
  dbName: string;
  containerRef: string | null;
}): Promise<SandboxSchemaSnapshot> {
  const connectionString = buildPostgresSandboxConnectionString({
    host: params.containerRef ?? config.SANDBOX_DB_HOST,
    port: params.containerRef ? 5432 : config.SANDBOX_DB_PORT,
    user: config.SANDBOX_DB_USER,
    password: config.SANDBOX_DB_PASSWORD,
    database: params.dbName,
  });
  return fetchSnapshotFromConnectionString(connectionString);
}
