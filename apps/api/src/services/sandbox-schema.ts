import { normalizeSchemaSqlEngine, type SchemaSqlEngine } from '@sqlcraft/types';
import { config } from '../lib/config';
import { ValidationError } from '../lib/errors';
import {
  parseBaseSchemaSnapshot,
  fetchSandboxSchemaSnapshotForEngine,
  UnsupportedSchemaDiffEngineError,
  diffSandboxSchema,
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

function resolveSandboxIntrospectionPort(
  engine: SchemaSqlEngine,
  usesContainer: boolean,
  sandboxDbPort: number,
): number {
  if (usesContainer) {
    return sandboxDbPort;
  }
  if (engine === 'postgresql') {
    return config.SANDBOX_DB_PORT;
  }
  if (engine === 'mysql' || engine === 'mariadb') {
    return config.SANDBOX_MYSQL_PORT;
  }
  if (engine === 'sqlserver') {
    return config.SANDBOX_MSSQL_PORT;
  }
  return sandboxDbPort;
}

/** Host/port/user/password/database for connecting to a sandbox (introspection or DDL revert). */
export function getSandboxConnectionParams(params: {
  dbName: string;
  containerRef: string | null;
  dialect: string;
  sandboxDbPort: number;
}): { host: string; port: number; user: string; password: string; database: string } {
  const engine = normalizeSchemaSqlEngine(params.dialect);
  const host = params.containerRef ?? config.SANDBOX_DB_HOST;
  const port = resolveSandboxIntrospectionPort(engine, params.containerRef != null, params.sandboxDbPort);

  if (engine === 'sqlserver') {
    return {
      host,
      port,
      user: 'sa',
      password: config.SANDBOX_MSSQL_SA_PASSWORD ?? config.SANDBOX_DB_PASSWORD,
      database: params.dbName,
    };
  }

  return {
    host,
    port,
    user: config.SANDBOX_DB_USER,
    password: config.SANDBOX_DB_PASSWORD,
    database: params.dbName,
  };
}

export async function fetchSandboxSchemaSnapshot(params: {
  dbName: string;
  containerRef: string | null;
  dialect: string;
  sandboxDbPort: number;
}): Promise<SandboxSchemaSnapshot> {
  const engine = normalizeSchemaSqlEngine(params.dialect);
  const { host, port, user, password, database } = getSandboxConnectionParams(params);

  try {
    return await fetchSandboxSchemaSnapshotForEngine(engine, {
      host,
      port,
      user,
      password,
      database,
    });
  } catch (err) {
    if (err instanceof UnsupportedSchemaDiffEngineError) {
      throw new ValidationError(err.message);
    }
    throw err;
  }
}
