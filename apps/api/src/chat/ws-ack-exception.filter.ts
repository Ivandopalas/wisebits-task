import { type ArgumentsHost, Catch, Logger, type WsExceptionFilter } from '@nestjs/common';
import type { AckResponse } from '@chat/shared';
import { toApiError } from '../common/errors/to-api-error.js';

/**
 * Socket handlers answer through the ack callback, so errors do too: the client gets the same
 * error shape as from REST instead of a separate "exception" event it would have to correlate.
 */
@Catch()
export class WsAckExceptionFilter implements WsExceptionFilter {
  private readonly logger = new Logger('ChatGateway');

  catch(exception: unknown, host: ArgumentsHost): void {
    const error = toApiError(exception);
    if (error.statusCode >= 500) {
      this.logger.error({ err: exception }, 'Unhandled socket error');
    }
    // Nest passes the ack callback as the argument after the payload.
    const ack = host
      .getArgs()
      .slice(2)
      .find((arg): arg is (r: AckResponse<never>) => void => typeof arg === 'function');
    ack?.({ ok: false, error });
  }
}
