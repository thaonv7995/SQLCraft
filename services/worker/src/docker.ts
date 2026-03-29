import { execFile } from 'node:child_process';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createGunzip } from 'node:zlib';
import { promisify } from 'node:util';
import type { SchemaSqlEngine } from '@sqlcraft/types';

const execFileAsync = promisify(execFile);

const configuredSandboxDockerNetwork = process.env.SANDBOX_DOCKER_NETWORK?.trim();
const stackName = process.env.STACK_NAME?.trim() || 'sqlcraft';
const fallbackSandboxDockerNetwork = `${stackName}-prod`;
const sandboxPostgresMaxWalSize = process.env.SANDBOX_POSTGRES_MAX_WAL_SIZE ?? '4GB';
const sandboxPostgresMinWalSize = process.env.SANDBOX_POSTGRES_MIN_WAL_SIZE ?? '1GB';
const sandboxPostgresCheckpointTimeout =
  process.env.SANDBOX_POSTGRES_CHECKPOINT_TIMEOUT ?? '30min';
const sandboxPostgresCheckpointCompletionTarget =
  process.env.SANDBOX_POSTGRES_CHECKPOINT_COMPLETION_TARGET ?? '0.9';
const sandboxPostgresWalCompression = process.env.SANDBOX_POSTGRES_WAL_COMPRESSION ?? 'on';
const sandboxPostgresSynchronousCommit =
  process.env.SANDBOX_POSTGRES_SYNCHRONOUS_COMMIT ?? 'off';
const sandboxMysqlMaxAllowedPacket =
  process.env.SANDBOX_MYSQL_MAX_ALLOWED_PACKET ?? '256M';
const sandboxMysqlInnodbBufferPoolSize =
  process.env.SANDBOX_MYSQL_INNODB_BUFFER_POOL_SIZE ?? '256M';
const sandboxMysqlInnodbLogFileSize =
  process.env.SANDBOX_MYSQL_INNODB_LOG_FILE_SIZE ?? '128M';
const sandboxContainerMemoryLimit = process.env.SANDBOX_CONTAINER_MEMORY_LIMIT?.trim() || '';
const sandboxContainerCpuLimit = process.env.SANDBOX_CONTAINER_CPU_LIMIT?.trim() || '';
const sandboxContainerPidsLimit = process.env.SANDBOX_CONTAINER_PIDS_LIMIT?.trim() || '';
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

/**
 * Exit 127 inside `docker exec` means the executable path in the container was not found.
 * `execFile` surfaces this as `error.code === 127`; our `spawn` wrapper puts "code 127" in the message.
 */
function isDockerExecBinaryMissing(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const e = error as { message?: string; code?: number | string; status?: number };
  if (e.code === 127 || e.status === 127) return true;
  if (typeof e.message === 'string' && /\bcode\s+127\b/i.test(e.message)) return true;
  return false;
}

const DOCKER_OUTPUT_CAP_BYTES = 64 * 1024;

function appendCapped(existing: string, chunk: string, cap: number): string {
  if (existing.length >= cap) return existing;
  const remaining = cap - existing.length;
  return existing + (chunk.length <= remaining ? chunk : chunk.slice(0, remaining));
}

