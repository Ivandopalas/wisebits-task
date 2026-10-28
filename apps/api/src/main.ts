import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module.js';
import { configureApp } from './app.setup.js';
import { AppConfig } from './config/config.service.js';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true });
  await configureApp(app);
  await app.listen(app.get(AppConfig).get('PORT'), '0.0.0.0');
}

void bootstrap();
