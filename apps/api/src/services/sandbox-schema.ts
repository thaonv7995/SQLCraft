import { normalizeSchemaSqlEngine, type SchemaSqlEngine } from '@sqlcraft/types';
import { config } from '../lib/config';
import { readFullObject } from '../lib/storage';
import { ValidationError } from '../lib/errors';
import {
  parseBaseSchemaSnapshot,
  parseStoredSandboxSchemaSnapshot,
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

export { parseBaseSchemaSnapshot, parseStoredSandboxSchemaSnapshot, diffSandboxSchema };

function goldenSchemaObjectKeyFromUrl(url: string, expectedBucket: string): string | null {
  try {
    const u = new URL(url.trim());
    if (!/^s3:$/i.test(u.protocol)) return null;
    if (u.hostname !== expectedBucket) return null;
    const objectName = u.pathname.replace(/^\/+/, '');
    return objectName || null;
  } catch {
    return null;
  }
}

/**
 * Prefer introspected schema captured at golden-bake (matches post-restore DB).
 * Falls back to template JSON + inferred UNIQUE indexes when golden snapshot is missing.
 */
export async function resolveBaseSchemaSnapshot(params: {
  schemaTemplateDefinition: unknown;
  datasetTemplate: {
    sandboxGoldenStatus: string;
    sandboxGoldenSchemaSnapshotUrl: string | null;
  } | null;
}): Promise<SandboxSchemaSnapshot> {
  const { schemaTemplateDefinition, datasetTemplate } = params;
  const url = datasetTemplate?.sandboxGoldenSchemaSnapshotUrl?.trim();
  if (datasetTemplate?.sandboxGoldenStatus === 'ready' && url) {
    try {
      const key = goldenSchemaObjectKeyFromUrl(url, config.STORAGE_BUCKET);
      if (key) {
        const buf = await readFullObject(key);
        const parsed: unknown = JSON.parse(buf.toString('utf8'));
        const snap = parseStoredSandboxSchemaSnapshot(parsed);
        if (snap) {
          return snap;
        }
      }
    } catch {
      /* use template */
    }
  }
  return parseBaseSchemaSnapshot(schemaTemplateDefinition);
}

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
