import { statS3ArtifactUrl } from './storage';

export interface ProvisioningEstimate {
  estimatedSeconds: number;
  estimatedReadyAt: string;
}

const BASE_SECONDS = 50;
const MAX_SCHEMA_OVERHEAD = 90;
const SECONDS_PER_TABLE = 1.5;
const MIN_TOTAL = 25;
const MAX_TOTAL = 45 * 60;
const DEFAULT_RESTORE_WHEN_UNKNOWN_BYTES = 18;

function restoreBytesPerSecond(dialect: string): number {
  if (dialect === 'sqlserver') return 1.2 * 1024 * 1024;
  if (dialect === 'mysql' || dialect === 'mariadb') return 2 * 1024 * 1024;
  return 2.5 * 1024 * 1024;
}

function maybeExtractJsonArtifactValue(trimmed: string): string | null {
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) return null;
  try {
    const payload = JSON.parse(trimmed) as Record<string, unknown>;
    const value = payload.value;
    if (typeof value === 'string' && value.length > 0) return value;
  } catch {
    return null;
  }
  return null;
}

/**
 * Effective byte size for ETA (uncompressed heuristic for `.sql.gz`).
 */
async function resolveArtifactByteSize(artifactUrl: string): Promise<number | null> {
  const trimmed = artifactUrl.trim();

  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    try {
      const payload = JSON.parse(trimmed) as Record<string, unknown>;
      if (payload.type === 'inline_sql' && typeof payload.sql === 'string') {
        return Buffer.byteLength(payload.sql, 'utf8');
      }
      if (typeof payload.sql === 'string') {
        return Buffer.byteLength(payload.sql, 'utf8');
      }
    } catch {
      return null;
    }
  }

  if (trimmed.startsWith('inline:sql:')) {
    return Buffer.byteLength(decodeURIComponent(trimmed.slice('inline:sql:'.length)), 'utf8');
  }

  const ref = maybeExtractJsonArtifactValue(trimmed) ?? trimmed;

  if (/^s3:\/\//i.test(ref)) {
    const st = await statS3ArtifactUrl(ref);
    if (!st || st.size <= 0) return null;
    const lower = ref.split('?')[0].toLowerCase();
    if (lower.endsWith('.sql.gz')) {
      return Math.round(st.size * 3);
    }
    return st.size;
  }

  return null;
}

export async function computeSandboxProvisioningEstimate(params: {
  artifactUrl: string | null | undefined;
  dialect: string;
  tableCount: number;
  now?: Date;
}): Promise<ProvisioningEstimate> {
  const now = params.now ?? new Date();
  const dialect = params.dialect || 'postgresql';

  let bytes: number | null = null;
  if (params.artifactUrl?.trim()) {
    try {
      bytes = await resolveArtifactByteSize(params.artifactUrl);
    } catch {
      bytes = null;
    }
  }

  const bps = restoreBytesPerSecond(dialect);
  let restoreSeconds =
    bytes != null && bytes > 0 ? bytes / bps : DEFAULT_RESTORE_WHEN_UNKNOWN_BYTES;

  const schemaSeconds = Math.min(params.tableCount * SECONDS_PER_TABLE, MAX_SCHEMA_OVERHEAD);
  const total = Math.round(BASE_SECONDS + restoreSeconds + schemaSeconds);
  const clamped = Math.min(MAX_TOTAL, Math.max(MIN_TOTAL, total));
  const ready = new Date(now.getTime() + clamped * 1000);

  return {
    estimatedSeconds: clamped,
    estimatedReadyAt: ready.toISOString(),
  };
}