async function runDockerWithInput(args: string[], input: string | Buffer): Promise<string> {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input, 'utf8');
  const child = spawn('docker', args, {
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  let stdout = '';
  let stderr = '';

  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');

  child.stdout.on('data', (chunk) => {
    stdout = appendCapped(stdout, chunk, DOCKER_OUTPUT_CAP_BYTES);
  });
  child.stderr.on('data', (chunk) => {
    stderr = appendCapped(stderr, chunk, DOCKER_OUTPUT_CAP_BYTES);
  });

  const closePromise = once(child, 'close').then(([code]) => Number(code));

  child.stdin.on('error', (err: NodeJS.ErrnoException) => {
    // EPIPE: mysql/psql exited before stdin finished — pipeline will also reject; avoid unhandled.
    if (err.code !== 'EPIPE') {
      child.kill('SIGKILL');
    }
  });

  try {
    await pipeline(Readable.from([buf]), child.stdin);
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e?.code !== 'EPIPE') {
      throw err;
    }
  }

  const code = await closePromise;

  if (code === 0) {
    return stdout.trim();
  }
  const errText = stderr.trim() || stdout.trim();
  const detail =
    errText.length > 2000 ? `${errText.slice(0, 2000)}…` : errText || '(no output)';
  throw new Error(`docker ${args.join(' ')} failed with code ${code}: ${detail}`);
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

async function dockerNetworkExists(networkName: string): Promise<boolean> {
  if (!networkName) return false;
  try {
    await runDocker(['network', 'inspect', networkName]);
    return true;
  } catch {
    return false;
  }
}

async function detectCurrentContainerNetworks(): Promise<string[]> {
  const currentContainer = process.env.HOSTNAME?.trim();
  if (!currentContainer) return [];

  try {
    const names = await runDocker([
      'inspect',
      '-f',
      '{{range $k, $_ := .NetworkSettings.Networks}}{{printf "%s\\n" $k}}{{end}}',
      currentContainer,
    ]);
    return names
      .split('\n')
      .map((name) => name.trim())
      .filter((name) => name.length > 0);
  } catch {
    return [];
  }
}

async function resolveSandboxDockerNetwork(): Promise<string> {
  const candidates: string[] = [];
  if (configuredSandboxDockerNetwork) {
    candidates.push(configuredSandboxDockerNetwork);
  }
  candidates.push(fallbackSandboxDockerNetwork);
  candidates.push(...(await detectCurrentContainerNetworks()));

  const seen = new Set<string>();
  for (const candidate of candidates) {
    if (!candidate || seen.has(candidate)) continue;
    seen.add(candidate);
    if (await dockerNetworkExists(candidate)) {
      return candidate;
    }
  }

  throw new Error(
    `Unable to resolve Docker network for sandbox (checked: ${Array.from(seen).join(', ') || 'none'})`,
  );
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

/**
 * Official mysql:5.x images are amd64-only (no linux/arm64 manifest). On ARM64 hosts,
 * pull/run via QEMU with explicit platform so provisioning does not fail.
 *
 * Microsoft SQL Server Linux containers are also published for amd64 only; without an
 * explicit platform on Apple Silicon the engine often exits immediately and `docker exec` fails.
 */
function sandboxDockerRunPlatform(params: { engine: SchemaSqlEngine; dockerImage: string }): string | undefined {
  if (process.arch !== 'arm64') return undefined;
  if (params.engine === 'sqlserver') {
    return 'linux/amd64';
  }
  if (params.engine !== 'mysql') return undefined;
  const full = params.dockerImage.trim().toLowerCase();
  const repoTag = full.includes('/') ? full.slice(full.lastIndexOf('/') + 1) : full;
  if (/^mysql:5(\.|$)/.test(repoTag)) {
    return 'linux/amd64';
  }
  return undefined;
}

export async function createSandboxEngineContainer(params: {
  containerRef: string;
  engine: SchemaSqlEngine;
  dbName: string;
  dbUser: string;
  dbPassword: string;
  sandboxId: string;
  dockerImage: string;
  /** SQL Server only: SA password (must meet complexity rules). */
  mssqlSaPassword?: string;
}): Promise<void> {
  const {
    containerRef,
    engine,
    dbName,
    dbUser,
    dbPassword,
    sandboxId,
    dockerImage,
    mssqlSaPassword,
  } = params;
  const sandboxDockerNetwork = await resolveSandboxDockerNetwork();

  await ensureSandboxContainerRemoved(containerRef);

  const platform = sandboxDockerRunPlatform({ engine, dockerImage });
  const resourceArgs: string[] = [];
  if (sandboxContainerMemoryLimit) {
    resourceArgs.push('--memory', sandboxContainerMemoryLimit);
  }
  if (sandboxContainerCpuLimit) {
    resourceArgs.push('--cpus', sandboxContainerCpuLimit);
  }
  if (sandboxContainerPidsLimit) {
    resourceArgs.push('--pids-limit', sandboxContainerPidsLimit);
  }
  const baseArgs = [
    'run',
    '-d',
    ...(platform ? ['--platform', platform] : []),
    ...resourceArgs,
    '--name',
    containerRef,
    '--network',
    sandboxDockerNetwork,
    '--add-host',
    'host.docker.internal:host-gateway',
    '--label',
    'sqlcraft.managed=true',
    '--label',
    `sqlcraft.sandbox_id=${sandboxId}`,
    '--label',
    `sqlcraft.engine=${engine}`,
  ];

  if (engine === 'postgresql') {
    await runDocker([
      ...baseArgs,
      '-e',
      `POSTGRES_USER=${dbUser}`,
      '-e',
      `POSTGRES_PASSWORD=${dbPassword}`,
      '-e',
      `POSTGRES_DB=${dbName}`,
      dockerImage,
      'postgres',
      '-c',
      'listen_addresses=*',
      '-c',
      `max_wal_size=${sandboxPostgresMaxWalSize}`,
      '-c',
      `min_wal_size=${sandboxPostgresMinWalSize}`,
      '-c',
      `checkpoint_timeout=${sandboxPostgresCheckpointTimeout}`,
      '-c',
      `checkpoint_completion_target=${sandboxPostgresCheckpointCompletionTarget}`,
      '-c',
      `wal_compression=${sandboxPostgresWalCompression}`,
      '-c',
      `synchronous_commit=${sandboxPostgresSynchronousCommit}`,
    ]);
    return;
  }

  if (engine === 'mysql' || engine === 'mariadb') {
    await runDocker([
      ...baseArgs,
      '-e',
      `MYSQL_ROOT_PASSWORD=${dbPassword}`,
      '-e',
      `MYSQL_DATABASE=${dbName}`,
      '-e',
      `MYSQL_USER=${dbUser}`,
      '-e',
      `MYSQL_PASSWORD=${dbPassword}`,
      dockerImage,
      `--max-allowed-packet=${sandboxMysqlMaxAllowedPacket}`,
      `--innodb-buffer-pool-size=${sandboxMysqlInnodbBufferPoolSize}`,
      `--innodb-log-file-size=${sandboxMysqlInnodbLogFileSize}`,
    ]);
    return;
  }

  if (engine === 'sqlserver') {
    const sa = mssqlSaPassword ?? dbPassword;
    await runDocker([
      ...baseArgs,
      '-e',
      'ACCEPT_EULA=Y',
      '-e',
      `MSSQL_SA_PASSWORD=${sa}`,
      '-e',
      'MSSQL_PID=Developer',
      dockerImage,
    ]);
    return;
  }

  throw new Error(`Unsupported sandbox engine for Docker: ${engine}`);
}

/** @deprecated Use createSandboxEngineContainer */
export async function createSandboxContainer(params: {
  containerRef: string;
  dbName: string;
  dbUser: string;
  dbPassword: string;
  sandboxId: string;
  postgresImage: string;
}): Promise<void> {
  await createSandboxEngineContainer({
    containerRef: params.containerRef,
    engine: 'postgresql',
    dbName: params.dbName,
    dbUser: params.dbUser,
    dbPassword: params.dbPassword,
    sandboxId: params.sandboxId,
    dockerImage: params.postgresImage,
  });
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

/** Official MariaDB 11+ images ship `mariadb-admin` / `mariadb`, not `mysqladmin` / `mysql`. */
function sandboxMysqlFamilyAdminBin(engine: 'mysql' | 'mariadb'): string {
  return engine === 'mariadb' ? 'mariadb-admin' : 'mysqladmin';
}

function sandboxMysqlFamilyClientBin(engine: 'mysql' | 'mariadb'): string {
  return engine === 'mariadb' ? 'mariadb' : 'mysql';
}

export async function waitForSandboxMysql(params: {
  engine: 'mysql' | 'mariadb';
  containerRef: string;
  dbUser: string;
  dbPassword: string;
  timeoutMs?: number;
}): Promise<void> {
  const { engine, containerRef, dbUser, dbPassword, timeoutMs = 90_000 } = params;
  const adminBin = sandboxMysqlFamilyAdminBin(engine);
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    try {
      await runDocker([
        'exec',
        '-e',
        `MYSQL_PWD=${dbPassword}`,
        containerRef,
        adminBin,
        'ping',
        '-h',
        '127.0.0.1',
        `-u${dbUser}`,
        '--silent',
      ]);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  throw new Error(`MySQL/MariaDB sandbox ${containerRef} did not become ready within ${timeoutMs}ms`);
}

async function sqlcmdSelectOne(
  containerRef: string,
  saPassword: string,
  toolsPath: 'tools18' | 'tools',
): Promise<void> {
  const bin =
    toolsPath === 'tools18'
      ? '/opt/mssql-tools18/bin/sqlcmd'
      : '/opt/mssql-tools/bin/sqlcmd';
  const args =
    toolsPath === 'tools18'
      ? ['exec', '-e', `SQLCMDPASSWORD=${saPassword}`, containerRef, bin, '-C', '-S', 'localhost', '-U', 'sa', '-Q', 'SELECT 1', '-b', '-o', '/dev/null']
      : ['exec', '-e', `SQLCMDPASSWORD=${saPassword}`, containerRef, bin, '-S', 'localhost', '-U', 'sa', '-Q', 'SELECT 1', '-b', '-o', '/dev/null'];
  await runDocker(args);
}

export async function waitForSandboxSqlServer(params: {
  containerRef: string;
  saPassword: string;
  timeoutMs?: number;
}): Promise<void> {
  const { containerRef, saPassword, timeoutMs = 120_000 } = params;
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    try {
      try {
        await sqlcmdSelectOne(containerRef, saPassword, 'tools18');
      } catch (error) {
        if (!isDockerExecBinaryMissing(error)) {
          throw error;
        }
        await sqlcmdSelectOne(containerRef, saPassword, 'tools');
      }
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }
  }

  throw new Error(`SQL Server sandbox ${containerRef} did not become ready within ${timeoutMs}ms`);
}

export async function initSqlServerDatabase(params: {
  containerRef: string;
  saPassword: string;
  dbName: string;
}): Promise<void> {
  const { containerRef, saPassword, dbName } = params;
  const escLiteral = dbName.replace(/'/g, "''");
  const escBracket = dbName.replace(/\]/g, ']]');
  const q = `IF DB_ID(N'${escLiteral}') IS NULL CREATE DATABASE [${escBracket}]`;
  const tryRun = async (toolsPath: 'tools18' | 'tools'): Promise<void> => {
    const bin =
      toolsPath === 'tools18'
        ? '/opt/mssql-tools18/bin/sqlcmd'
        : '/opt/mssql-tools/bin/sqlcmd';
    const base =
      toolsPath === 'tools18'
        ? ['exec', '-e', `SQLCMDPASSWORD=${saPassword}`, containerRef, bin, '-C', '-S', 'localhost', '-U', 'sa', '-b', '-Q', q]
        : ['exec', '-e', `SQLCMDPASSWORD=${saPassword}`, containerRef, bin, '-S', 'localhost', '-U', 'sa', '-b', '-Q', q];
    await runDocker(base);
  };
  try {
    await tryRun('tools18');
  } catch (error) {
    if (!isDockerExecBinaryMissing(error)) {
      throw error;
    }
    await tryRun('tools');
  }
}

export async function waitForSandboxEngine(params: {
  engine: SchemaSqlEngine;
  containerRef: string;
  dbUser: string;
  dbName: string;
  dbPassword: string;
  mssqlSaPassword?: string;
  timeoutMs?: number;
}): Promise<void> {
  const { engine, containerRef, dbUser, dbName, dbPassword, mssqlSaPassword, timeoutMs } = params;
  if (engine === 'postgresql') {
    await waitForSandboxPostgres({ containerRef, dbUser, dbName, timeoutMs });
    return;
  }
  if (engine === 'mysql' || engine === 'mariadb') {
    await waitForSandboxMysql({ engine, containerRef, dbUser, dbPassword, timeoutMs });
    return;
  }
  if (engine === 'sqlserver') {
    const sa = mssqlSaPassword ?? dbPassword;
    await waitForSandboxSqlServer({ containerRef, saPassword: sa, timeoutMs });
    return;
  }
  throw new Error(`waitForSandboxEngine: unsupported engine ${engine}`);
}

export async function runPsqlInSandboxContainer(params: {
  containerRef: string;
  dbUser: string;
  dbName: string;
  sql: string | Buffer;
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

/** Run mysql/mariadb CLI in container (MySQL / MariaDB sandboxes). Uses MYSQL_PWD to avoid shell quoting issues. */
export async function runMysqlInSandboxContainer(params: {
  engine: 'mysql' | 'mariadb';
  containerRef: string;
  dbUser: string;
  dbPassword: string;
  dbName: string;
  sql: string | Buffer;
}): Promise<void> {
  const { engine, containerRef, dbUser, dbPassword, dbName, sql } = params;
  const clientBin = sandboxMysqlFamilyClientBin(engine);
  await runDockerWithInput(
    [
      'exec',
      '-i',
      '-e',
      `MYSQL_PWD=${dbPassword}`,
      containerRef,
      clientBin,
      '--default-character-set=utf8mb4',
      `-u${dbUser}`,
      dbName,
    ],
    sql,
  );
}

export async function runSqlcmdInSandboxContainer(params: {
  containerRef: string;
  saPassword: string;
  dbName: string;
  sql: string | Buffer;
}): Promise<void> {
  const { containerRef, saPassword, dbName, sql } = params;

  const tryRun = async (toolsPath: 'tools18' | 'tools'): Promise<void> => {
    const bin =
      toolsPath === 'tools18'
        ? '/opt/mssql-tools18/bin/sqlcmd'
        : '/opt/mssql-tools/bin/sqlcmd';
    const trustArgs = toolsPath === 'tools18' ? ['-C'] : [];
    await runDockerWithInput(
      [
        'exec',
        '-i',
        '-e',
        `SQLCMDPASSWORD=${saPassword}`,
        containerRef,
        bin,
        ...trustArgs,
        '-S', 'localhost',
        '-U', 'sa',
        '-d', dbName,
        '-b',
        '-I',
      ],
      sql,
    );
  };
  try {
    await tryRun('tools18');
  } catch (error) {
    if (!isDockerExecBinaryMissing(error)) {
      throw error;
    }
    await tryRun('tools');
  }
}

export async function runMysqlInSandboxContainerStreaming(params: {
  engine: 'mysql' | 'mariadb';
  containerRef: string;
  dbUser: string;
  dbPassword: string;
  dbName: string;
  source: Readable;
  gzip?: boolean;
}): Promise<void> {
  const { engine, containerRef, dbUser, dbPassword, dbName, source, gzip } = params;
  const clientBin = sandboxMysqlFamilyClientBin(engine);
  const args = [
    'exec',
    '-i',
    '-e',
    `MYSQL_PWD=${dbPassword}`,
    containerRef,
    clientBin,
    '--default-character-set=utf8mb4',
    `-u${dbUser}`,
    dbName,
  ];
  const child = spawn('docker', args, {
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  let stderr = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk: string) => {
    stderr = appendCapped(stderr, chunk, DOCKER_OUTPUT_CAP_BYTES);
  });

  const closePromise = once(child, 'close').then(([code]) => Number(code));

  const pipelinePromise = gzip
    ? pipeline(source, createGunzip(), child.stdin)
    : pipeline(source, child.stdin);

  try {
    await pipelinePromise;
  } catch (err) {
    const detail = stderr.trim().slice(0, 2000);
    child.kill('SIGKILL');
    await closePromise.catch(() => {});
    const base = err instanceof Error ? err.message : String(err);
    throw new Error(
      detail
        ? `mysql restore stream failed (${base}). mysql stderr: ${detail}`
        : `mysql restore stream failed (${base})`,
    );
  }

  const code = await closePromise;
  if (code !== 0) {
    const detail = stderr.trim().slice(0, 2000);
    throw new Error(`mysql restore failed with code ${code}: ${detail || '(no stderr)'}`);
  }
}

function buildMcCatShellScript(artifactRef: string): string {
  const parsed = new URL(artifactRef);
  const bucket = parsed.hostname;
  const objectName = parsed.pathname.replace(/^\/+/, '');

  if (!bucket || !objectName) {
    throw new Error(`Invalid s3 artifact reference: ${artifactRef}`);
  }

  return [
    `mc alias set local http://localhost:9000 ${shQuote(storageAccessKey)} ${shQuote(storageSecretKey)} >/dev/null`,
    `mc cat ${shQuote(`local/${bucket}/${objectName}`)}`,
  ].join(' && ');
}

export async function readS3ObjectViaMinioContainer(artifactRef: string): Promise<Buffer> {
  const script = buildMcCatShellScript(artifactRef);
  return runDockerBinary(['exec', storageDockerContainer, 'sh', '-lc', script]);
}

/**
 * Stream object bytes from MinIO via `mc cat` inside the storage sidecar (no full-file buffer in the worker).
 */
export function createMcCatObjectReadStream(artifactRef: string): Readable {
  const script = buildMcCatShellScript(artifactRef);
  const child = spawn('docker', ['exec', storageDockerContainer, 'sh', '-lc', script], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stderr = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk: string) => {
    stderr += chunk;
  });

  child.on('error', (err) => {
    child.stdout.destroy(err);
  });

  child.on('close', (code) => {
    if (code !== 0 && code !== null) {
      const msg = stderr.trim() || `mc cat exited with code ${code}`;
      child.stdout.destroy(new Error(msg));
    }
  });

  return child.stdout;
}

export async function runPsqlInSandboxContainerStreaming(params: {
  containerRef: string;
  dbUser: string;
  dbName: string;
  source: Readable;
  gzip?: boolean;
}): Promise<void> {
  const { containerRef, dbUser, dbName, source, gzip } = params;
  const args = [
    'exec',
    '-i',
    containerRef,
    'psql',
    '-v',
    'ON_ERROR_STOP=1',
    '-U',
    dbUser,
    '-d',
    dbName,
  ];
  const child = spawn('docker', args, {
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  let stderr = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk: string) => {
    stderr = appendCapped(stderr, chunk, DOCKER_OUTPUT_CAP_BYTES);
  });

  const closePromise = once(child, 'close').then(([code]) => Number(code));

  const pipelinePromise = gzip
    ? pipeline(source, createGunzip(), child.stdin)
    : pipeline(source, child.stdin);

  try {
    await pipelinePromise;
  } catch (err) {
    child.kill('SIGKILL');
    throw err;
  }

  const code = await closePromise;
  if (code !== 0) {
    const detail = stderr.trim().slice(0, 2000);
    throw new Error(`psql restore failed with code ${code}: ${detail || '(no stderr)'}`);
  }
}
