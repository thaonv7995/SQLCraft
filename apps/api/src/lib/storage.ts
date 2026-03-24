import * as Minio from 'minio';
import { config } from './config';

let _client: Minio.Client | null = null;

function getClient(): Minio.Client {
  if (!_client) {
    const url = new URL(config.STORAGE_ENDPOINT);
    _client = new Minio.Client({
      endPoint: url.hostname,
      port: url.port ? parseInt(url.port) : (url.protocol === 'https:' ? 443 : 80),
      useSSL: url.protocol === 'https:',
      accessKey: config.STORAGE_ACCESS_KEY,
      secretKey: config.STORAGE_SECRET_KEY,
    });
  }
  return _client;
}

export async function ensureBucket(): Promise<void> {
  const client = getClient();
  const exists = await client.bucketExists(config.STORAGE_BUCKET);
  if (!exists) {
    await client.makeBucket(config.STORAGE_BUCKET, 'us-east-1');
    // Make bucket public for reading avatars
    const policy = JSON.stringify({
      Version: '2012-10-17',
      Statement: [{
        Effect: 'Allow',
        Principal: { AWS: ['*'] },
        Action: ['s3:GetObject'],
        Resource: [`arn:aws:s3:::${config.STORAGE_BUCKET}/*`],
      }],
    });
    await client.setBucketPolicy(config.STORAGE_BUCKET, policy);
  }
}

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
  // Return public URL
  const url = new URL(config.STORAGE_ENDPOINT);
  return `${url.origin}/${config.STORAGE_BUCKET}/${objectName}`;
}

export async function deleteFile(objectName: string): Promise<void> {
  const client = getClient();
  await client.removeObject(config.STORAGE_BUCKET, objectName);
}
