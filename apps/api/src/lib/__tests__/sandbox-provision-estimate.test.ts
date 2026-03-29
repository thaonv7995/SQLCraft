import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const storageMocks = vi.hoisted(() => ({
  statS3ArtifactUrl: vi.fn(),
}));

vi.mock('../storage', () => ({
  statS3ArtifactUrl: storageMocks.statS3ArtifactUrl,
}));

import { computeSandboxProvisioningEstimate } from '../sandbox-provision-estimate';

describe('computeSandboxProvisioningEstimate', () => {
  beforeEach(() => {
    storageMocks.statS3ArtifactUrl.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('uses object size and dialect for postgres', async () => {
    storageMocks.statS3ArtifactUrl.mockResolvedValue({ size: 10 * 1024 * 1024, etag: 'x' });
    const now = new Date('2026-03-28T12:00:00.000Z');
    const est = await computeSandboxProvisioningEstimate({
      artifactUrl: 's3://bucket/datasets/x.sql',
      dialect: 'postgresql',
      tableCount: 4,
      now,
    });
    expect(est.estimatedSeconds).toBeGreaterThanOrEqual(25);
    expect(est.estimatedReadyAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(storageMocks.statS3ArtifactUrl).toHaveBeenCalledWith('s3://bucket/datasets/x.sql');
  });

  it('inflates compressed sql.gz size heuristic', async () => {
    storageMocks.statS3ArtifactUrl.mockResolvedValue({ size: 5 * 1024 * 1024, etag: 'x' });
    const now = new Date('2026-03-28T12:00:00.000Z');
    const sqlEst = await computeSandboxProvisioningEstimate({
      artifactUrl: 's3://b/k.sql',
      dialect: 'postgresql',
      tableCount: 0,
      now,
    });
    const gzEst = await computeSandboxProvisioningEstimate({
      artifactUrl: 's3://b/k.sql.gz',
      dialect: 'postgresql',
      tableCount: 0,
      now,
    });
    expect(gzEst.estimatedSeconds).toBeGreaterThan(sqlEst.estimatedSeconds);
  });

  it('falls back when stat fails', async () => {
    storageMocks.statS3ArtifactUrl.mockResolvedValue(null);
    const est = await computeSandboxProvisioningEstimate({
      artifactUrl: 's3://bucket/missing',
      dialect: 'postgresql',
      tableCount: 0,
      now: new Date('2026-03-28T12:00:00.000Z'),
    });
    expect(est.estimatedSeconds).toBeGreaterThanOrEqual(25);
  });
});
