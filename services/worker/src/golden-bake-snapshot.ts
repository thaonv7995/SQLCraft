import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createWriteStream } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { createGzip } from 'node:zlib';
import type { Logger } from 'pino';

import { fetchDatasetTemplate, fetchSchemaTemplateSandboxMeta } from './db';
import {
  createSandboxEngineContainer,
  ensureSandboxContainerRemoved,
  initSqlServerDatabase,
  resolveStorageBucket,
  sandboxContainerName,
  sandboxMysqlFamilyDumpBin,
  uploadBufferToS3ViaMinio,
  waitForSandboxEngine,
} from './docker';
import { resolveSandboxEngineSpec } from './sandbox-engine-image';
import { sandboxDbNameFromInstanceId } from './sandbox-naming';
import { applySchemaAndDatasetToContainer } from './sandbox-apply-dataset';
import { waitForSandboxDbReady } from './sandbox-wait-ready';

const GOLDEN_BAKE_RESTORE_TIMEOUT_MS = Math.max(
  0,
  Number(process.env.GOLDEN_BAKE_RESTORE_TIMEOUT_MS ?? process.env.SANDBOX_DATASET_RESTORE_TIMEOUT_MS) ||
    45 * 60 * 1000,
);

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  if (timeoutMs <= 0) return promise;
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`${label} timed out after ${Math.round(timeoutMs / 1000)}s`)),
      timeoutMs,
    );
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

