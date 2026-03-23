import { describe, it, expect } from 'vitest';
import { success, created, error } from '../response';
import { ApiCode } from '@sqlcraft/types';

describe('success()', () => {
  it('returns a success envelope with default message', () => {
    const res = success({ id: '1' });
    expect(res.success).toBe(true);
    expect(res.code).toBe(ApiCode.SUCCESS);
    expect(res.data).toEqual({ id: '1' });
  });

  it('uses a custom message', () => {
    const res = success(null, 'Tracks retrieved');
    expect(res.message).toBe('Tracks retrieved');
  });

  it('uses a custom code', () => {
    const res = success(null, 'OK', ApiCode.CREATED);
    expect(res.code).toBe(ApiCode.CREATED);
  });

  it('preserves data shape', () => {
    const data = { items: [1, 2, 3], total: 3 };
    expect(success(data).data).toEqual(data);
  });
});

describe('created()', () => {
  it('returns a 201-style envelope', () => {
    const res = created({ id: 'abc' }, 'Track created');
    expect(res.success).toBe(true);
    expect(res.code).toBe(ApiCode.CREATED);
    expect(res.message).toBe('Track created');
    expect(res.data).toEqual({ id: 'abc' });
  });

  it('uses a default message when none provided', () => {
    const res = created({});
    expect(res.message).toBe('Created successfully');
  });
});

describe('error()', () => {
  it('returns a failure envelope', () => {
    const res = error('1001', 'Unauthorized', null);
    expect(res.success).toBe(false);
    expect(res.code).toBe('1001');
    expect(res.message).toBe('Unauthorized');
    expect(res.data).toBeNull();
  });

  it('carries extra data', () => {
    const res = error('4001', 'Blocked', { reason: 'DROP not allowed' });
    expect(res.data).toEqual({ reason: 'DROP not allowed' });
  });
});
