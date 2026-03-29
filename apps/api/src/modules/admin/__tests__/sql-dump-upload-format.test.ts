import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import {
  effectiveSqlFileNameForMetadata,
  gunzipBufferToBuffer,
  isAllowedSqlDumpUpload,
  isGzipMagic,
  normalizeUploadBufferToPlainSql,
  shouldDecodeToPlainSql,
} from '../sql-dump-upload-format';

describe('sql-dump-upload-format', () => {
  it('isAllowedSqlDumpUpload accepts expected extensions', () => {
    expect(isAllowedSqlDumpUpload('dump.sql')).toBe(true);
    expect(isAllowedSqlDumpUpload('dump.SQL')).toBe(true);
    expect(isAllowedSqlDumpUpload('x.sql.gz')).toBe(true);
    expect(isAllowedSqlDumpUpload('notes.txt')).toBe(true);
    expect(isAllowedSqlDumpUpload('bundle.zip')).toBe(true);
    expect(isAllowedSqlDumpUpload('dump.csv')).toBe(false);
  });

  it('effectiveSqlFileNameForMetadata normalizes extensions', () => {
    expect(effectiveSqlFileNameForMetadata('a.sql.gz')).toBe('a.sql');
    expect(effectiveSqlFileNameForMetadata('b.txt')).toBe('b.sql');
    expect(effectiveSqlFileNameForMetadata('c.zip')).toMatch(/\.sql$/);
  });

  it('shouldDecodeToPlainSql detects gzip and zip by name or magic', () => {
    expect(shouldDecodeToPlainSql('x.sql.gz', Buffer.from([0, 0]))).toBe(true);
    expect(shouldDecodeToPlainSql('x.zip', Buffer.from([0x50, 0x4b]))).toBe(true);
    const gzHead = Buffer.from([0x1f, 0x8b, 0, 0]);
    expect(shouldDecodeToPlainSql('misnamed.sql', gzHead)).toBe(true);
    expect(shouldDecodeToPlainSql('plain.sql', Buffer.from('-- hello'))).toBe(false);
  });

  it('isGzipMagic', () => {
    expect(isGzipMagic(Buffer.from([0x1f, 0x8b]))).toBe(true);
    expect(isGzipMagic(Buffer.from('hi'))).toBe(false);
  });

  it('normalizeUploadBufferToPlainSql decodes .sql.gz buffer', async () => {
    const sql = 'SELECT 1;';
    const gz = gzipSync(Buffer.from(sql, 'utf8'));
    const { buffer, effectiveFileName } = await normalizeUploadBufferToPlainSql(
      gz,
      'tiny.sql.gz',
      1024 * 1024,
    );
    expect(buffer.toString('utf8')).toBe(sql);
    expect(effectiveFileName).toBe('tiny.sql');
  });

  it('gunzipBufferToBuffer enforces max size', async () => {
    const big = gzipSync(Buffer.alloc(100, 'x'));
    await expect(gunzipBufferToBuffer(big, 10)).rejects.toThrow(/exceeds maximum/);
  });
});
