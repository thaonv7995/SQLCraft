import { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';
import { config } from '../lib/config';
import { AppError } from '../lib/errors';
import { ApiCode } from '@sqlcraft/types';

export function errorHandler(
  error: FastifyError | Error,
  request: FastifyRequest,
  reply: FastifyReply,
) {
  // AppError instances - known business errors
  if (error instanceof AppError) {
    request.log.warn({ err: error, code: error.code }, error.message);
    return reply.status(error.statusCode).send({
      success: false,
      code: error.code,
      message: error.message,
      data: error.details ?? null,
    });
  }

  // Zod validation errors
  if (error instanceof ZodError) {
    request.log.warn({ err: error }, 'Validation error');
    return reply.status(400).send({
      success: false,
      code: ApiCode.VALIDATION_ERROR,
      message: 'Validation failed',
      data: error.errors.map((e) => ({
        path: e.path.join('.'),
        message: e.message,
      })),
    });
  }

  // Fastify validation errors (from schema validation)
  if ('validation' in error && error.validation) {
    request.log.warn({ err: error }, 'Fastify validation error');
    return reply.status(400).send({
      success: false,
      code: ApiCode.VALIDATION_ERROR,
      message: 'Validation failed',
      data: error.validation,
    });
  }

  // Multipart upload errors (@fastify/multipart)
  const multipartCode = (error as FastifyError).code;
  if (
    multipartCode === 'FST_REQ_FILE_TOO_LARGE' ||
    multipartCode === 'FST_FILES_LIMIT' ||
    multipartCode === 'FST_PARTS_LIMIT'
  ) {
    request.log.warn({ err: error }, 'Multipart upload rejected');
    const path = (request.url ?? '').split('?')[0];
    const isSqlDumpScan =
      path.includes('/admin/databases/scan') || path.includes('/v1/databases/scan');
    const isAvatar = path.includes('/users/me/avatar');
    let message: string;
    if (isSqlDumpScan) {
      message = `SQL dump is too large. Maximum is ${config.SQL_DUMP_MAX_FILE_MB} MB (configure SQL_DUMP_MAX_FILE_MB).`;
    } else if (isAvatar) {
      message = 'Avatar file is too large. Maximum allowed size is 5 MB.';
    } else {
      message = 'Uploaded file is too large.';
    }
    return reply.status(413).send({
      success: false,
      code: ApiCode.VALIDATION_ERROR,
      message,
      data: null,
    });
  }

  // JWT errors — only match errors originating from @fastify/jwt (FST_JWT_* codes).
  // Avoid matching arbitrary DB/column errors whose message happens to contain "jwt".
  const jwtCode = (error as FastifyError).code ?? '';
  if (jwtCode.startsWith('FST_JWT_')) {
    if (jwtCode === 'FST_JWT_AUTHORIZATION_TOKEN_EXPIRED' || error.message?.includes('expired')) {
      return reply.status(401).send({
        success: false,
        code: ApiCode.TOKEN_EXPIRED,
        message: 'Token has expired',
        data: null,
      });
    }
    return reply.status(401).send({
      success: false,
      code: ApiCode.TOKEN_INVALID,
      message: 'Invalid token',
      data: null,
    });
  }

  // Rate limit errors from @fastify/rate-limit
  if ((error as FastifyError).statusCode === 429) {
    return reply.status(429).send({
      success: false,
      code: ApiCode.RATE_LIMITED,
      message: 'Too many requests, please try again later',
      data: null,
    });
  }

  // Unknown / unhandled errors
  request.log.error({ err: error }, 'Unhandled error');
  return reply.status(500).send({
    success: false,
    code: ApiCode.INTERNAL_ERROR,
    message: 'An unexpected error occurred',
    data: process.env.NODE_ENV === 'development' ? error.message : null,
  });
}
