import type { SchemaSqlEngine } from '@sqlcraft/types';
import { probeSandboxConnection, type SandboxDbTarget } from './query-executor';

export function buildSandboxProbeTarget(params: {
  engine: SchemaSqlEngine;
  containerRef: string;
  dbName: string;
  internalPort: number;
  sandboxUser: string;
  sandboxPassword: string;
  mssqlSaPassword: string;
}): SandboxDbTarget {
  const {
    engine,
    containerRef,
    dbName,
    internalPort,
    sandboxUser,
    sandboxPassword,
    mssqlSaPassword,
  } = params;
  return {
    engine,
    host: containerRef,
    port: internalPort,
    user: engine === 'sqlserver' ? 'sa' : sandboxUser,
    password: engine === 'sqlserver' ? mssqlSaPassword : sandboxPassword,
    database: dbName,
  };
}

export async function waitForSandboxDbReady(params: {
  engine: SchemaSqlEngine;
  containerRef: string;
  dbName: string;
  internalPort: number;
  sandboxUser: string;
  sandboxPassword: string;
  mssqlSaPassword: string;
  timeoutMs?: number;
}): Promise<void> {
  const target = buildSandboxProbeTarget(params);
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
