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
    response.status(error.statusCode).json({ ...error, requestId: String(request.id ?? '') });
  }
}
