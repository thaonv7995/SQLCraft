import 'dotenv/config';
import { Worker, Queue, type Job } from 'bullmq';
import IORedis from 'ioredis';
import pino from 'pino';
import {
  buildPostgresSandboxConnectionString,
  diffSandboxSchema,
  fetchSandboxSchemaSnapshot,
  parseBaseSchemaSnapshot,
  summarizeSandboxSchemaDiff,
  type QuerySchemaDiffSnapshot,
} from '@sqlcraft/sandbox-schema-diff';
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
  updateDatasetGoldenBakeFailed,
  fetchDatasetTemplateIdsPendingGoldenBake,
} from './db';
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
  statS3ObjectSizeViaMinioContainer,
} from './docker';
import { resolveSandboxEngineSpec } from './sandbox-engine-image';
import { sandboxDbNameFromInstanceId } from './sandbox-naming';
import { applySchemaAndDatasetToContainer } from './sandbox-apply-dataset';
import { waitForSandboxDbReady } from './sandbox-wait-ready';
import { runDatasetGoldenBake } from './dataset-golden-bake';

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
// Re-enqueue pending golden-bake jobs (idempotent jobIds); default 5 minutes
const GOLDEN_BAKE_SCAN_INTERVAL_MS = Math.max(
  30_000,
  Number(process.env.GOLDEN_BAKE_SCAN_INTERVAL_MS) || 5 * 60 * 1000,
);
// Total timeout for dataset restore (schema + data load); 0 = no limit.
// Default raised from 10 min → 30 min to handle multi-GB dumps without premature timeout.
const DATASET_RESTORE_TIMEOUT_MS = Math.max(
  0,
  Number(process.env.SANDBOX_DATASET_RESTORE_TIMEOUT_MS) || 30 * 60 * 1000,
);

/**
 * Split heavy sandbox work (Docker, restore) from interactive query jobs so long restores
 * do not share one Node event loop with query execution.
 * - `all`: single process (legacy / dev convenience).
 * - `sandbox`: sandbox-provisioning, sandbox-cleanup, sandbox-reset + expiry scanner.
 * - `query`: query-execution only (no Docker socket).
 */
type WorkerRole = 'all' | 'sandbox' | 'query';
function resolveWorkerRole(): WorkerRole {
  const raw = (process.env.WORKER_ROLE ?? 'all').trim().toLowerCase();
  if (raw === 'sandbox' || raw === 'sandbox-only') return 'sandbox';
  if (raw === 'query' || raw === 'query-only') return 'query';
  if (raw === 'all' || raw === '') return 'all';
  logger.warn({ raw }, 'Invalid WORKER_ROLE, defaulting to all');
  return 'all';
}
const workerRole = resolveWorkerRole();
const sandboxQueuesEnabled = workerRole === 'all' || workerRole === 'sandbox';
const queryQueueEnabled = workerRole === 'all' || workerRole === 'query';

/** Parallel query jobs when `WORKER_ROLE=query` (default 4). With `all`, default 1. */
const queryWorkerConcurrency = Math.max(
  1,
  Math.min(
    64,
    Number(process.env.QUERY_WORKER_CONCURRENCY) ||
      (workerRole === 'query' ? 4 : 1),
  ),
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
  DATASET_SANDBOX_GOLDEN_BAKE: 'dataset-sandbox-golden-bake',
} as const;

// Queue client used by the expiry scanner to enqueue cleanup jobs
type BullConnection = import('bullmq').ConnectionOptions;
const conn = connection as unknown as BullConnection;
const queueOptions = queuePrefix ? { connection: conn, prefix: queuePrefix } : { connection: conn };
const cleanupQueue = new Queue(QUEUES.SANDBOX_CLEANUP, queueOptions);
const queryExecutionQueueClient = new Queue(QUEUES.QUERY_EXECUTION, queueOptions);
const goldenBakeQueue = new Queue(QUEUES.DATASET_SANDBOX_GOLDEN_BAKE, queueOptions);

// ─── Helpers ──────────────────────────────────────────────────────────────────

const sandboxDbName = sandboxDbNameFromInstanceId;

