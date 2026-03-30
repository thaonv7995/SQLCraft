import { normalizeSchemaSqlEngine, type SchemaSqlEngine } from '@sqlcraft/types';
import { buildPostgresSandboxConnectionString } from './connection-strings';
import { fetchPostgresSandboxSchemaSnapshot } from './fetch-postgres';
import { fetchMysqlFamilySandboxSchemaSnapshot, type MysqlFamilyConnectionParams } from './fetch-mysql';
import { fetchSqlServerSandboxSchemaSnapshot } from './fetch-sqlserver';
import type { SandboxSchemaSnapshot } from './types';

export type SandboxDbConnectionParams = MysqlFamilyConnectionParams;

export class UnsupportedSchemaDiffEngineError extends Error {
  constructor(
    public readonly engine: SchemaSqlEngine,
    message?: string,
  ) {
    super(message ?? `Schema diff introspection is not implemented for engine: ${engine}`);
    this.name = 'UnsupportedSchemaDiffEngineError';
  }
}

/**
 * Introspect the live sandbox for schema diff (PostgreSQL, MySQL/MariaDB, SQL Server).
 * SQLite throws {@link UnsupportedSchemaDiffEngineError} (no network sandbox). Other engines throw the same.
 */
export async function fetchSandboxSchemaSnapshotForEngine(
  engine: SchemaSqlEngine | string,
  params: SandboxDbConnectionParams,
): Promise<SandboxSchemaSnapshot> {
  const e = normalizeSchemaSqlEngine(engine);

  if (e === 'postgresql') {
    const cs = buildPostgresSandboxConnectionString({
      host: params.host,
      port: params.port,
      user: params.user,
      password: params.password,
      database: params.database,
    });
    return fetchPostgresSandboxSchemaSnapshot(cs);
  }

  if (e === 'mysql' || e === 'mariadb') {
    return fetchMysqlFamilySandboxSchemaSnapshot(params);
  }

  if (e === 'sqlserver') {
    return fetchSqlServerSandboxSchemaSnapshot(params);
  }

  if (e === 'sqlite') {
    throw new UnsupportedSchemaDiffEngineError(
      e,
      'Schema diff is not available for SQLite: lab sandboxes are not run as network databases in this deployment.',
    );
  }

  throw new UnsupportedSchemaDiffEngineError(e);
}
