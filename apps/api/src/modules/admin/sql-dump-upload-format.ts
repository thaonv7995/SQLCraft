import { randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { stat, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { createGunzip } from 'node:zlib';
import { Transform } from 'node:stream';
import unzipper, { type File as ZipMember } from 'unzipper';
import { ValidationError } from '../../lib/errors';

/** Read the first bytes of a local file (for gzip / zip magic sniff). */
export async function readLocalHeadBytes(
  filePath: string,
  fileByteSize: number,
  maxHead = 8,
): Promise<Buffer> {
  const { open } = await import('node:fs/promises');
  const fh = await open(filePath, 'r');
  try {
    const n = Math.min(maxHead, fileByteSize);
    const buf = Buffer.allocUnsafe(n);
    const { bytesRead } = await fh.read(buf, 0, n, 0);
    return bytesRead === n ? buf : buf.subarray(0, bytesRead);
  } finally {
    await fh.close();
  }
}

const GZIP_MAGIC_0 = 0x1f;
const GZIP_MAGIC_1 = 0x8b;
const ZIP_MAGIC_0 = 0x50;
const ZIP_MAGIC_1 = 0x4b;

/** Allowed upload names (case-insensitive). */
export function isAllowedSqlDumpUpload(fileName: string): boolean {
  const t = fileName.trim();
  return (
    /\.sql\.gz$/i.test(t) ||
    /\.sql$/i.test(t) ||
    /\.txt$/i.test(t) ||
    /\.zip$/i.test(t)
  );
}

function fileBaseName(filePath: string): string {
  const seg = filePath.replace(/\\/g, '/').split('/').pop() ?? filePath;
  return seg;
}

/**
 * File name used for parse/metadata after decoding (always ends with `.sql` for dump heuristics).
 */
export function effectiveSqlFileNameForMetadata(originalFileName: string): string {
  const t = originalFileName.trim();
  const base = fileBaseName(t);
  if (/\.sql\.gz$/i.test(base)) return base.replace(/\.gz$/i, '');
  if (/\.zip$/i.test(base)) {
    const stem = base.replace(/\.zip$/i, '');
    return stem.endsWith('.sql') ? stem : `${stem}.sql`;
  }
  if (/\.txt$/i.test(base)) return base.replace(/\.txt$/i, '.sql');
  if (/\.sql$/i.test(base)) return base;
  return `${base.replace(/\.[^.]+$/, '') || 'dump'}.sql`;
}

export function isGzipMagic(head: Buffer): boolean {
  return head.length >= 2 && head[0] === GZIP_MAGIC_0 && head[1] === GZIP_MAGIC_1;
}

export function isZipMagic(head: Buffer): boolean {
  return head.length >= 2 && head[0] === ZIP_MAGIC_0 && head[1] === ZIP_MAGIC_1;
}

/** Whether the uploaded bytes need decoding (gzip or zip) before SQL parse / sandbox artifact. */
export function shouldDecodeToPlainSql(fileName: string, head: Buffer): boolean {
  const t = fileName.trim();
  const base = fileBaseName(t);
  if (/\.sql\.gz$/i.test(base) || /\.zip$/i.test(base)) return true;
  if (/\.sql$/i.test(base) && isGzipMagic(head)) return true;
  if (/\.txt$/i.test(base)) return false;
  if (/\.sql$/i.test(base)) return false;
  return false;
}

function createDecompressedSizeLimit(maxBytes: number): Transform {
  let total = 0;
  return new Transform({
    transform(chunk: Buffer, _enc, cb) {
      total += chunk.length;
      if (total > maxBytes) {
        cb(
          new ValidationError(
            `Decompressed SQL exceeds maximum allowed size (${Math.floor(maxBytes / (1024 * 1024))} MiB). ` +
              'Raise SQL_DUMP_MAX_UNCOMPRESSED_MB if appropriate.',
          ),
        );
        return;
      }
      cb(null, chunk);
    },
  });
}

export async function gunzipFileToFile(
  srcPath: string,
  destPath: string,
  maxDecompressedBytes: number,
): Promise<number> {
  await pipeline(
    createReadStream(srcPath),
    createGunzip(),
    createDecompressedSizeLimit(maxDecompressedBytes),
    createWriteStream(destPath),
  );
  const st = await stat(destPath);
  return st.size;
}

export async function gunzipBufferToBuffer(
  input: Buffer,
  maxDecompressedBytes: number,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    const z = createGunzip();
    z.on('data', (chunk: Buffer) => {
      total += chunk.length;
      if (total > maxDecompressedBytes) {
        z.destroy();
        reject(
          new ValidationError(
            `Decompressed SQL exceeds maximum allowed size (${Math.floor(maxDecompressedBytes / (1024 * 1024))} MiB).`,
          ),
        );
        return;
      }
      chunks.push(chunk);
    });
    z.on('end', () => resolve(Buffer.concat(chunks)));
    z.on('error', reject);
    z.end(input);
  });
}

