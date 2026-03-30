import { ApiCode } from '@sqlcraft/types';

export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Authentication required') {
    super(401, ApiCode.UNAUTHORIZED, message);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'Access denied') {
    super(403, ApiCode.FORBIDDEN, message);
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Resource not found') {
    super(404, ApiCode.NOT_FOUND, message);
  }
}

export class ValidationError extends AppError {
  constructor(message = 'Validation failed', details?: unknown) {
    super(400, ApiCode.VALIDATION_ERROR, message, details);
  }
}

export class ConflictError extends AppError {
  constructor(message = 'Resource already exists') {
    super(409, ApiCode.ALREADY_EXISTS, message);
  }
}

export class SessionNotReadyError extends AppError {
  constructor(message = 'Session is not ready') {
    super(409, ApiCode.SESSION_NOT_READY, message);
  }
}

export class QueryBlockedError extends AppError {
  constructor(message = 'Statement type not allowed', details?: unknown) {
    super(403, ApiCode.QUERY_BLOCKED, message, details);
  }
}

export class InvalidCredentialsError extends AppError {
  constructor(message = 'Invalid email or password') {
    super(401, ApiCode.INVALID_CREDENTIALS, message);
  }
}

export class TokenExpiredError extends AppError {
  constructor(message = 'Token has expired') {
    super(401, ApiCode.TOKEN_EXPIRED, message);
  }
}

export class TokenInvalidError extends AppError {
  constructor(message = 'Invalid token') {
    super(401, ApiCode.TOKEN_INVALID, message);
  }
}

export class SandboxNotReadyError extends AppError {
  constructor(message = 'Sandbox is not ready') {
    super(409, ApiCode.SANDBOX_NOT_READY, message);
  }
}

export class QueryTimeoutError extends AppError {
  constructor(message = 'Query execution timed out') {
    super(408, ApiCode.QUERY_TIMEOUT, message);
  }
}

export class QueryExecutionFailedError extends AppError {
  constructor(message = 'Query execution failed', details?: unknown) {
    super(422, ApiCode.QUERY_EXECUTION_FAILED, message, details);
  }
}

export class ServiceUnavailableError extends AppError {
  constructor(message = 'Service temporarily unavailable', details?: unknown) {
    super(503, ApiCode.SERVICE_UNAVAILABLE, message, details);
  }
}
