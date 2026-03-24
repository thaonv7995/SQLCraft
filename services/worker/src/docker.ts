import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const sandboxDockerNetwork = process.env.SANDBOX_DOCKER_NETWORK ?? 'sqlcraft-dev';
const sandboxPostgresImage = process.env.SANDBOX_POSTGRES_IMAGE ?? 'postgres:16-alpine';

function isNotFoundError(stderr: string | undefined): boolean {
  return (stderr ?? '').toLowerCase().includes('no such container');
}

async function runDocker(args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('docker', args, {
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
  });

  return stdout.trim();
}

export function sandboxContainerName(sandboxId: string): string {
  return `sqlcraft-sbx-${sandboxId.replace(/[^a-zA-Z0-9]/g, '').slice(0, 16).toLowerCase()}`;
}

export async function ensureSandboxContainerRemoved(containerRef: string): Promise<void> {
  try {
    await runDocker(['rm', '-f', containerRef]);
  } catch (error) {
    const stderr =
      error && typeof error === 'object' && 'stderr' in error
        ? String((error as { stderr?: string }).stderr ?? '')
        : '';

    if (!isNotFoundError(stderr)) {
      throw error;
    }
  }
}

export async function createSandboxContainer(params: {
  containerRef: string;
  dbName: string;
  dbUser: string;
  dbPassword: string;
  sandboxId: string;
}): Promise<void> {
  const { containerRef, dbName, dbUser, dbPassword, sandboxId } = params;

  await ensureSandboxContainerRemoved(containerRef);
  await runDocker([
    'run',
    '-d',
    '--name',
    containerRef,
    '--network',
    sandboxDockerNetwork,
    '--label',
    'sqlcraft.managed=true',
    '--label',
    `sqlcraft.sandbox_id=${sandboxId}`,
    '-e',
    `POSTGRES_USER=${dbUser}`,
    '-e',
    `POSTGRES_PASSWORD=${dbPassword}`,
    '-e',
    `POSTGRES_DB=${dbName}`,
    sandboxPostgresImage,
  ]);
}

export async function waitForSandboxPostgres(params: {
  containerRef: string;
  dbUser: string;
  dbName: string;
  timeoutMs?: number;
}): Promise<void> {
  const { containerRef, dbUser, dbName, timeoutMs = 60_000 } = params;
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    try {
      await runDocker(['exec', containerRef, 'pg_isready', '-U', dbUser, '-d', dbName]);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  throw new Error(`Sandbox container ${containerRef} did not become ready within ${timeoutMs}ms`);
}
