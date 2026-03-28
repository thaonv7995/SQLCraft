import * as Minio from 'minio';
import { config } from './config';

let _client: Minio.Client | null = null;
let _publicClient: Minio.Client | null = null;

function makeClient(endpoint: string): Minio.Client {
  const url = new URL(endpoint);
  return new Minio.Client({
    endPoint: url.hostname,
    port: url.port ? parseInt(url.port) : (url.protocol === 'https:' ? 443 : 80),
    useSSL: url.protocol === 'https:',
    accessKey: config.STORAGE_ACCESS_KEY,
    secretKey: config.STORAGE_SECRET_KEY,
    region: 'us-east-1', // Explicit region avoids a network round-trip during presigning
  });
}

/** Internal client — used for upload/delete operations inside Docker network */
function getClient(): Minio.Client {
  if (!_client) _client = makeClient(config.STORAGE_ENDPOINT);
  return _client;
}

/**
 * Public client — used for presigning so the generated URL already contains
 * the public-facing hostname that clients can reach.
 */
function getPublicClient(): Minio.Client {
  if (!_publicClient) {
    _publicClient = makeClient(config.STORAGE_PUBLIC_URL ?? config.STORAGE_ENDPOINT);
  }
  return _publicClient;
}

export async function ensureBucket(): Promise<void> {
  const client = getClient();
  const exists = await client.bucketExists(config.STORAGE_BUCKET);
  if (!exists) {
    await client.makeBucket(config.STORAGE_BUCKET, 'us-east-1');
    // Bucket stays private — objects are served via presigned URLs only
  }
}

/**
 * Upload a file and return the object name (not a URL).
 * Use getPresignedUrl() to generate a time-limited download URL.
 */
export async function uploadFile(
  objectName: string,
  buffer: Buffer,
  contentType: string,
): Promise<string> {
  await ensureBucket();
  const client = getClient();
  await client.putObject(config.STORAGE_BUCKET, objectName, buffer, buffer.length, {
    'Content-Type': contentType,
  });
  return objectName;
}

/**
 * Generate a presigned GET URL for an object, valid for `ttlSeconds`.
 * Uses the public-facing client so the URL already has the correct hostname
 * for external access (no hostname rewriting needed, which would break the signature).
 */
export async function getPresignedUrl(
  objectName: string,
  ttlSeconds = config.STORAGE_PRESIGN_TTL,
): Promise<string> {
  return getPublicClient().presignedGetObject(config.STORAGE_BUCKET, objectName, ttlSeconds);
}

/**
 * Value stored in `users.avatar_url` should be an S3/MinIO object key (e.g. `avatars/{id}.jpg`).
 * API responses must expose a browser-loadable URL: presign keys, pass through absolute http(s) URLs
 * (e.g. OAuth provider avatars) unchanged.
 */
export async function resolvePublicAvatarUrl(
  stored: string | null | undefined,
): Promise<string | null> {
  if (stored == null || stored === '') {
    return null;
  }
  const trimmed = stored.trim();
  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }
  return getPresignedUrl(trimmed);
}

export async function readFile(objectName: string): Promise<Buffer> {
  const client = getClient();
  const stream = await client.getObject(config.STORAGE_BUCKET, objectName);
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

export async function deleteFile(objectName: string): Promise<void> {
  const client = getClient();
  await client.removeObject(config.STORAGE_BUCKET, objectName);
}

export interface StorageObjectInfo {
  name: string;
  lastModified: Date | null;
  size: number;
}

/**
 * List objects under a prefix (S3-compatible). Used for admin pending SQL dump scans.
 * Stops after `maxKeys` objects to bound work on large buckets.
 */
export async function listObjectsWithPrefix(
  prefix: string,
  options?: { recursive?: boolean; maxKeys?: number },
): Promise<StorageObjectInfo[]> {
  await ensureBucket();
  const client = getClient();
  const stream = client.listObjectsV2(
    config.STORAGE_BUCKET,
    prefix,
    options?.recursive ?? true,
  );
  const maxKeys = options?.maxKeys ?? 8_000;
  const out: StorageObjectInfo[] = [];

  for await (const obj of stream) {
    if (!obj || typeof obj !== 'object') continue;
    if ('prefix' in obj && obj.prefix) continue;
    if (!('name' in obj) || typeof obj.name !== 'string' || !obj.name) continue;
    out.push({
      name: obj.name,
      lastModified: 'lastModified' in obj && obj.lastModified instanceof Date ? obj.lastModified : null,
      size: Number('size' in obj ? obj.size : 0),
    });
    if (out.length >= maxKeys) {
      break;
    }
  }

  return out;
}
