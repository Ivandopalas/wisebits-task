import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppConfig } from './config.service.js';
import { envSchema } from './env.js';

@Global()
@Module({
  imports: [
    ConfigModule.forRoot({
      ignoreEnvFile: true,
      cache: true,
      validate: (raw) => {
        const result = envSchema.safeParse(raw);
        if (!result.success) {
          const problems = result.error.issues
            .map((issue) => `  ${issue.path.join('.')}: ${issue.message}`)
            .join('\n');
          throw new Error(`Invalid environment configuration:\n${problems}`);
        }
        return result.data;
      },
    }),
  ],
  providers: [AppConfig],
  exports: [AppConfig],
})
export class AppConfigModule {}
