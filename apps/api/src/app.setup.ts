import { getConnectionToken } from '@nestjs/mongoose';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';
import { HttpExceptionFilter } from './common/errors/http-exception.filter.js';
import { createValidationPipe } from './common/validation.js';
import { AppConfig } from './config/config.service.js';
import { MongoIoAdapter } from './realtime/mongo-io.adapter.js';

export const API_PREFIX = 'api';

/** Everything main.ts applies to the app; tests run the exact same setup. */
export async function configureApp(app: NestExpressApplication): Promise<void> {
  const config = app.get(AppConfig);

  const socketAdapter = new MongoIoAdapter(app);
  await socketAdapter.connect(app.get(getConnectionToken()));
  app.useWebSocketAdapter(socketAdapter);

  app.useLogger(app.get(Logger));
  app.set('trust proxy', config.get('TRUST_PROXY') ? 1 : false);
  app.setGlobalPrefix(API_PREFIX);
  // The API only serves JSON and video; CSP would only break the Swagger UI page.
  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(cookieParser());
  app.useBodyParser('json', { limit: '100kb' });

  const origins = config.get('CORS_ORIGINS');
  if (origins.length > 0) {
    app.enableCors({ origin: origins, credentials: true });
  }

  app.useGlobalPipes(createValidationPipe());
  app.useGlobalFilters(new HttpExceptionFilter());
  app.enableShutdownHooks();

  const document = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle('Realtime Chat API')
      .setDescription('REST API of the chat. Real-time events are documented in the README.')
      .addBearerAuth()
      .build(),
  );
  SwaggerModule.setup(`${API_PREFIX}/docs`, app, document);
}