async function pgDumpCustomFormatToFile(params: {
  containerRef: string;
  dbUser: string;
  dbPassword: string;
  dbName: string;
  destPath: string;
}): Promise<void> {
  const { containerRef, dbUser, dbPassword, dbName, destPath } = params;
  const child = spawn(
    'docker',
    [
      'exec',
      '-e',
      `PGPASSWORD=${dbPassword}`,
      containerRef,
      'pg_dump',
      '-U',
      dbUser,
      '-Fc',
      '--no-owner',
      '--no-acl',
      '-d',
      dbName,
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );
  const stderrChunks: Buffer[] = [];
  child.stderr.on('data', (c: Buffer | string) => {
    stderrChunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
  });
  const out = createWriteStream(destPath);
  await pipeline(child.stdout, out);
  const [code] = await once(child, 'close');
  if (code !== 0) {
    throw new Error(`pg_dump failed (exit ${code}): ${Buffer.concat(stderrChunks).toString('utf8')}`);
  }
}

async function mysqlFamilyDumpGzToFile(params: {
  engine: 'mysql' | 'mariadb';
  containerRef: string;
  dbUser: string;
  dbPassword: string;
  dbName: string;
  destPath: string;
}): Promise<void> {
  const dumpBin = sandboxMysqlFamilyDumpBin(params.engine);
  const child = spawn(
    'docker',
    [
      'exec',
      '-e',
      `MYSQL_PWD=${params.dbPassword}`,
      params.containerRef,
      dumpBin,
      '--single-transaction',
      '--routines',
      '--default-character-set=utf8mb4',
      `-u${params.dbUser}`,
      params.dbName,
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );
  const stderrChunks: Buffer[] = [];
  child.stderr.on('data', (c: Buffer | string) => {
    stderrChunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
  });
  const gzip = createGzip();
  const out = createWriteStream(params.destPath);
  await pipeline(child.stdout, gzip, out);
  const [code] = await once(child, 'close');
  if (code !== 0) {
    throw new Error(
      `${dumpBin} failed (exit ${code}): ${Buffer.concat(stderrChunks).toString('utf8')}`,
    );
  }
}

export type GoldenBakeSnapshotResult = {
  snapshotUrl: string | null;
  snapshotBytes: number | null;
  snapshotChecksumSha256: string | null;
};

/**
 * Spins up a throwaway sandbox, restores the source artifact, dumps a portable snapshot,
 * uploads to object storage, and tears the container down.
 * SQL Server / SQLite: returns null snapshot fields (fingerprint-only bake).
 */
export async function runGoldenBakeSnapshotPipeline(params: {
  datasetTemplateId: string;
  logger: Logger;
  sandboxUser: string;
  sandboxPassword: string;
  mssqlSaPassword: string;
}): Promise<GoldenBakeSnapshotResult> {
  const { datasetTemplateId, logger, sandboxUser, sandboxPassword, mssqlSaPassword } = params;

  const dt = await fetchDatasetTemplate(datasetTemplateId);
  if (!dt) {
    throw new Error('Dataset template not found');
  }

  const meta = await fetchSchemaTemplateSandboxMeta(dt.schemaTemplateId);
  const spec = resolveSandboxEngineSpec({
    dialectRaw: meta?.dialect ?? 'postgresql',
    engineVersion: meta?.engineVersion ?? null,
  });

  if (spec.engine === 'sqlite') {
    logger.info({ datasetTemplateId }, 'Golden snapshot skipped (SQLite)');
    return { snapshotUrl: null, snapshotBytes: null, snapshotChecksumSha256: null };
  }

  if (spec.engine === 'sqlserver') {
    logger.info(
      { datasetTemplateId },
      'Golden snapshot not implemented for SQL Server; fingerprint-only bake',
    );
    return { snapshotUrl: null, snapshotBytes: null, snapshotChecksumSha256: null };
  }

  const bakeInstanceId = randomUUID();
  const dbName = sandboxDbNameFromInstanceId(bakeInstanceId);
  const containerRef = sandboxContainerName(bakeInstanceId);

  let tmpDir: string | null = null;
  try {
    await createSandboxEngineContainer({
      containerRef,
      engine: spec.engine,
      dockerImage: spec.dockerImage,
      dbName,
      dbUser: sandboxUser,
      dbPassword: sandboxPassword,
      sandboxId: bakeInstanceId,
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
    await waitForSandboxDbReady({
      engine: spec.engine,
      containerRef,
      dbName,
      internalPort: spec.internalPort,
      sandboxUser,
      sandboxPassword,
      mssqlSaPassword,
    });

    await withTimeout(
      applySchemaAndDatasetToContainer({
        logger,
        sandboxInstanceId: bakeInstanceId,
        containerRef,
        dbName,
        schemaTemplateId: dt.schemaTemplateId,
        datasetTemplateId,
        engine: spec.engine,
        sandboxUser,
        sandboxPassword,
        mssqlSaPassword,
        preferArtifactOverGoldenSnapshot: true,
      }),
      GOLDEN_BAKE_RESTORE_TIMEOUT_MS,
      'golden-bake applySchemaAndDataset',
    );

    tmpDir = await mkdtemp(join(tmpdir(), 'golden-snap-'));
    let filePath: string;
    let ext: string;

    if (spec.engine === 'postgresql') {
      filePath = join(tmpDir, 'snap.dump');
      await pgDumpCustomFormatToFile({
        containerRef,
        dbUser: sandboxUser,
        dbPassword: sandboxPassword,
        dbName,
        destPath: filePath,
      });
      ext = 'dump';
    } else {
      filePath = join(tmpDir, 'snap.sql.gz');
      await mysqlFamilyDumpGzToFile({
        engine: spec.engine,
        containerRef,
        dbUser: sandboxUser,
        dbPassword: sandboxPassword,
        dbName,
        destPath: filePath,
      });
      ext = 'sql.gz';
    }

    const buf = await readFile(filePath);
    const checksum = createHash('sha256').update(buf).digest('hex');
    const bucket = resolveStorageBucket();
    const key = `golden-snapshots/${datasetTemplateId}/dataset.${ext}`;
    await uploadBufferToS3ViaMinio({ bucket, objectKey: key, body: buf });
    const snapshotUrl = `s3://${bucket}/${key}`;

    logger.info(
      { datasetTemplateId, snapshotUrl, bytes: buf.length, engine: spec.engine },
      'Golden snapshot uploaded',
    );

    return {
      snapshotUrl,
      snapshotBytes: buf.length,
      snapshotChecksumSha256: checksum,
    };
  } finally {
    if (tmpDir) {
      await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
    await ensureSandboxContainerRemoved(containerRef).catch((err) =>
      logger.warn({ err, containerRef }, 'Failed to remove golden-bake sandbox container'),
    );
  }
}
