import 'reflect-metadata';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { getConnectionToken } from '@nestjs/mongoose';
import type { Connection } from 'mongoose';

export interface TestApp {
  app: NestExpressApplication;
  connection: Connection;
  /** Base URL of the listening server, e.g. http://127.0.0.1:53412 */
  url: string;
  close(): Promise<void>;
}

/**
 * The config module reads the environment when the app module is first imported, so the
 * import is deferred until overrides are applied. Overrides therefore only take effect on the
 * first call in a test file.
 */
export async function createTestApp(env: Record<string, string> = {}): Promise<TestApp> {
  Object.assign(process.env, env);
  const { AppModule } = await import('../../src/app.module.js');
  const { configureApp } = await import('../../src/app.setup.js');

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({ bufferLogs: true });
  await configureApp(app);
  await app.listen(0, '127.0.0.1');

  const address = app.getHttpServer().address() as { port: number };
  const connection = app.get<Connection>(getConnectionToken());

  return {
    app,
    connection,
    url: `http://127.0.0.1:${address.port}`,
    close: () => app.close(),
  };
}
