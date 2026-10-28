import { HttpException, HttpStatus } from '@nestjs/common';
import type { ApiError } from '@chat/shared';
import { STATUS_CODES } from 'node:http';
import mongoose from 'mongoose';

const DUPLICATE_KEY = 11000;

/**
 * Maps anything thrown inside a handler to the public error format shared by REST responses
 * and socket acks. Unknown errors become a bare 500 so internals never leak to the client.
 */
export function toApiError(exception: unknown): ApiError {
  if (exception instanceof HttpException) {
    const statusCode = exception.getStatus();
    const response = exception.getResponse();
    const body =
      typeof response === 'string' ? { message: response } : (response as Record<string, unknown>);
    const message = Array.isArray(body.message) ? body.message.join('; ') : body.message;
    return {
      statusCode,
      error: statusName(statusCode),
      message: typeof message === 'string' ? message : exception.message,
      ...(body.details !== undefined && { details: body.details }),
    };
  }

  if (isDuplicateKeyError(exception)) {
    return {
      statusCode: HttpStatus.CONFLICT,
      error: statusName(HttpStatus.CONFLICT),
      message: 'Resource already exists',
      details: { fields: Object.keys(exception.keyValue ?? {}) },
    };
  }

  if (exception instanceof mongoose.Error.CastError) {
    return {
      statusCode: HttpStatus.BAD_REQUEST,
      error: statusName(HttpStatus.BAD_REQUEST),
      message: `Invalid value for "${exception.path}"`,
    };
  }

  if (exception instanceof mongoose.Error.ValidationError) {
    return {
      statusCode: HttpStatus.BAD_REQUEST,
      error: statusName(HttpStatus.BAD_REQUEST),
      message: 'Validation failed',
      details: Object.values(exception.errors).map((e) => ({ path: e.path, message: e.message })),
    };
  }

  return {
    statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
    error: statusName(HttpStatus.INTERNAL_SERVER_ERROR),
    message: 'Internal server error',
  };
}

export function isDuplicateKeyError(error: unknown): error is {
  code: number;
  keyValue?: Record<string, unknown>;
  keyPattern?: Record<string, unknown>;
} {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code: unknown }).code === DUPLICATE_KEY
  );
}

function statusName(status: number): string {
  return STATUS_CODES[status] ?? 'Error';
}
