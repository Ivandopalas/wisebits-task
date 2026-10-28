import { type ArgumentsHost, Catch, type ExceptionFilter, Logger } from '@nestjs/common';
import type { Request, Response } from 'express';
import { toApiError } from './to-api-error.js';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('HttpExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost): void {
    if (host.getType() !== 'http') {
      throw exception;
    }
    const ctx = host.switchToHttp();
    const request = ctx.getRequest<Request>();
    const response = ctx.getResponse<Response>();
    const error = toApiError(exception);

    if (error.statusCode >= 500) {
      this.logger.error({ err: exception, path: request.originalUrl }, 'Unhandled error');
    }
    if (response.headersSent) {
      response.end();
      return;
    }
    // Errors raised before the logger middleware (an oversized body) have no request.id yet;
    // nginx's header still identifies the request.
    const requestId = request.id ?? request.headers['x-request-id'];
    response
      .status(error.statusCode)
      .json({ ...error, ...(requestId !== undefined && { requestId: String(requestId) }) });
  }
}
