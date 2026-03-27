import 'dotenv/config';
import { Worker, Queue, type Job } from 'bullmq';
import IORedis from 'ioredis';
import { Pool } from 'pg';
import pino from 'pino';
import {
  mainDb,
  fetchDatasetTemplate,
  fetchSchemaTemplate,
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
} from './db';
import { loadDatasetIntoSandbox } from './dataset-loader';
import {
  executeSql,
  getExplainPlan,
  shapeResults,
  validateSql,
  QueryBlockedError,
  QueryTimeoutError,
} from './query-executor';
import {
  createSandboxContainer,
  ensureSandboxContainerRemoved,
  sandboxContainerName,
  waitForSandboxPostgres,
} from './docker';

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

// Session TTL: 2 hours
const SESSION_TTL_MS = 2 * 60 * 60 * 1000;
// Expiry scanner interval: 5 minutes
const EXPIRY_SCAN_INTERVAL_MS = 5 * 60 * 1000;

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

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Generate a safe PostgreSQL database name from the sandbox UUID */
function sandboxDbName(sandboxId: string): string {
  return `s_${sandboxId.replace(/-/g, '').slice(0, 16)}`;
}

/** Build a connection string pointing to a specific sandbox database */
function sandboxConnStr(host: string, dbName: string, port = 5432): string {
  return `postgresql://${sandboxUser}:${sandboxPassword}@${host}:${port}/${dbName}`;
}

function stripInlinePrimaryKey(type: string): string {
  return type.replace(/\bPRIMARY\s+KEY\b/gi, '').replace(/\s{2,}/g, ' ').trim();
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

async function applySchemaAndDataset(params: {
  sandboxInstanceId: string;
  containerRef: string;
  dbName: string;
  schemaTemplateId: string | null;
  datasetTemplateId: string | null;
}): Promise<void> {
  const { sandboxInstanceId, containerRef, dbName, schemaTemplateId, datasetTemplateId } = params;
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
  };

  const artifactIncludesSchema =
    Boolean(datasetTemplate?.artifactUrl) && schemaDef?.metadata?.source === 'sql_dump';

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
    dbName,
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

// ─── Worker: provision_sandbox ────────────────────────────────────────────────

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
      await createSandboxContainer({
        containerRef,
        dbName,
        dbUser: sandboxUser,
        dbPassword: sandboxPassword,
        sandboxId: sandboxInstanceId,
      });
      await waitForSandboxPostgres({ containerRef, dbUser: sandboxUser, dbName });
      logger.info({ containerRef, dbName }, 'Sandbox container ready');

      await applySchemaAndDataset({
        sandboxInstanceId,
        containerRef,
        dbName,
        schemaTemplateId,
        datasetTemplateId,
      });

      const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
      await updateSandboxReady(sandboxInstanceId, dbName, containerRef, expiresAt);
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
  queueOptions,
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
  queueOptions,
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
      await createSandboxContainer({
        containerRef,
        dbName,
        dbUser: sandboxUser,
        dbPassword: sandboxPassword,
        sandboxId: sandboxInstanceId,
      });
      await waitForSandboxPostgres({ containerRef, dbUser: sandboxUser, dbName });

      await applySchemaAndDataset({
        sandboxInstanceId,
        containerRef,
        dbName,
        schemaTemplateId: sandbox.schemaTemplateId,
        datasetTemplateId: sandbox.datasetTemplateId,
      });

      const newExpiresAt = new Date(Date.now() + SESSION_TTL_MS);
      await updateSandboxReady(sandboxInstanceId, dbName, containerRef, newExpiresAt);
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
  queueOptions,
);

// ─── Worker: execute_query ────────────────────────────────────────────────────

const queryExecutionWorker = new Worker(
  QUEUES.QUERY_EXECUTION,
  async (job: Job) => {
    const { queryExecutionId, sandboxInstanceId, sql, explainPlan, planMode } = job.data as {
      queryExecutionId: string;
      sandboxInstanceId: string;
      sql: string;
      explainPlan?: boolean;
      planMode?: 'explain' | 'explain_analyze';
    };

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

    // Pre-validate
    const validation = validateSql(sql);
    if (!validation.valid) {
      await updateQueryExecutionFailed(
        queryExecutionId,
        'blocked',
        validation.reason ?? 'Blocked',
      );
      return;
    }

    await updateQueryExecutionRunning(queryExecutionId);

    const connStr = sandboxConnStr(
      sandbox.containerRef ?? sandboxHost,
      sandbox.dbName,
      sandbox.containerRef ? 5432 : Number(sandboxPort),
    );

    try {
      const result = await executeSql(connStr, sql);
      const preview = shapeResults(result);

      await updateQueryExecutionSuccess(
        queryExecutionId,
        result.durationMs,
        result.rowCount,
        preview,
      );

      if (explainPlan) {
        const mode = planMode ?? 'explain';
        try {
          const plan = await getExplainPlan(connStr, sql, mode);
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
        { queryExecutionId, durationMs: result.durationMs, rows: result.rowCount },
        'Query succeeded',
      );
    } catch (err: unknown) {
      if (err instanceof QueryTimeoutError) {
        await updateQueryExecutionFailed(queryExecutionId, 'timed_out', err.message);
      } else if (err instanceof QueryBlockedError) {
        await updateQueryExecutionFailed(queryExecutionId, 'blocked', err.message);
      } else {
        const message = err instanceof Error ? err.message : 'Unknown error';
        const durationMs = (err as { durationMs?: number }).durationMs;
        await updateQueryExecutionFailed(queryExecutionId, 'failed', message, durationMs);
      }
      logger.warn({ queryExecutionId, err }, 'Query execution failed');
    }
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
