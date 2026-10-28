import { Module } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { LoggerModule } from 'nestjs-pino';
import { AppConfig } from '../config/config.service.js';

const REQUEST_ID = /^[\w.-]{1,64}$/;

/** Story video URLs carry a signed token in the query string; it must not end up in logs. */
export function stripToken(url: string | undefined): string | undefined {
  return url?.replace(/([?&]token=)[^&]*/g, '$1[redacted]');
}

@Module({
  imports: [
    LoggerModule.forRootAsync({
      inject: [AppConfig],
      useFactory: (config: AppConfig) => ({
        pinoHttp: {
          level: config.get('LOG_LEVEL'),
          base: { instance: config.get('INSTANCE_ID') },
          genReqId: (req: IncomingMessage, res: ServerResponse) => {
            const header = req.headers['x-request-id'];
            const id =
              typeof header === 'string' && REQUEST_ID.test(header) ? header : randomUUID();
            res.setHeader('X-Request-Id', id);
            return id;
          },
          serializers: {
            req: (req: { id: string; method: string; url: string }) => ({
              id: req.id,
              method: req.method,
              url: stripToken(req.url),
            }),
            res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
          },
          autoLogging: {
            ignore: (req: IncomingMessage) => req.url?.startsWith('/api/health') ?? false,
          },
          ...(config.get('NODE_ENV') === 'development' && {
            transport: { target: 'pino-pretty', options: { singleLine: true } },
          }),
        },
      }),
    }),
  ],
})
export class LoggingModule {}
