import { Queue } from 'bullmq';
import IORedis from 'ioredis';

const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379';

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
} as const;

type BullConnection = import('bullmq').ConnectionOptions;
const conn = connection as unknown as BullConnection;

const sandboxProvisioningQueue = new Queue(QUEUE_NAMES.SANDBOX_PROVISIONING, { connection: conn });
const sandboxCleanupQueue = new Queue(QUEUE_NAMES.SANDBOX_CLEANUP, { connection: conn });
const sandboxResetQueue = new Queue(QUEUE_NAMES.SANDBOX_RESET, { connection: conn });
const queryExecutionQueue = new Queue(QUEUE_NAMES.QUERY_EXECUTION, { connection: conn });

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

export async function enqueueExecuteQuery(data: ExecuteQueryJobData): Promise<void> {
  await queryExecutionQueue.add('execute_query', data, {
    attempts: 1, // No retry for user queries — report error immediately
  });
}
