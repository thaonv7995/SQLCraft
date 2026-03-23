import { describe, it, expect } from 'vitest';
import {
  AppError,
  UnauthorizedError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
  ConflictError,
  SessionNotReadyError,
  QueryBlockedError,
  QueryTimeoutError,
  QueryExecutionFailedError,
  InvalidCredentialsError,
  TokenExpiredError,
  TokenInvalidError,
  SandboxNotReadyError,
} from '../errors';

describe('AppError', () => {
  it('stores statusCode, code, message and details', () => {
    const err = new AppError(400, 'TEST_CODE', 'test message', { extra: 1 });
    expect(err.statusCode).toBe(400);
    expect(err.code).toBe('TEST_CODE');
    expect(err.message).toBe('test message');
    expect(err.details).toEqual({ extra: 1 });
  });

  it('is an instance of Error', () => {
    const err = new AppError(500, 'ERR', 'oops');
    expect(err).toBeInstanceOf(Error);
  });
});

describe('HTTP-specific errors', () => {
  it('UnauthorizedError has status 401', () => {
    const err = new UnauthorizedError();
    expect(err.statusCode).toBe(401);
    expect(err.message).toMatch(/auth/i);
  });

  it('ForbiddenError has status 403', () => {
    const err = new ForbiddenError();
    expect(err.statusCode).toBe(403);
  });

  it('NotFoundError has status 404', () => {
    const err = new NotFoundError('Track not found');
    expect(err.statusCode).toBe(404);
    expect(err.message).toBe('Track not found');
  });

  it('ValidationError has status 400 and stores details', () => {
    const err = new ValidationError('Invalid input', { field: 'email' });
    expect(err.statusCode).toBe(400);
    expect(err.details).toEqual({ field: 'email' });
  });

  it('ConflictError has status 409', () => {
    expect(new ConflictError().statusCode).toBe(409);
  });

  it('SessionNotReadyError has status 409', () => {
    expect(new SessionNotReadyError().statusCode).toBe(409);
  });

  it('QueryBlockedError has status 403', () => {
    const err = new QueryBlockedError('DROP not allowed', { sql: 'DROP TABLE x' });
    expect(err.statusCode).toBe(403);
    expect(err.details).toEqual({ sql: 'DROP TABLE x' });
  });

  it('QueryTimeoutError has status 408', () => {
    expect(new QueryTimeoutError().statusCode).toBe(408);
  });

  it('QueryExecutionFailedError has status 422', () => {
    expect(new QueryExecutionFailedError('syntax error').statusCode).toBe(422);
  });

  it('InvalidCredentialsError has status 401', () => {
    expect(new InvalidCredentialsError().statusCode).toBe(401);
  });

  it('TokenExpiredError has status 401', () => {
    expect(new TokenExpiredError().statusCode).toBe(401);
  });

  it('TokenInvalidError has status 401', () => {
    expect(new TokenInvalidError().statusCode).toBe(401);
  });

  it('SandboxNotReadyError has status 409', () => {
    expect(new SandboxNotReadyError().statusCode).toBe(409);
  });
});

describe('custom messages', () => {
  it('NotFoundError accepts a custom message', () => {
    const err = new NotFoundError('Session not found');
    expect(err.message).toBe('Session not found');
  });

  it('QueryBlockedError accepts a custom message', () => {
    const err = new QueryBlockedError('TRUNCATE is not allowed');
    expect(err.message).toBe('TRUNCATE is not allowed');
  });
});
