import assert from 'node:assert/strict';
import { test } from 'vitest';
import { shouldAttemptGoldenSnapshotRestore } from './dataset-loader';

test('shouldAttemptGoldenSnapshotRestore: false when prefer artifact', () => {
  assert.equal(
    shouldAttemptGoldenSnapshotRestore({
      preferArtifactOverGoldenSnapshot: true,
      sandboxGoldenSnapshotUrl: 's3://b/k/s.dump',
    }),
    false,
  );
});

test('shouldAttemptGoldenSnapshotRestore: false when no snapshot url', () => {
  assert.equal(
    shouldAttemptGoldenSnapshotRestore({
      preferArtifactOverGoldenSnapshot: false,
      sandboxGoldenSnapshotUrl: null,
    }),
    false,
  );
  assert.equal(
    shouldAttemptGoldenSnapshotRestore({
      sandboxGoldenSnapshotUrl: '',
    }),
    false,
  );
  assert.equal(
    shouldAttemptGoldenSnapshotRestore({
      sandboxGoldenSnapshotUrl: '   ',
    }),
    false,
  );
});

test('shouldAttemptGoldenSnapshotRestore: true when snapshot url present and not prefer-artifact', () => {
  assert.equal(
    shouldAttemptGoldenSnapshotRestore({
      preferArtifactOverGoldenSnapshot: false,
      sandboxGoldenSnapshotUrl: 's3://sqlcraft/golden/x.dump',
    }),
    true,
  );
  assert.equal(
    shouldAttemptGoldenSnapshotRestore({
      sandboxGoldenSnapshotUrl: '  s3://sqlcraft/golden/x.dump  ',
    }),
    true,
  );
});
