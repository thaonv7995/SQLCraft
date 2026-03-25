import { execFile } from 'node:child_process';
import { spawn } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const sandboxDockerNetwork = process.env.SANDBOX_DOCKER_NETWORK ?? 'sqlcraft-dev';
const sandboxPostgresImage = process.env.SANDBOX_POSTGRES_IMAGE ?? 'postgres:16-alpine';
const storageDockerContainer = process.env.STORAGE_DOCKER_CONTAINER ?? 'sqlcraft-minio';
const storageAccessKey = process.env.STORAGE_ACCESS_KEY ?? 'minioadmin';
const storageSecretKey = process.env.STORAGE_SECRET_KEY ?? 'minioadmin';

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

async function runDockerWithInput(args: string[], input: string | Buffer): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const child = spawn('docker', args, {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');

    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', (error) => {
      reject(error);
    });
    child.on('close', (code) => {
      if (code === 0) {
        resolve(stdout.trim());
        return;
      }
      reject(new Error(`docker ${args.join(' ')} failed with code ${code}: ${stderr.trim()}`));
    });

    child.stdin.write(input);
    child.stdin.end();
  });
}

async function runDockerBinary(args: string[]): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const child = spawn('docker', args, {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const stdoutChunks: Buffer[] = [];
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdoutChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', (error) => {
      reject(error);
    });
    child.on('close', (code) => {
      if (code === 0) {
        resolve(Buffer.concat(stdoutChunks));
        return;
      }
      reject(new Error(`docker ${args.join(' ')} failed with code ${code}: ${stderr.trim()}`));
    });
  });
}

function shQuote(value: string): string {
  return `'${value.replace(/'/g, `'\"'\"'`)}'`;
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

export async function runPsqlInSandboxContainer(params: {
  containerRef: string;
  dbUser: string;
  dbName: string;
  sql: string;
}): Promise<void> {
  const { containerRef, dbUser, dbName, sql } = params;
  await runDockerWithInput(
    ['exec', '-i', containerRef, 'psql', '-v', 'ON_ERROR_STOP=1', '-U', dbUser, '-d', dbName],
    sql,
  );
}

export async function runPgRestoreInSandboxContainer(params: {
  containerRef: string;
  dbUser: string;
  dbName: string;
  dump: Buffer;
}): Promise<void> {
  const { containerRef, dbUser, dbName, dump } = params;
  await runDockerWithInput(
    [
      'exec',
      '-i',
      containerRef,
      'pg_restore',
      '--no-owner',
      '--no-privileges',
      '--clean',
      '--if-exists',
      '-U',
      dbUser,
      '-d',
      dbName,
    ],
    dump,
  );
}

export async function readS3ObjectViaMinioContainer(artifactRef: string): Promise<Buffer> {
  const parsed = new URL(artifactRef);
  const bucket = parsed.hostname;
  const objectName = parsed.pathname.replace(/^\/+/, '');

  if (!bucket || !objectName) {
    throw new Error(`Invalid s3 artifact reference: ${artifactRef}`);
  }

  const script = [
    `mc alias set local http://localhost:9000 ${shQuote(storageAccessKey)} ${shQuote(storageSecretKey)} >/dev/null`,
    `mc cat ${shQuote(`local/${bucket}/${objectName}`)}`,
  ].join(' && ');

  return runDockerBinary(['exec', storageDockerContainer, 'sh', '-lc', script]);
}
