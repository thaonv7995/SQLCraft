import type { SchemaSqlEngine } from '@sqlcraft/types';
import { normalizeSchemaSqlEngine } from '@sqlcraft/types';

export interface ResolvedSandboxEngineSpec {
  engine: SchemaSqlEngine;
  dockerImage: string;
  /** Port exposed inside the container (worker connects via Docker DNS to container name). */
  internalPort: number;
}

function parseMajor(version: string | null | undefined): number | null {
  if (version == null || typeof version !== 'string') return null;
  const trimmed = version.trim();
  if (!trimmed) return null;
  const m = trimmed.match(/^(\d+)/);
  if (!m) return null;
  const n = parseInt(m[1]!, 10);
  return Number.isFinite(n) ? n : null;
}

function parseAllowedPostgresMajors(): number[] {
  const raw = process.env.SANDBOX_POSTGRES_ALLOWED_MAJORS ?? '14,15,16,17';
  const parts = raw
    .split(',')
    .map((s) => parseInt(s.trim(), 10))
    .filter((n) => Number.isFinite(n) && n > 0);
  const unique = [...new Set(parts)].sort((a, b) => a - b);
  return unique.length > 0 ? unique : [14, 15, 16, 17];
}

function pickNearestMajor(parsedMajor: number | null, allowed: number[]): number {
  const fallback = allowed.includes(16) ? 16 : allowed[allowed.length - 1]!;
  if (parsedMajor == null) return fallback;
  if (allowed.includes(parsedMajor)) return parsedMajor;
  if (parsedMajor < allowed[0]!) return allowed[0]!;
  if (parsedMajor > allowed[allowed.length - 1]!) return allowed[allowed.length - 1]!;
  let best = allowed[0]!;
  for (const m of allowed) {
    if (m <= parsedMajor) best = m;
  }
  return best;
}

function resolvePostgresImage(engineVersion: string | null): string {
  const pinned = process.env.SANDBOX_POSTGRES_IMAGE?.trim();
  if (pinned) return pinned;
  const allowed = parseAllowedPostgresMajors();
  const major = pickNearestMajor(parseMajor(engineVersion), allowed);
  return `postgres:${major}-alpine`;
}

function resolveMysqlTag(engineVersion: string | null): string {
  const pinned = process.env.SANDBOX_MYSQL_IMAGE?.trim();
  if (pinned) return pinned;
  const major = parseMajor(engineVersion);
  // Docker Hub only ships well-known tags (e.g. 5.7, 8.0). Unknown majors (typos, bad headers) must not become mysql:4 etc.
  if (major === 5) return '5.7';
  return '8.0';
}

function resolveMariadbTag(engineVersion: string | null): string {
  const pinned = process.env.SANDBOX_MARIADB_IMAGE?.trim();
  if (pinned) return pinned;
  const major = parseMajor(engineVersion);
  if (major === 10) return '10.11';
  if (major === 11 || major == null) return '11';
  if (major >= 12) return `${major}`;
  return '11';
}

function resolveSqlServerImage(engineVersion: string | null): string {
  const pinned = process.env.SANDBOX_SQLSERVER_IMAGE?.trim();
  if (pinned) return pinned;
  const major = parseMajor(engineVersion);
  if (major === 2019) return 'mcr.microsoft.com/mssql/server:2019-latest';
  return 'mcr.microsoft.com/mssql/server:2022-latest';
}

/**
 * Resolve Docker image + internal port from template dialect / engine_version (with env overrides).
 */
export function resolveSandboxEngineSpec(params: {
  dialectRaw: string;
  engineVersion: string | null;
}): ResolvedSandboxEngineSpec {
  const engine = normalizeSchemaSqlEngine(params.dialectRaw);

  switch (engine) {
    case 'postgresql':
      return {
        engine,
        dockerImage: resolvePostgresImage(params.engineVersion),
        internalPort: 5432,
      };
    case 'mysql':
      return {
        engine,
        dockerImage: `mysql:${resolveMysqlTag(params.engineVersion)}`,
        internalPort: 3306,
      };
    case 'mariadb':
      return {
        engine,
        dockerImage: `mariadb:${resolveMariadbTag(params.engineVersion)}`,
        internalPort: 3306,
      };
    case 'sqlserver':
      return {
        engine,
        dockerImage: resolveSqlServerImage(params.engineVersion),
        internalPort: 1433,
      };
    case 'sqlite':
      return {
        engine,
        dockerImage: '',
        internalPort: 0,
      };
    default:
      return {
        engine: 'postgresql',
        dockerImage: resolvePostgresImage(params.engineVersion),
        internalPort: 5432,
      };
  }
}