function isSafeZipEntryPath(entryPath: string): boolean {
  const n = entryPath.replace(/\\/g, '/');
  if (n.startsWith('/') || /(^|\/)\.\.(\/|$)/.test(n)) return false;
  return true;
}

function pickSqlFileFromZipEntries(files: ZipMember[]): ZipMember {
  const candidates = files.filter((f) => {
    if (f.type !== 'File') return false;
    if (!isSafeZipEntryPath(f.path)) return false;
    const base = fileBaseName(f.path);
    return /\.sql$/i.test(base);
  });
  if (candidates.length === 0) {
    throw new ValidationError('ZIP archive does not contain any .sql file');
  }
  const lower = (p: string) => p.replace(/\\/g, '/').toLowerCase();
  const dump = candidates.find((f) => {
    const p = lower(f.path);
    return p === 'dump.sql' || p.endsWith('/dump.sql');
  });
  if (dump) return dump;
  const schema = candidates.find((f) => lower(f.path).endsWith('schema.sql'));
  if (schema) return schema;
  return [...candidates].sort((a, b) => a.path.length - b.path.length || a.path.localeCompare(b.path))[0]!;
}

export async function extractSqlFromZipFile(
  zipPath: string,
  maxEntryBytes: number,
): Promise<{ path: string; size: number; effectiveFileName: string; dispose: () => Promise<void> }> {
  const directory = await unzipper.Open.file(zipPath);
  const picked = pickSqlFileFromZipEntries(directory.files);
  const uSize = picked.uncompressedSize ?? 0;
  if (uSize > maxEntryBytes) {
    throw new ValidationError(
      `SQL file inside ZIP is too large when uncompressed (${Math.ceil(uSize / (1024 * 1024))} MiB). ` +
        `Maximum is ${Math.floor(maxEntryBytes / (1024 * 1024))} MiB.`,
    );
  }
  const content = await picked.buffer();
  if (content.length > maxEntryBytes) {
    throw new ValidationError('SQL file inside ZIP exceeds maximum uncompressed size');
  }
  const outPath = join(tmpdir(), `sqlforge-zip-${randomUUID()}.sql`);
  await writeFile(outPath, content);
  const innerBase = fileBaseName(picked.path);
  const effectiveFileName = /\.sql$/i.test(innerBase) ? innerBase : `${innerBase}.sql`;
  return {
    path: outPath,
    size: content.length,
    effectiveFileName,
    dispose: async () => {
      await unlink(outPath).catch(() => undefined);
    },
  };
}

export async function extractSqlFromZipBuffer(
  zipBuffer: Buffer,
  maxEntryBytes: number,
): Promise<{ buffer: Buffer; effectiveFileName: string }> {
  const directory = await unzipper.Open.buffer(zipBuffer);
  const picked = pickSqlFileFromZipEntries(directory.files);
  const uSize = picked.uncompressedSize ?? 0;
  if (uSize > maxEntryBytes) {
    throw new ValidationError(
      `SQL file inside ZIP is too large when uncompressed (${Math.ceil(uSize / (1024 * 1024))} MiB).`,
    );
  }
  const content = await picked.buffer();
  if (content.length > maxEntryBytes) {
    throw new ValidationError('SQL file inside ZIP exceeds maximum uncompressed size');
  }
  const innerBase = fileBaseName(picked.path);
  const effectiveFileName = /\.sql$/i.test(innerBase) ? innerBase : `${innerBase}.sql`;
  return { buffer: content, effectiveFileName };
}