/** Build a connection string pointing to a specific sandbox database (PostgreSQL only). */
function sandboxConnStr(host: string, dbName: string, port = 5432): string {
  const u = encodeURIComponent(sandboxUser);
  const p = encodeURIComponent(sandboxPassword);
  return `postgresql://${u}:${p}@${host}:${port}/${dbName}`;
}

async function resolveEngineSpecForSandbox(schemaTemplateId: string | null) {
  const meta = schemaTemplateId ? await fetchSchemaTemplateSandboxMeta(schemaTemplateId) : null;
  return resolveSandboxEngineSpec({
    dialectRaw: meta?.dialect ?? 'postgresql',
    engineVersion: meta?.engineVersion ?? null,
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

/** Estimated restore throughput per engine (bytes/sec). Mirrors sandbox-provision-estimate.ts. */
function restoreBytesPerSecond(engine: SchemaSqlEngine): number {
  if (engine === 'sqlserver') return 1.2 * 1024 * 1024;
  if (engine === 'mysql' || engine === 'mariadb') return 2 * 1024 * 1024;
  return 2.5 * 1024 * 1024; // postgresql
}

/**
 * Compute a dynamic restore timeout scaled by artifact byte size.
 * Returns at least `DATASET_RESTORE_TIMEOUT_MS` (the static baseline / env override).
 * For `.sql.gz` artifacts, applies a 3x heuristic for uncompressed size.
 */
function computeRestoreTimeoutMs(artifactByteSize: number | null, engine: SchemaSqlEngine, isGz: boolean): number {
  if (DATASET_RESTORE_TIMEOUT_MS === 0) return 0; // user disabled timeout
  if (!artifactByteSize || artifactByteSize <= 0) return DATASET_RESTORE_TIMEOUT_MS;
  const effectiveBytes = isGz ? artifactByteSize * 3 : artifactByteSize;
  const bps = restoreBytesPerSecond(engine);
  const estimatedMs = (effectiveBytes / bps) * 1000 * 2.5; // 2.5x safety margin
  return Math.max(DATASET_RESTORE_TIMEOUT_MS, estimatedMs);
}

/** Try to resolve artifact byte size from S3 for dynamic timeout computation. */
async function tryResolveArtifactByteSize(artifactUrl: string | null): Promise<number | null> {
  if (!artifactUrl) return null;
  const trimmed = artifactUrl.trim();

  // Extract actual ref from JSON wrapper if present
  let ref = trimmed;
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    try {
      const payload = JSON.parse(trimmed) as Record<string, unknown>;
      if (typeof payload.value === 'string') ref = payload.value;
      else if (payload.type === 'inline_sql' && typeof payload.sql === 'string') {
        return Buffer.byteLength(payload.sql, 'utf8');
      }
    } catch { /* fall through */ }
  }

  if (/^s3:\/\//i.test(ref)) {
    try {
      return await statS3ObjectSizeViaMinioContainer(ref);
    } catch {
      return null;
    }
  }

  return null;
}

async function applySchemaAndDataset(params: {
  sandboxInstanceId: string;
  containerRef: string;
  dbName: string;
  schemaTemplateId: string | null;
  datasetTemplateId: string | null;
  engine: SchemaSqlEngine;
}): Promise<void> {
  const inner = applySchemaAndDatasetToContainer({
    logger,
    sandboxInstanceId: params.sandboxInstanceId,
    containerRef: params.containerRef,
    dbName: params.dbName,
    schemaTemplateId: params.schemaTemplateId,
    datasetTemplateId: params.datasetTemplateId,
    engine: params.engine,
    sandboxUser,
    sandboxPassword,
    mssqlSaPassword,
  });
  if (DATASET_RESTORE_TIMEOUT_MS === 0) return inner;

  let timeoutMs = DATASET_RESTORE_TIMEOUT_MS;
  if (params.datasetTemplateId) {
    try {
      const dt = await fetchDatasetTemplate(params.datasetTemplateId);
      const restoreUrl = dt?.sandboxGoldenSnapshotUrl?.trim() || dt?.artifactUrl;
      if (restoreUrl) {
        const byteSize = await tryResolveArtifactByteSize(restoreUrl);
        const isGz = /\.gz\b/i.test(restoreUrl);
        const computed = computeRestoreTimeoutMs(byteSize, params.engine, isGz);
        if (byteSize && computed > DATASET_RESTORE_TIMEOUT_MS) {
          logger.info(
            { artifactByteSize: byteSize, timeoutMs: computed, engine: params.engine },
            'Using dynamic restore timeout based on golden snapshot or artifact size',
          );
        }
        timeoutMs = computed;
      }
    } catch {
      // Fall through to static timeout
    }
  }

  return withTimeout(inner, timeoutMs, 'applySchemaAndDataset');
}

// ─── Worker: provision_sandbox ────────────────────────────────────────────────

// Raised from 10 min → 30 min to prevent BullMQ from marking large-dump restore jobs as stalled.
const LONG_JOB_LOCK_DURATION_MS = 30 * 60 * 1000;
const LONG_JOB_STALLED_INTERVAL_MS = 15 * 60 * 1000;
const longJobOpts = {
  ...queueOptions,
  lockDuration: LONG_JOB_LOCK_DURATION_MS,
  stalledInterval: LONG_JOB_STALLED_INTERVAL_MS,
};

const sandboxProvisioningWorker = sandboxQueuesEnabled
  ? new Worker(
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
        sandboxUser,
        sandboxPassword,
        mssqlSaPassword,
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
)
  : null;

// ─── Worker: destroy_sandbox ──────────────────────────────────────────────────

const sandboxCleanupWorker = sandboxQueuesEnabled
  ? new Worker(
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

    // `container_ref` is only persisted after provisioning completes (`updateSandboxReady`). If the user
    // ends the session while provisioning is still running, `containerRef` is null but the Docker
    // container already exists — use the same deterministic name as provisioning.
    const containerRefToRemove = sandbox.containerRef ?? sandboxContainerName(sandboxInstanceId);
    try {
      await ensureSandboxContainerRemoved(containerRefToRemove);
      logger.info(
        { containerRef: containerRefToRemove, hadPersistedRef: Boolean(sandbox.containerRef) },
        'Sandbox container removed',
      );
    } catch (err) {
      logger.error({ err, sandboxInstanceId, containerRef: containerRefToRemove }, 'Failed to remove sandbox container');
      await updateSandboxStatus(sandboxInstanceId, 'failed');
      throw err;
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
)
  : null;

// ─── Worker: reset_sandbox ────────────────────────────────────────────────────

const sandboxResetWorker = sandboxQueuesEnabled
  ? new Worker(
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
        sandboxUser,
        sandboxPassword,
        mssqlSaPassword,
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
)
  : null;

// ─── Worker: dataset_golden_bake ────────────────────────────────────────────────

const datasetGoldenBakeWorker = sandboxQueuesEnabled
  ? new Worker(
      QUEUES.DATASET_SANDBOX_GOLDEN_BAKE,
      async (job: Job) => {
        const { datasetTemplateId } = job.data as { datasetTemplateId: string };
        try {
          await runDatasetGoldenBake(datasetTemplateId, logger);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          await updateDatasetGoldenBakeFailed(datasetTemplateId, message);
          throw err;
        }
      },
      longJobOpts,
    )
  : null;

// ─── Worker: execute_query / cancel_query ─────────────────────────────────────

async function maybeCaptureSchemaDiffSnapshot(
  sandbox: NonNullable<Awaited<ReturnType<typeof fetchSandbox>>>,
): Promise<QuerySchemaDiffSnapshot | null> {
  const engine = normalizeSchemaSqlEngine(sandbox.sandboxEngine);
  if (engine !== 'postgresql') {
    return null;
  }
  if (!sandbox.schemaTemplateId || !sandbox.dbName) {
    return null;
  }
  const definition = await fetchSchemaTemplate(sandbox.schemaTemplateId);
  if (!definition) {
    return null;
  }
  try {
    const base = parseBaseSchemaSnapshot(definition);
    const connectionString = buildPostgresSandboxConnectionString({
      host: sandbox.containerRef ?? sandboxHost,
      port: sandbox.containerRef ? sandbox.sandboxDbPort : Number(sandboxPort),
      user: sandboxUser,
      password: sandboxPassword,
      database: sandbox.dbName,
    });
    const current = await fetchSandboxSchemaSnapshot(connectionString);
    const diff = diffSandboxSchema(base, current);
    return summarizeSandboxSchemaDiff(sandbox.schemaTemplateId, diff);
  } catch (err) {
    logger.warn({ err, sandboxId: sandbox.id }, 'schema diff snapshot failed');
    return null;
  }
}

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

    const schemaSnap = await maybeCaptureSchemaDiffSnapshot(sandbox);
    const stored = await updateQueryExecutionSuccess(
      queryExecutionId,
      result.durationMs,
      result.rowCount,
      preview,
      schemaSnap ?? undefined,
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

const queryExecutionWorker = queryQueueEnabled
  ? new Worker(
      QUEUES.QUERY_EXECUTION,
      async (job: Job) => {
        if (job.name === 'cancel_query') {
          return handleCancelQueryJob(job);
        }
        return handleExecuteQueryJob(job);
      },
      {
        ...queueOptions,
        concurrency: queryWorkerConcurrency,
      },
    )
  : null;

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

const expiryScanner =
  sandboxQueuesEnabled
    ? setInterval(runExpiryScanner, EXPIRY_SCAN_INTERVAL_MS)
    : null;
if (sandboxQueuesEnabled) {
  runExpiryScanner().catch((err) => logger.error({ err }, 'Initial expiry scan failed'));
}

// ─── Golden-bake enqueue scan (pending published datasets) ───────────────────

async function runGoldenBakeEnqueueScan(): Promise<void> {
  if (!datasetGoldenBakeWorker) return;
  try {
    const ids = await fetchDatasetTemplateIdsPendingGoldenBake();
    if (ids.length === 0) return;

    logger.info({ count: ids.length }, 'Enqueueing pending golden-bake jobs');

    for (const datasetTemplateId of ids) {
      await goldenBakeQueue.add(
        'dataset_golden_bake',
        { datasetTemplateId },
        {
          jobId: `golden-bake-${datasetTemplateId}`,
          attempts: 3,
          backoff: { type: 'exponential', delay: 5000 },
          removeOnComplete: true,
        },
      );
    }
  } catch (err) {
    logger.error({ err }, 'Golden-bake enqueue scan error');
  }
}

const goldenBakeEnqueueScanner =
  sandboxQueuesEnabled && datasetGoldenBakeWorker
    ? setInterval(runGoldenBakeEnqueueScan, GOLDEN_BAKE_SCAN_INTERVAL_MS)
    : null;
if (sandboxQueuesEnabled && datasetGoldenBakeWorker) {
  runGoldenBakeEnqueueScan().catch((err) =>
    logger.error({ err }, 'Initial golden-bake enqueue scan failed'),
  );
}

// ─── Event listeners ──────────────────────────────────────────────────────────

const workers: Array<{ name: string; worker: Worker }> = [];
if (sandboxProvisioningWorker) {
  workers.push({ name: QUEUES.SANDBOX_PROVISIONING, worker: sandboxProvisioningWorker });
}
if (sandboxCleanupWorker) {
  workers.push({ name: QUEUES.SANDBOX_CLEANUP, worker: sandboxCleanupWorker });
}
if (sandboxResetWorker) {
  workers.push({ name: QUEUES.SANDBOX_RESET, worker: sandboxResetWorker });
}
if (datasetGoldenBakeWorker) {
  workers.push({ name: QUEUES.DATASET_SANDBOX_GOLDEN_BAKE, worker: datasetGoldenBakeWorker });
}
if (queryExecutionWorker) {
  workers.push({ name: QUEUES.QUERY_EXECUTION, worker: queryExecutionWorker });
}

if (workers.length === 0) {
  throw new Error(
    'No BullMQ workers started: check WORKER_ROLE (must be all, sandbox, or query)',
  );
}

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

  if (expiryScanner) clearInterval(expiryScanner);
  if (goldenBakeEnqueueScanner) clearInterval(goldenBakeEnqueueScanner);
  await Promise.all(workers.map(({ worker }) => worker.close()));
  await cleanupQueue.close();
  await queryExecutionQueueClient.close();
  await goldenBakeQueue.close();
  await connection.quit();
  await mainDb.end();

  logger.info('All workers stopped. Exiting.');
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

logger.info(
  {
    workerRole,
    activeQueues: workers.map((w) => w.name),
    queryWorkerConcurrency: queryQueueEnabled ? queryWorkerConcurrency : null,
    redisUrl,
    queuePrefix: queuePrefix ?? 'bull',
  },
  'SQLCraft worker service started',
);
