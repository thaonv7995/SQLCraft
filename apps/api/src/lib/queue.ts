import { Queue } from 'bullmq';
import IORedis from 'ioredis';

const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379';
const queuePrefix = process.env.QUEUE_PREFIX?.trim() || undefined;

// Shared Redis connection for all queues
const connection = new IORedis(redisUrl, {
  maxRetriesPerRequest: null,
});

// Queue names — must match the worker
export const QUEUE_NAMES = {
  SANDBOX_PROVISIONING: 'sandbox-provisioning',
  SANDBOX_CLEANUP: 'sandbox-cleanup',
  SANDBOX_RESET: 'sandbox-reset',
  QUERY_EXECUTION: 'query-execution',
  /** Bake golden snapshot metadata (fingerprint, engine image); full datadir tar upload later */
  DATASET_SANDBOX_GOLDEN_BAKE: 'dataset-sandbox-golden-bake',
} as const;

type BullConnection = import('bullmq').ConnectionOptions;
const conn = connection as unknown as BullConnection;
const queueOptions = queuePrefix ? { connection: conn, prefix: queuePrefix } : { connection: conn };

const sandboxProvisioningQueue = new Queue(QUEUE_NAMES.SANDBOX_PROVISIONING, queueOptions);
const sandboxCleanupQueue = new Queue(QUEUE_NAMES.SANDBOX_CLEANUP, queueOptions);
const sandboxResetQueue = new Queue(QUEUE_NAMES.SANDBOX_RESET, queueOptions);
const datasetGoldenBakeQueue = new Queue(QUEUE_NAMES.DATASET_SANDBOX_GOLDEN_BAKE, queueOptions);
export const queryExecutionQueue = new Queue(QUEUE_NAMES.QUERY_EXECUTION, queueOptions);

export interface ProvisionSandboxJobData {
  sandboxInstanceId: string;
  learningSessionId: string;
  schemaTemplateId: string | null;
  datasetTemplateId: string | null;
}

export interface DestroySandboxJobData {
  sandboxInstanceId: string;
  learningSessionId: string;
}

export interface ExecuteQueryJobData {
  queryExecutionId: string;
  sandboxInstanceId: string;
  sql: string;
  explainPlan?: boolean;
  planMode?: 'explain' | 'explain_analyze';
  /** Statement timeout in ms (worker `statement_timeout` / MySQL max_execution_time / etc.). */
  timeoutMs: number;
}

export interface CancelQueryJobData {
  queryExecutionId: string;
}

export interface DatasetGoldenBakeJobData {
  datasetTemplateId: string;
}

export async function enqueueProvisionSandbox(data: ProvisionSandboxJobData): Promise<void> {
  await sandboxProvisioningQueue.add('provision_sandbox', data, {
    attempts: 3,
    backoff: { type: 'exponential', delay: 2000 },
  });
}

export async function enqueueDestroySandbox(data: DestroySandboxJobData): Promise<void> {
  await sandboxCleanupQueue.add('destroy_sandbox', data, {
    attempts: 3,
    backoff: { type: 'exponential', delay: 2000 },
  });
}

export interface ResetSandboxJobData {
  sandboxInstanceId: string;
  learningSessionId: string;
}

export async function enqueueResetSandbox(data: ResetSandboxJobData): Promise<void> {
  await sandboxResetQueue.add('reset_sandbox', data, {
    attempts: 3,
    backoff: { type: 'exponential', delay: 2000 },
  });
}

/** Idempotent job id avoids duplicate bakes for the same dataset row. */
export async function enqueueDatasetGoldenBake(data: DatasetGoldenBakeJobData): Promise<void> {
  await datasetGoldenBakeQueue.add('dataset_golden_bake', data, {
    jobId: `golden-bake-${data.datasetTemplateId}`,
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: true,
  });
}

export async function enqueueExecuteQuery(data: ExecuteQueryJobData): Promise<string> {
  const job = await queryExecutionQueue.add('execute_query', data, {
    attempts: 1, // No retry for user queries — report error immediately
  });
  return job.id != null ? String(job.id) : '';
}

export async function enqueueCancelQuery(data: CancelQueryJobData): Promise<void> {
  await queryExecutionQueue.add('cancel_query', data, {
    attempts: 1,
  });
}
