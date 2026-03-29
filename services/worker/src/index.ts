import 'dotenv/config';
import { Worker, Queue, type Job } from 'bullmq';
import IORedis from 'ioredis';
import { Pool } from 'pg';
import pino from 'pino';
import {
  mainDb,
  fetchDatasetTemplate,
  fetchSchemaTemplate,
  fetchSchemaTemplateSandboxMeta,
  fetchSandbox,
  updateSandboxReady,
  updateSandboxStatus,
  updateSessionStatus,
  touchLearningSessionActivity,
  updateQueryExecutionRunning,
  updateQueryExecutionSuccess,
  updateQueryExecutionFailed,
  insertQueryExecutionPlan,
  fetchExpiredSandboxes,
  fetchQueryExecutionForCancel,
  tryMarkQueryExecutionCancelled,
  updateQueryExecutionBackendPid,
} from './db';
import { loadDatasetIntoSandbox } from './dataset-loader';
import { normalizeSchemaSqlEngine, type SchemaSqlEngine } from '@sqlcraft/types';
import {
  executeSqlOnTarget,
  getExplainPlanOnTarget,
  shapeResults,
  validateSql,
  probeSandboxConnection,
  type SandboxDbTarget,
  QueryBlockedError,
  QueryTimeoutError,
  QueryCancelledError,
  cancelBackendQuery,
} from './query-executor';
import {
  createSandboxEngineContainer,
  ensureSandboxContainerRemoved,
  sandboxContainerName,
  waitForSandboxEngine,
  initSqlServerDatabase,
  runSqlcmdInSandboxContainer,
} from './docker';
import { buildCreateTableDdlSqlServer } from './sqlserver-schema-ddl';
import { resolveSandboxEngineSpec } from './sandbox-engine-image';

const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  transport:
    process.env.NODE_ENV !== 'production'
      ? { target: 'pino-pretty', options: { colorize: true } }
      : undefined,
});

// ─── Config ───────────────────────────────────────────────────────────────────

const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379';
const queuePrefix = process.env.QUEUE_PREFIX?.trim() || undefined;
const sandboxHost = process.env.SANDBOX_DB_HOST ?? 'localhost';
const sandboxPort = process.env.SANDBOX_DB_PORT ?? '5433';
const sandboxUser = process.env.SANDBOX_DB_USER ?? 'sandbox';
const sandboxPassword = process.env.SANDBOX_DB_PASSWORD ?? 'sandbox';

/** SQL Server enforces strong SA passwords; default `sandbox` (7 chars) prevents the engine from starting. */
function mssqlSaPasswordMeetsPolicy(p: string): boolean {
  return (
    p.length >= 8 &&
    /[a-z]/.test(p) &&
    /[A-Z]/.test(p) &&
    /[0-9]/.test(p) &&
    /[^A-Za-z0-9]/.test(p)
  );
}

const mssqlSaPassword = (() => {
  const fromEnv = process.env.SANDBOX_MSSQL_SA_PASSWORD?.trim();
  if (fromEnv && mssqlSaPasswordMeetsPolicy(fromEnv)) {
    return fromEnv;
  }
  if (fromEnv) {
    console.warn(
      '[worker] SANDBOX_MSSQL_SA_PASSWORD does not meet SQL Server SA complexity; using dev fallback SqlForge1!Sb',
    );
  }
  if (mssqlSaPasswordMeetsPolicy(sandboxPassword)) {
    return sandboxPassword;
  }
  return 'SqlForge1!Sb';
})();

// Session TTL: 2 hours
const SESSION_TTL_MS = 2 * 60 * 60 * 1000;
// Expiry scanner interval: 5 minutes
const EXPIRY_SCAN_INTERVAL_MS = 5 * 60 * 1000;
// Total timeout for dataset restore (schema + data load); 0 = no limit.
const DATASET_RESTORE_TIMEOUT_MS = Math.max(
  0,
  Number(process.env.SANDBOX_DATASET_RESTORE_TIMEOUT_MS) || 10 * 60 * 1000,
);

// ─── Redis connection ─────────────────────────────────────────────────────────

const connection = new IORedis(redisUrl, { maxRetriesPerRequest: null });
connection.on('connect', () => logger.info({ redisUrl }, 'Redis connected'));
connection.on('error', (err) => logger.error({ err }, 'Redis connection error'));

// ─── Queue names ──────────────────────────────────────────────────────────────

