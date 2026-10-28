import { randomBytes } from 'node:crypto';
import { inject } from 'vitest';

// Each test file gets its own database on the shared replica set, so files run in parallel
// without seeing each other's data.
const uri = new URL(inject('mongoUri'));
uri.pathname = `/test_${randomBytes(6).toString('hex')}`;

Object.assign(process.env, {
  NODE_ENV: 'test',
  MONGO_URI: uri.toString(),
  JWT_SECRET: 'test-secret-that-is-long-enough-for-hs256',
  COOKIE_SECURE: 'false',
  LOG_LEVEL: 'silent',
  AUTH_RATE_LIMIT_PER_MINUTE: '10000',
  INSTANCE_ID: 'test',
});
