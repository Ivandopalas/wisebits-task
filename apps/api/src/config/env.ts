import { hostname } from 'node:os';
import { z } from 'zod';

const list = z
  .string()
  .default('')
  .transform((value) =>
    value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean),
  );

const seconds = z.coerce.number().int().positive();

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  MONGO_URI: z.string().startsWith('mongodb', 'MONGO_URI must be a mongodb:// connection string'),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  // A socket closes on a timer when its token expires, and a Node timer holds at most 2^31 ms.
  ACCESS_TOKEN_TTL_SECONDS: seconds.max(2_147_483).default(900),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),
  MEDIA_TOKEN_TTL_SECONDS: seconds.default(3600),
  COOKIE_SECURE: z.stringbool().default(true),
  CORS_ORIGINS: list,
  TRUST_PROXY: z.stringbool().default(false),
  AUTH_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(20),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  INSTANCE_ID: z.string().default(hostname()),
});

export type Env = z.output<typeof envSchema>;
