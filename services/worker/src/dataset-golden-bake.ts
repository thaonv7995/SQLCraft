import { createHash } from 'node:crypto';
import type { Logger } from 'pino';
import { statS3ObjectSizeViaMinioContainer } from './docker';
import {
  fetchDatasetTemplate,
  fetchSchemaTemplateSandboxMeta,
  updateDatasetGoldenBakeFailed,
  updateDatasetGoldenBakeSuccess,
} from './db';
import { runGoldenBakeSnapshotPipeline } from './golden-bake-snapshot';
import { resolveSandboxEngineSpec } from './sandbox-engine-image';

/** Stable fingerprint for catalog gating when artifact bytes are unchanged. Exported for tests. */
export function computeArtifactFingerprint(artifactUrl: string, byteSize: number | null): string {
  const h = createHash('sha256');
  h.update(artifactUrl, 'utf8');
  h.update('|');
  h.update(byteSize != null ? String(byteSize) : '');
  return `sha256:${h.digest('hex')}`;
}

async function tryResolveArtifactByteSize(artifactUrl: string | null): Promise<number | null> {
  if (!artifactUrl) return null;
  const trimmed = artifactUrl.trim();
  let ref = trimmed;
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    try {
      const payload = JSON.parse(trimmed) as Record<string, unknown>;
      if (typeof payload.value === 'string') ref = payload.value;
      else if (payload.type === 'inline_sql' && typeof payload.sql === 'string') {
        return Buffer.byteLength(payload.sql, 'utf8');
      }
    } catch {
      /* fall through */
    }
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

function mssqlSaPasswordForBake(): string {
  const fromEnv = process.env.SANDBOX_MSSQL_SA_PASSWORD?.trim();
  if (
    fromEnv &&
    fromEnv.length >= 8 &&
    /[a-z]/.test(fromEnv) &&
    /[A-Z]/.test(fromEnv) &&
    /[0-9]/.test(fromEnv) &&
    /[^A-Za-z0-9]/.test(fromEnv)
  ) {
    return fromEnv;
  }
  return 'SqlForge1!Sb';
}

/**
 * Full golden bake: ephemeral restore → logical snapshot upload (Postgres / MySQL family),
 * plus artifact fingerprint + engine image for catalog gating. SQL Server / SQLite: fingerprint only.
 */
export async function runDatasetGoldenBake(datasetTemplateId: string, log: Logger): Promise<void> {
  const dt = await fetchDatasetTemplate(datasetTemplateId);
  if (!dt) {
    await updateDatasetGoldenBakeFailed(datasetTemplateId, 'Dataset template not found');
    return;
  }

  const rawArtifact = dt.artifactUrl?.trim();
  if (!rawArtifact) {
    await updateDatasetGoldenBakeFailed(datasetTemplateId, 'Dataset has no artifact');
    return;
  }

  const meta = await fetchSchemaTemplateSandboxMeta(dt.schemaTemplateId);
  const spec = resolveSandboxEngineSpec({
    dialectRaw: meta?.dialect ?? 'postgresql',
    engineVersion: meta?.engineVersion ?? null,
  });

  const sandboxUser = process.env.SANDBOX_DB_USER ?? 'sandbox';
  const sandboxPassword = process.env.SANDBOX_DB_PASSWORD ?? 'sandbox';
  const mssqlSaPassword = mssqlSaPasswordForBake();

  const snapshot = await runGoldenBakeSnapshotPipeline({
    datasetTemplateId,
    logger: log,
    sandboxUser,
    sandboxPassword,
    mssqlSaPassword,
  });

  const byteSize = await tryResolveArtifactByteSize(dt.artifactUrl);
  const fingerprint = computeArtifactFingerprint(rawArtifact, byteSize);
  const engineImage = spec.engine === 'sqlite' ? null : spec.dockerImage || null;

  await updateDatasetGoldenBakeSuccess(datasetTemplateId, {
    artifactFingerprint: fingerprint,
    engineImage,
    snapshotUrl: snapshot.snapshotUrl,
    snapshotBytes: snapshot.snapshotBytes,
    snapshotChecksumSha256: snapshot.snapshotChecksumSha256,
  });

  log.info(
    {
      datasetTemplateId,
      engine: spec.engine,
      fingerprint,
      snapshotUrl: snapshot.snapshotUrl,
    },
    'Golden bake complete',
  );
}
