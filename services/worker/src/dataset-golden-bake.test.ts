import assert from 'node:assert/strict';
import { test } from 'vitest';
import { computeArtifactFingerprint } from './dataset-golden-bake';

test('computeArtifactFingerprint is stable for same url and size', () => {
  const a = computeArtifactFingerprint('s3://bucket/obj.sql.gz', 1024);
  const b = computeArtifactFingerprint('s3://bucket/obj.sql.gz', 1024);
  assert.equal(a, b);
  assert.match(a, /^sha256:[a-f0-9]{64}$/);
});

test('computeArtifactFingerprint differs when url changes', () => {
  const a = computeArtifactFingerprint('s3://bucket/a.sql', 100);
  const b = computeArtifactFingerprint('s3://bucket/b.sql', 100);
  assert.notEqual(a, b);
});

test('computeArtifactFingerprint differs when byte size changes', () => {
  const a = computeArtifactFingerprint('s3://bucket/x.sql', 100);
  const b = computeArtifactFingerprint('s3://bucket/x.sql', 101);
  assert.notEqual(a, b);
});

test('computeArtifactFingerprint encodes null size distinctly from zero', () => {
  const nullSize = computeArtifactFingerprint('s3://bucket/x.sql', null);
  const zero = computeArtifactFingerprint('s3://bucket/x.sql', 0);
  assert.notEqual(nullSize, zero);
});
