import assert from 'node:assert/strict';
import { test } from 'vitest';
import { sandboxDbNameFromInstanceId } from './sandbox-naming';

test('sandboxDbNameFromInstanceId strips hyphens and caps length', () => {
  assert.equal(
    sandboxDbNameFromInstanceId('a1b2c3d4-e5f6-7890-abcd-ef1234567890'),
    's_a1b2c3d4e5f67890',
  );
});

test('sandboxDbNameFromInstanceId is deterministic', () => {
  const id = '00000000-0000-4000-8000-000000000001';
  assert.equal(sandboxDbNameFromInstanceId(id), sandboxDbNameFromInstanceId(id));
});