export type NormalizedPlainSqlFile = {
  filePath: string;
  byteSize: number;
  effectiveFileName: string;
  dispose: () => Promise<void>;
};

/**
 * Decode .sql.gz, mislabeled gzip-as-.sql, or .zip on disk into a temporary plain `.sql` file when needed.
 * Plain `.sql` / `.txt` returns the original path and a no-op dispose.
 */
export async function normalizeUploadFileToPlainSqlPath(params: {
  filePath: string;
  byteSize: number;
  fileName: string;
  maxUncompressedBytes: number;
  /** First bytes of the file (for magic sniff); pass at least 4 bytes when possible. */
  head: Buffer;
}): Promise<NormalizedPlainSqlFile> {
  const { filePath, byteSize, fileName, maxUncompressedBytes, head } = params;
  const base = fileBaseName(fileName.trim());

  const noopDispose = async () => undefined;

  if (/\.zip$/i.test(base)) {
    const extracted = await extractSqlFromZipFile(filePath, maxUncompressedBytes);
    return {
      filePath: extracted.path,
      byteSize: extracted.size,
      effectiveFileName: extracted.effectiveFileName,
      dispose: extracted.dispose,
    };
  }

  if (isZipMagic(head)) {
    throw new ValidationError(
      'File content looks like a ZIP archive. Rename the upload to use a .zip extension, or upload plain .sql / .sql.gz.',
    );
  }

  if (/\.sql\.gz$/i.test(base) || (/\.sql$/i.test(base) && isGzipMagic(head))) {
    const outPath = join(tmpdir(), `sqlforge-gunzip-${randomUUID()}.sql`);
    try {
      const outSize = await gunzipFileToFile(filePath, outPath, maxUncompressedBytes);
      return {
        filePath: outPath,
        byteSize: outSize,
        effectiveFileName: effectiveSqlFileNameForMetadata(fileName),
        dispose: async () => {
          await unlink(outPath).catch(() => undefined);
        },
      };
    } catch (e) {
      await unlink(outPath).catch(() => undefined);
      throw e;
    }
  }

  if (/\.txt$/i.test(base) || /\.sql$/i.test(base)) {
    return {
      filePath,
      byteSize,
      effectiveFileName: effectiveSqlFileNameForMetadata(fileName),
      dispose: noopDispose,
    };
  }

  throw new ValidationError('Unsupported SQL dump upload type');
}

/**
 * Decode an in-memory upload (small multipart path) to plain SQL buffer + effective file name.
 */
export async function normalizeUploadBufferToPlainSql(
  buffer: Buffer,
  fileName: string,
  maxUncompressedBytes: number,
): Promise<{ buffer: Buffer; effectiveFileName: string }> {
  const head = buffer.subarray(0, Math.min(8, buffer.length));
  const base = fileBaseName(fileName.trim());

  if (/\.zip$/i.test(base) || isZipMagic(head)) {
    if (!/\.zip$/i.test(base) && isZipMagic(head)) {
      throw new ValidationError('File content looks like a ZIP; upload with a .zip extension.');
    }
    const { buffer: sqlBuf, effectiveFileName } = await extractSqlFromZipBuffer(
      buffer,
      maxUncompressedBytes,
    );
    return { buffer: sqlBuf, effectiveFileName };
  }

  if (/\.sql\.gz$/i.test(base) || (/\.sql$/i.test(base) && isGzipMagic(head))) {
    const plain = await gunzipBufferToBuffer(buffer, maxUncompressedBytes);
    return {
      buffer: plain,
      effectiveFileName: effectiveSqlFileNameForMetadata(fileName),
    };
  }

  if (/\.txt$/i.test(base) || /\.sql$/i.test(base)) {
    return {
      buffer,
      effectiveFileName: effectiveSqlFileNameForMetadata(fileName),
    };
  }

  throw new ValidationError('Unsupported SQL dump upload type');
}
