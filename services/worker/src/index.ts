import 'dotenv/config';
import { Worker, type Job } from 'bullmq';
import IORedis from 'ioredis';
import pino from 'pino';

const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  transport:
    process.env.NODE_ENV !== 'production'
      ? { target: 'pino-pretty', options: { colorize: true } }
      : undefined,
});

// ---- Redis connection ----
const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379';
const connection = new IORedis(redisUrl, {
  maxRetriesPerRequest: null,
});


connection.on('connect', () => logger.info({ redisUrl }, 'Redis connected'));
connection.on('error', (err) => logger.error({ err }, 'Redis connection error'));

// ---- Queue names ----
const QUEUES = {
  SANDBOX_PROVISIONING: 'sandbox-provisioning',
  SANDBOX_CLEANUP: 'sandbox-cleanup',
  DATASET_GENERATION: 'dataset-generation',
  CHALLENGE_EVALUATION: 'challenge-evaluation',
} as const;

// ---- Worker: sandbox-provisioning ----
const sandboxProvisioningWorker = new Worker(
  QUEUES.SANDBOX_PROVISIONING,
  async (job: Job) => {
    logger.info({ jobId: job.id, data: job.data }, 'Processing sandbox provisioning job');

    const { learningSessionId, schemaTemplateId, datasetTemplateId } = job.data as {
      learningSessionId: string;
      schemaTemplateId: string;
      datasetTemplateId?: string;
    };

    // TODO: implement actual sandbox provisioning logic
    // 1. Create an isolated database schema for the session
    // 2. Apply the schema template DDL
    // 3. Load the dataset if provided
    // 4. Update sandbox status to 'ready' in the database
    logger.info(
      { learningSessionId, schemaTemplateId, datasetTemplateId },
      'Sandbox provisioning placeholder — implement me'
    );
  },
  { connection: connection as unknown as import("bullmq").ConnectionOptions }
);

// ---- Worker: sandbox-cleanup ----
const sandboxCleanupWorker = new Worker(
  QUEUES.SANDBOX_CLEANUP,
  async (job: Job) => {
    logger.info({ jobId: job.id, data: job.data }, 'Processing sandbox cleanup job');

    const { sandboxInstanceId, learningSessionId } = job.data as {
      sandboxInstanceId: string;
      learningSessionId: string;
    };

    // TODO: implement actual sandbox cleanup logic
    // 1. Drop the sandbox schema from sandbox-postgres
    // 2. Update sandbox status to 'destroyed' in the database
    logger.info(
      { sandboxInstanceId, learningSessionId },
      'Sandbox cleanup placeholder — implement me'
    );
  },
  { connection: connection as unknown as import("bullmq").ConnectionOptions }
);

// ---- Worker: dataset-generation ----
const datasetGenerationWorker = new Worker(
  QUEUES.DATASET_GENERATION,
  async (job: Job) => {
    logger.info({ jobId: job.id, data: job.data }, 'Processing dataset generation job');

    const { datasetTemplateId, targetSize } = job.data as {
      datasetTemplateId: string;
      targetSize: 'tiny' | 'small' | 'medium' | 'large';
    };

    // TODO: implement dataset generation logic
    // 1. Load schema template to understand table structures
    // 2. Generate synthetic data rows matching the target size
    // 3. Write seed SQL files to storage (MinIO)
    // 4. Update dataset template status to 'published'
    logger.info(
      { datasetTemplateId, targetSize },
      'Dataset generation placeholder — implement me'
    );
  },
  { connection: connection as unknown as import("bullmq").ConnectionOptions }
);

// ---- Worker: challenge-evaluation ----
const challengeEvaluationWorker = new Worker(
  QUEUES.CHALLENGE_EVALUATION,
  async (job: Job) => {
    logger.info({ jobId: job.id, data: job.data }, 'Processing challenge evaluation job');

    const { challengeAttemptId, queryExecutionId, challengeVersionId } = job.data as {
      challengeAttemptId: string;
      queryExecutionId: string;
      challengeVersionId: string;
    };

    // TODO: implement challenge evaluation logic
    // 1. Fetch the query execution result from the database
    // 2. Fetch the challenge version validator config
    // 3. Compare result set columns/rows against expected output
    // 4. Optionally score performance (rows scanned, duration)
    // 5. Write evaluation result back to the challenge_attempt row
    logger.info(
      { challengeAttemptId, queryExecutionId, challengeVersionId },
      'Challenge evaluation placeholder — implement me'
    );
  },
  { connection: connection as unknown as import("bullmq").ConnectionOptions }
);

// ---- Event listeners ----
const workers = [
  { name: QUEUES.SANDBOX_PROVISIONING, worker: sandboxProvisioningWorker },
  { name: QUEUES.SANDBOX_CLEANUP, worker: sandboxCleanupWorker },
  { name: QUEUES.DATASET_GENERATION, worker: datasetGenerationWorker },
  { name: QUEUES.CHALLENGE_EVALUATION, worker: challengeEvaluationWorker },
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

// ---- Graceful shutdown ----
async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, 'Received shutdown signal, closing workers...');

  await Promise.all(workers.map(({ worker }) => worker.close()));
  await connection.quit();

  logger.info('All workers stopped. Exiting.');
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

logger.info(
  {
    queues: Object.values(QUEUES),
    redisUrl,
  },
  'SQLCraft worker service started'
);