const QUEUES = {
  SANDBOX_PROVISIONING: 'sandbox-provisioning',
  SANDBOX_CLEANUP: 'sandbox-cleanup',
  SANDBOX_RESET: 'sandbox-reset',
  QUERY_EXECUTION: 'query-execution',
} as const;

// Queue client used by the expiry scanner to enqueue cleanup jobs
type BullConnection = import('bullmq').ConnectionOptions;
const conn = connection as unknown as BullConnection;
const queueOptions = queuePrefix ? { connection: conn, prefix: queuePrefix } : { connection: conn };
const cleanupQueue = new Queue(QUEUES.SANDBOX_CLEANUP, queueOptions);
const queryExecutionQueueClient = new Queue(QUEUES.QUERY_EXECUTION, queueOptions);

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Generate a safe PostgreSQL database name from the sandbox UUID */
function sandboxDbName(sandboxId: string): string {
  return `s_${sandboxId.replace(/-/g, '').slice(0, 16)}`;
}

/** Build a connection string pointing to a specific sandbox database (PostgreSQL only). */
function sandboxConnStr(host: string, dbName: string, port = 5432): string {
  const u = encodeURIComponent(sandboxUser);
  const p = encodeURIComponent(sandboxPassword);
  return `postgresql://${u}:${p}@${host}:${port}/${dbName}`;
}

function sandboxTargetForProbe(params: {
  engine: SchemaSqlEngine;
  containerRef: string;
  dbName: string;
  internalPort: number;
}): SandboxDbTarget {
  const { engine, containerRef, dbName, internalPort } = params;
  return {
    engine,
    host: containerRef,
    port: internalPort,
    user: engine === 'sqlserver' ? 'sa' : sandboxUser,
    password: engine === 'sqlserver' ? mssqlSaPassword : sandboxPassword,
    database: dbName,
  };
}

async function waitForSandboxDbReady(params: {
  engine: SchemaSqlEngine;
  containerRef: string;
  dbName: string;
  internalPort: number;
  timeoutMs?: number;
}): Promise<void> {
  const target = sandboxTargetForProbe(params);
  const startedAt = Date.now();
  const timeoutMs = params.timeoutMs ?? 45_000;
  let lastError: unknown;

  while (Date.now() - startedAt < timeoutMs) {
    try {
      await probeSandboxConnection(target, Math.min(5_000, timeoutMs - (Date.now() - startedAt)));
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }

  const reason =
    lastError && typeof lastError === 'object' && 'message' in lastError
      ? String((lastError as { message?: unknown }).message ?? '')
      : 'timeout';
  throw new Error(`Sandbox ${params.containerRef} DB readiness check timed out: ${reason}`);
}

function stripInlinePrimaryKey(type: string): string {
  return type.replace(/\bPRIMARY\s+KEY\b/gi, '').replace(/\s{2,}/g, ' ').trim();
}

async function resolveEngineSpecForSandbox(schemaTemplateId: string | null) {
  const meta = schemaTemplateId ? await fetchSchemaTemplateSandboxMeta(schemaTemplateId) : null;
  return resolveSandboxEngineSpec({
    dialectRaw: meta?.dialect ?? 'postgresql',
    engineVersion: meta?.engineVersion ?? null,
  });
}

/** Generate CREATE TABLE DDL from a parsed schema definition */
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

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  if (timeoutMs <= 0) return promise;
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`${label} timed out after ${Math.round(timeoutMs / 1000)}s`)),
      timeoutMs,
    );
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (err) => { clearTimeout(timer); reject(err); },
    );
  });
}

