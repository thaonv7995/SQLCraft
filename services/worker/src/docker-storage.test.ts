import assert from 'node:assert/strict';
import { test } from 'vitest';
import { resolveStorageBucket } from './docker';

const key = 'STORAGE_BUCKET';

test('resolveStorageBucket: default and trim (sequential env to avoid parallel flakiness)', () => {
  const prev = process.env[key];
  try {
    delete process.env[key];
    assert.equal(resolveStorageBucket(), 'sqlcraft');

    process.env[key] = '  my-bucket  ';
    assert.equal(resolveStorageBucket(), 'my-bucket');
  } finally {
    if (prev === undefined) delete process.env[key];
    else process.env[key] = prev;
  }
});
