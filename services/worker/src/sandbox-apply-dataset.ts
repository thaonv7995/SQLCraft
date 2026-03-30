import type { Logger } from 'pino';
import { Pool } from 'pg';
import type { SchemaSqlEngine } from '@sqlcraft/types';
import { fetchDatasetTemplate, fetchSchemaTemplate } from './db';
import { loadDatasetIntoSandbox } from './dataset-loader';
import { runSqlcmdInSandboxContainer } from './docker';
import { buildCreateTableDdlSqlServer } from './sqlserver-schema-ddl';

function sandboxConnStr(host: string, dbName: string, port = 5432): string {
  const u = encodeURIComponent(process.env.SANDBOX_DB_USER ?? 'sandbox');
  const p = encodeURIComponent(process.env.SANDBOX_DB_PASSWORD ?? 'sandbox');
  return `postgresql://${u}:${p}@${host}:${port}/${dbName}`;
}

function stripInlinePrimaryKey(type: string): string {
  return type.replace(/\bPRIMARY\s+KEY\b/gi, '').replace(/\s{2,}/g, ' ').trim();
}

function buildCreateTableDdl(
  tables: Array<{ name: string; columns: Array<{ name: string; type: string }> }>,
): string[] {
  return tables.map((table) => {
    const primaryKeyColumns = table.columns
      .filter((column) => /\bPRIMARY\s+KEY\b/i.test(column.type))
      .map((column) => column.name);

    const columnDefinitions = table.columns.map((column) => {
      const normalizedType =
        primaryKeyColumns.length > 0 ? stripInlinePrimaryKey(column.type) : column.type;
      return `  "${column.name}" ${normalizedType}`;
    });

    const tableConstraints =
      primaryKeyColumns.length > 0
        ? [`  PRIMARY KEY (${primaryKeyColumns.map((column) => `"${column}"`).join(', ')})`]
        : [];

    return (
      `CREATE TABLE IF NOT EXISTS "${table.name}" (\n` +
      [...columnDefinitions, ...tableConstraints].join(',\n') +
      '\n);'
    );
  });
}

/**
 * Same behavior as the former `applySchemaAndDatasetInner` in `index.ts` — shared with
 * sandbox provisioning and golden-bake snapshot generation.
 */
export async function applySchemaAndDatasetToContainer(params: {
  logger: Logger;
  sandboxInstanceId: string;
  containerRef: string;
  dbName: string;
  schemaTemplateId: string | null;
  datasetTemplateId: string | null;
  engine: SchemaSqlEngine;
  sandboxUser: string;
  sandboxPassword: string;
  mssqlSaPassword: string;
  /**
   * Golden-bake must restore from the raw artifact (not a prior snapshot). User sandbox
   * provisioning should omit this (default false) so `sandboxGoldenSnapshotUrl` is used when set.
   */
  preferArtifactOverGoldenSnapshot?: boolean;
  /** Pass -f (force) to mysql client during dataset restore — continues past duplicate key errors. */
  mysqlForce?: boolean;
}): Promise<void> {
  const {
    logger,
    sandboxInstanceId,
    containerRef,
    dbName,
    schemaTemplateId,
    datasetTemplateId,
    engine,
    sandboxUser,
    sandboxPassword,
    mssqlSaPassword,
    preferArtifactOverGoldenSnapshot = false,
    mysqlForce,
  } = params;

  const [schemaDef, datasetTemplate] = await Promise.all([
    schemaTemplateId ? fetchSchemaTemplate(schemaTemplateId) : Promise.resolve(null),
    datasetTemplateId ? fetchDatasetTemplate(datasetTemplateId) : Promise.resolve(null),
  ]);

  let schemaApplied = false;

  const ensureSchemaApplied = async (): Promise<void> => {
    if (schemaApplied || !schemaDef?.tables?.length) {
      return;
    }

    const schemaStartedAt = Date.now();

    if (engine === 'postgresql') {
      const ddlStatements = buildCreateTableDdl(schemaDef.tables);
      const sandboxPool = new Pool({
        connectionString: sandboxConnStr(containerRef, dbName),
        max: 1,
      });

      try {
        for (const ddl of ddlStatements) {
          await sandboxPool.query(ddl);
        }
        schemaApplied = true;
        logger.info(
          {
            sandboxInstanceId,
            dbName,
            tableCount: ddlStatements.length,
            durationMs: Date.now() - schemaStartedAt,
          },
          'Schema DDL applied',
        );
      } finally {
        await sandboxPool.end();
      }
      return;
    }

    if (engine === 'sqlserver') {
      const sql = buildCreateTableDdlSqlServer(schemaDef.tables);
      await runSqlcmdInSandboxContainer({
        containerRef,
        saPassword: mssqlSaPassword,
        dbName,
        sql,
      });
      schemaApplied = true;
      logger.info(
        {
          sandboxInstanceId,
          dbName,
          tableCount: schemaDef.tables.length,
          durationMs: Date.now() - schemaStartedAt,
        },
        'SQL Server schema DDL applied from template',
      );
    }
  };

  const artifactIncludesSchema =
    Boolean(datasetTemplate?.artifactUrl) && schemaDef?.metadata?.source === 'sql_dump';

  if (schemaDef?.tables?.length && engine !== 'postgresql' && !artifactIncludesSchema) {
    throw new Error(
      `Template schema DDL is only auto-applied for PostgreSQL; use a self-contained SQL dump artifact or a PostgreSQL template (engine=${engine})`,
    );
  }

  if (artifactIncludesSchema) {
    logger.info(
      { sandboxInstanceId, datasetTemplateId, schemaTemplateId },
      'Skipping upfront schema DDL because artifact is self-contained',
    );
  } else {
    await ensureSchemaApplied();
  }

  if (!datasetTemplateId) {
    logger.info({ sandboxInstanceId }, 'No dataset template linked, skipping dataset load');
    return;
  }

  const datasetLoadStartedAt = Date.now();
  if (!datasetTemplate) {
    throw new Error(`Dataset template not found: ${datasetTemplateId}`);
  }

  await loadDatasetIntoSandbox({
    logger,
    containerRef,
    dbUser: sandboxUser,
    dbPassword: sandboxPassword,
    dbName,
    engine,
    mssqlSaPassword,
    datasetTemplate,
    schema: schemaDef,
    ensureSchemaApplied,
    preferArtifactOverGoldenSnapshot,
    mysqlForce,
  });

  logger.info(
    {
      sandboxInstanceId,
      datasetTemplateId,
      durationMs: Date.now() - datasetLoadStartedAt,
    },
    'Dataset load applied',
  );
}