async function applySchemaAndDatasetInner(params: {
  sandboxInstanceId: string;
  containerRef: string;
  dbName: string;
  schemaTemplateId: string | null;
  datasetTemplateId: string | null;
  engine: SchemaSqlEngine;
}): Promise<void> {
  const { sandboxInstanceId, containerRef, dbName, schemaTemplateId, datasetTemplateId, engine } = params;
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

async function applySchemaAndDataset(params: {
  sandboxInstanceId: string;
  containerRef: string;
  dbName: string;
  schemaTemplateId: string | null;
  datasetTemplateId: string | null;
  engine: SchemaSqlEngine;
}): Promise<void> {
  const inner = applySchemaAndDatasetInner(params);
  if (DATASET_RESTORE_TIMEOUT_MS > 0) {
    return withTimeout(inner, DATASET_RESTORE_TIMEOUT_MS, 'applySchemaAndDataset');
  }
  return inner;
}

// ─── Worker: provision_sandbox ────────────────────────────────────────────────

const LONG_JOB_LOCK_DURATION_MS = 10 * 60 * 1000;
const LONG_JOB_STALLED_INTERVAL_MS = 5 * 60 * 1000;
const longJobOpts = {
  ...queueOptions,
  lockDuration: LONG_JOB_LOCK_DURATION_MS,
  stalledInterval: LONG_JOB_STALLED_INTERVAL_MS,
};

const sandboxProvisioningWorker = new Worker(
  QUEUES.SANDBOX_PROVISIONING,
  async (job: Job) => {
    const { sandboxInstanceId, learningSessionId, schemaTemplateId, datasetTemplateId } = job.data as {
      sandboxInstanceId: string;
      learningSessionId: string;
      schemaTemplateId: string | null;
      datasetTemplateId: string | null;
    };

    logger.info({ sandboxInstanceId, learningSessionId }, 'Provisioning sandbox');

    await updateSandboxStatus(sandboxInstanceId, 'provisioning');

    const dbName = sandboxDbName(sandboxInstanceId);
    const containerRef = sandboxContainerName(sandboxInstanceId);

    try {
      const spec = await resolveEngineSpecForSandbox(schemaTemplateId);
      if (spec.engine === 'sqlite') {
        throw new Error('SQLite templates cannot use Docker sandboxes');
      }
      await createSandboxEngineContainer({
        containerRef,
        engine: spec.engine,
        dockerImage: spec.dockerImage,
        dbName,
        dbUser: sandboxUser,
        dbPassword: sandboxPassword,
        sandboxId: sandboxInstanceId,
        mssqlSaPassword,
      });
      await waitForSandboxEngine({
        engine: spec.engine,
        containerRef,
        dbUser: sandboxUser,
        dbName,
        dbPassword: sandboxPassword,
        mssqlSaPassword,
      });
      if (spec.engine === 'sqlserver') {
        await initSqlServerDatabase({
          containerRef,
          saPassword: mssqlSaPassword,
          dbName,
        });
      }
      await waitForSandboxDbReady({
        engine: spec.engine,
        containerRef,
        dbName,
        internalPort: spec.internalPort,
      });
      logger.info({ containerRef, dbName, engine: spec.engine }, 'Sandbox container ready');

      await applySchemaAndDataset({
        sandboxInstanceId,
        containerRef,
        dbName,
        schemaTemplateId,
        datasetTemplateId,
        engine: spec.engine,
      });

      const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
      await updateSandboxReady(
        sandboxInstanceId,
        dbName,
        containerRef,
        expiresAt,
        spec.engine,
        spec.internalPort,
      );
      await updateSessionStatus(learningSessionId, 'active');
      await touchLearningSessionActivity(learningSessionId);

      logger.info({ sandboxInstanceId, containerRef, dbName, expiresAt }, 'Sandbox ready');
    } catch (err) {
      logger.error({ err, sandboxInstanceId }, 'Sandbox provisioning failed');
      await ensureSandboxContainerRemoved(containerRef).catch((cleanupErr) =>
        logger.warn({ cleanupErr, containerRef }, 'Failed to remove sandbox container after provisioning error'),
      );
      await updateSandboxStatus(sandboxInstanceId, 'failed');
      await updateSessionStatus(learningSessionId, 'failed');
      throw err;
    }
  },
  longJobOpts,
);

// ─── Worker: destroy_sandbox ──────────────────────────────────────────────────

const sandboxCleanupWorker = new Worker(
  QUEUES.SANDBOX_CLEANUP,
  async (job: Job) => {
    const { sandboxInstanceId, learningSessionId } = job.data as {
      sandboxInstanceId: string;
      learningSessionId: string;
    };

    logger.info({ sandboxInstanceId }, 'Destroying sandbox');

    const sandbox = await fetchSandbox(sandboxInstanceId);

    if (!sandbox) {
      logger.warn({ sandboxInstanceId }, 'Sandbox not found, skipping cleanup');
      return;
    }

    if (sandbox.status === 'destroyed') {
      logger.info({ sandboxInstanceId }, 'Sandbox already destroyed');
      return;
    }

    await updateSandboxStatus(sandboxInstanceId, 'expiring');

    if (sandbox.containerRef) {
      try {
        await ensureSandboxContainerRemoved(sandbox.containerRef);
        logger.info({ containerRef: sandbox.containerRef }, 'Sandbox container removed');
      } catch (err) {
        logger.error({ err, sandboxInstanceId }, 'Failed to remove sandbox container');
        await updateSandboxStatus(sandboxInstanceId, 'failed');
        throw err;
      }
    }

    await updateSandboxStatus(sandboxInstanceId, 'destroyed');

    // Expire the session if it hasn't ended/failed already
    const sessionResult = await mainDb.query(
      'SELECT status FROM learning_sessions WHERE id = $1',
      [learningSessionId],
    );
    const sessionStatus: string | undefined = sessionResult.rows[0]?.status;
    if (sessionStatus && !['ended', 'expired', 'failed'].includes(sessionStatus)) {
      await updateSessionStatus(learningSessionId, 'expired');
    }

    logger.info({ sandboxInstanceId }, 'Sandbox destroyed');
  },
  longJobOpts,
);

// ─── Worker: reset_sandbox ────────────────────────────────────────────────────

const sandboxResetWorker = new Worker(
  QUEUES.SANDBOX_RESET,
  async (job: Job) => {
    const { sandboxInstanceId } = job.data as {
      sandboxInstanceId: string;
      learningSessionId: string;
    };

    logger.info({ sandboxInstanceId }, 'Resetting sandbox');

    const sandbox = await fetchSandbox(sandboxInstanceId);

    if (!sandbox) {
      logger.warn({ sandboxInstanceId }, 'Sandbox not found, cannot reset');
      await updateSandboxStatus(sandboxInstanceId, 'failed');
      return;
    }

    const dbName = sandbox.dbName ?? sandboxDbName(sandboxInstanceId);
    const containerRef = sandbox.containerRef ?? sandboxContainerName(sandboxInstanceId);

    try {
      await ensureSandboxContainerRemoved(containerRef);
      const spec = await resolveEngineSpecForSandbox(sandbox.schemaTemplateId);
      if (spec.engine === 'sqlite') {
        throw new Error('SQLite templates cannot use Docker sandboxes');
      }
      await createSandboxEngineContainer({
        containerRef,
        engine: spec.engine,
        dockerImage: spec.dockerImage,
        dbName,
        dbUser: sandboxUser,
        dbPassword: sandboxPassword,
        sandboxId: sandboxInstanceId,
        mssqlSaPassword,
      });
      await waitForSandboxEngine({
        engine: spec.engine,
        containerRef,
        dbUser: sandboxUser,
        dbName,
        dbPassword: sandboxPassword,
        mssqlSaPassword,
      });
      if (spec.engine === 'sqlserver') {
        await initSqlServerDatabase({
          containerRef,
          saPassword: mssqlSaPassword,
          dbName,
        });
      }
      await waitForSandboxDbReady({
        engine: spec.engine,
        containerRef,
        dbName,
        internalPort: spec.internalPort,
      });

      await applySchemaAndDataset({
        sandboxInstanceId,
        containerRef,
        dbName,
        schemaTemplateId: sandbox.schemaTemplateId,
        datasetTemplateId: sandbox.datasetTemplateId,
        engine: spec.engine,
      });

      const newExpiresAt = new Date(Date.now() + SESSION_TTL_MS);
      await updateSandboxReady(
        sandboxInstanceId,
        dbName,
        containerRef,
        newExpiresAt,
        spec.engine,
        spec.internalPort,
      );
      await touchLearningSessionActivity(sandbox.learningSessionId);

      logger.info({ sandboxInstanceId, containerRef }, 'Sandbox reset complete');
    } catch (err) {
      logger.error({ err, sandboxInstanceId }, 'Sandbox reset failed');
      await ensureSandboxContainerRemoved(containerRef).catch((cleanupErr) =>
        logger.warn({ cleanupErr, containerRef }, 'Failed to remove sandbox container after reset error'),
      );
      await updateSandboxStatus(sandboxInstanceId, 'failed');
      throw err;
    }
  },
  longJobOpts,
);

// ─── Worker: execute_query / cancel_query ─────────────────────────────────────

async function handleCancelQueryJob(job: Job): Promise<void> {
  const { queryExecutionId } = job.data as { queryExecutionId: string };
  const row = await fetchQueryExecutionForCancel(queryExecutionId);
  if (!row) return;
  if (['succeeded', 'failed', 'timed_out', 'blocked', 'cancelled'].includes(row.status)) {
    return;
  }

  if (row.bullJobId) {
    const queued = await queryExecutionQueueClient.getJob(row.bullJobId);
    if (queued) {
      const st = await queued.getState();
      if (st === 'waiting' || st === 'delayed') {
        await queued.remove();
      }
    }
  }

  const sandbox = row.sandboxInstanceId ? await fetchSandbox(row.sandboxInstanceId) : null;
  if (!sandbox?.dbName) {
    await tryMarkQueryExecutionCancelled(queryExecutionId, 'Cancelled by user');
    return;
  }

  const engine = normalizeSchemaSqlEngine(sandbox.sandboxEngine);
  const host = sandbox.containerRef ?? sandboxHost;
  const port = sandbox.containerRef ? sandbox.sandboxDbPort : Number(sandboxPort);
  const target: SandboxDbTarget = {
    engine,
    host,
    port,
    user: engine === 'sqlserver' ? 'sa' : sandboxUser,
    password: engine === 'sqlserver' ? mssqlSaPassword : sandboxPassword,
    database: sandbox.dbName,
  };

  let pid = row.dbBackendPid ? Number(row.dbBackendPid) : Number.NaN;
  if (!Number.isFinite(pid) && row.status === 'running') {
    for (let i = 0; i < 15; i += 1) {
      await new Promise<void>((r) => {
        setTimeout(r, 200);
      });
      const again = await fetchQueryExecutionForCancel(queryExecutionId);
      if (!again) return;
      if (['succeeded', 'failed', 'timed_out', 'blocked', 'cancelled'].includes(again.status)) {
        return;
      }
      if (again.dbBackendPid) {
        pid = Number(again.dbBackendPid);
        break;
      }
    }
  }

  if (Number.isFinite(pid)) {
    try {
      await cancelBackendQuery(target, pid);
    } catch (err) {
      logger.warn({ err, queryExecutionId }, 'cancelBackendQuery failed');
    }
  }

  await tryMarkQueryExecutionCancelled(queryExecutionId, 'Cancelled by user');
}

async function handleExecuteQueryJob(job: Job): Promise<void> {
  const { queryExecutionId, sandboxInstanceId, sql, explainPlan, planMode, timeoutMs: jobTimeoutMs } =
    job.data as {
      queryExecutionId: string;
      sandboxInstanceId: string;
      sql: string;
      explainPlan?: boolean;
      planMode?: 'explain' | 'explain_analyze';
      timeoutMs?: number;
    };

  const timeoutMs =
    typeof jobTimeoutMs === 'number' && Number.isFinite(jobTimeoutMs) && jobTimeoutMs >= 1000
      ? jobTimeoutMs
      : Math.max(1000, Number(process.env.QUERY_EXECUTION_TIMEOUT_MS) || 600_000);

  logger.info({ queryExecutionId }, 'Executing query');

  const sandbox = await fetchSandbox(sandboxInstanceId);

  if (!sandbox?.dbName) {
    await updateQueryExecutionFailed(queryExecutionId, 'failed', 'Sandbox not available');
    logger.warn({ sandboxInstanceId }, 'Sandbox not found for query execution');
    return;
  }

  if (sandbox.status === 'destroyed' || sandbox.status === 'failed') {
    await updateQueryExecutionFailed(
      queryExecutionId,
      'failed',
      `Sandbox is in unusable state: ${sandbox.status}`,
    );
    return;
  }

  const engine = normalizeSchemaSqlEngine(sandbox.sandboxEngine);

  // Pre-validate
  const validation = validateSql(sql, engine);
  if (!validation.valid) {
    await updateQueryExecutionFailed(
      queryExecutionId,
      'blocked',
      validation.reason ?? 'Blocked',
    );
    return;
  }

  await updateQueryExecutionRunning(queryExecutionId);

  const host = sandbox.containerRef ?? sandboxHost;
  const port = sandbox.containerRef ? sandbox.sandboxDbPort : Number(sandboxPort);
  const target: SandboxDbTarget = {
    engine,
    host,
    port,
    user: engine === 'sqlserver' ? 'sa' : sandboxUser,
    password: engine === 'sqlserver' ? mssqlSaPassword : sandboxPassword,
    database: sandbox.dbName,
  };

  try {
    const result = await executeSqlOnTarget(target, sql, timeoutMs, undefined, async (backendPid) => {
      await updateQueryExecutionBackendPid(queryExecutionId, backendPid);
    });
    const preview = shapeResults(result);

    const stored = await updateQueryExecutionSuccess(
      queryExecutionId,
      result.durationMs,
      result.rowCount,
      preview,
    );

    if (stored && explainPlan) {
      const mode = planMode ?? 'explain';
      try {
        const plan = await getExplainPlanOnTarget(target, sql, mode);
        await insertQueryExecutionPlan(queryExecutionId, mode, plan.rawPlan, plan.planSummary);
        logger.info(
          {
            queryExecutionId,
            planMode: mode,
            planSummaryTotalCost: plan.planSummary?.totalCost ?? null,
          },
          'Stored query execution plan',
        );
      } catch (planErr) {
        logger.warn(
          {
            planErr,
            queryExecutionId,
            planMode: mode,
            sqlPreview: sql.trim().slice(0, 200),
          },
          'Failed to get/store explain plan (non-fatal); challenge submit may miss planner cost',
        );
      }
    }

    logger.info(
      { queryExecutionId, durationMs: result.durationMs, rows: result.rowCount, stored },
      'Query succeeded',
    );
  } catch (err: unknown) {
    if (err instanceof QueryTimeoutError) {
      await updateQueryExecutionFailed(queryExecutionId, 'timed_out', err.message);
    } else if (err instanceof QueryCancelledError) {
      await updateQueryExecutionFailed(queryExecutionId, 'cancelled', err.message);
    } else if (err instanceof QueryBlockedError) {
      await updateQueryExecutionFailed(queryExecutionId, 'blocked', err.message);
    } else {
      const message = err instanceof Error ? err.message : 'Unknown error';
      const durationMs = (err as { durationMs?: number }).durationMs;
      await updateQueryExecutionFailed(queryExecutionId, 'failed', message, durationMs);
    }
    logger.warn({ queryExecutionId, err }, 'Query execution failed');
  }
}

const queryExecutionWorker = new Worker(
  QUEUES.QUERY_EXECUTION,
  async (job: Job) => {
    if (job.name === 'cancel_query') {
      return handleCancelQueryJob(job);
    }
    return handleExecuteQueryJob(job);
  },
  queueOptions,
);

// ─── Expiry scanner ───────────────────────────────────────────────────────────

async function runExpiryScanner(): Promise<void> {
  try {
    const expired = await fetchExpiredSandboxes();
    if (expired.length === 0) return;

    logger.info({ count: expired.length }, 'Found expired sandboxes, enqueuing cleanup');

    for (const sandbox of expired) {
      // Mark as expiring immediately to prevent duplicate enqueues on next scan
      await updateSandboxStatus(sandbox.id, 'expiring');
      await cleanupQueue.add(
        'destroy_sandbox',
        { sandboxInstanceId: sandbox.id, learningSessionId: sandbox.learningSessionId },
        { attempts: 3, backoff: { type: 'exponential', delay: 2000 } },
      );
    }
  } catch (err) {
    logger.error({ err }, 'Expiry scanner error');
  }
}

const expiryScanner = setInterval(runExpiryScanner, EXPIRY_SCAN_INTERVAL_MS);
runExpiryScanner().catch((err) => logger.error({ err }, 'Initial expiry scan failed'));

// ─── Event listeners ──────────────────────────────────────────────────────────

const workers = [
  { name: QUEUES.SANDBOX_PROVISIONING, worker: sandboxProvisioningWorker },
  { name: QUEUES.SANDBOX_CLEANUP, worker: sandboxCleanupWorker },
  { name: QUEUES.SANDBOX_RESET, worker: sandboxResetWorker },
  { name: QUEUES.QUERY_EXECUTION, worker: queryExecutionWorker },
];

for (const { name, worker } of workers) {
  worker.on('completed', (job) => {
    logger.info({ queue: name, jobId: job.id }, 'Job completed');
  });

  worker.on('failed', (job, err) => {
    logger.error({ queue: name, jobId: job?.id, err }, 'Job failed');
  });

  worker.on('error', (err) => {
    logger.error({ queue: name, err }, 'Worker error');
  });

  logger.info({ queue: name }, 'Worker started');
}

// ─── Graceful shutdown ────────────────────────────────────────────────────────

async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, 'Received shutdown signal, closing workers...');

  clearInterval(expiryScanner);
  await Promise.all(workers.map(({ worker }) => worker.close()));
  await cleanupQueue.close();
  await queryExecutionQueueClient.close();
  await connection.quit();
  await mainDb.end();

  logger.info('All workers stopped. Exiting.');
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

logger.info(
  { queues: Object.values(QUEUES), redisUrl, queuePrefix: queuePrefix ?? 'bull' },
  'SQLCraft worker service started',
);
