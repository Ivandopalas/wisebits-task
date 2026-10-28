import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    include: ['src/**/*.spec.ts', 'test/**/*.test.ts'],
    globalSetup: ['test/setup/global-setup.ts'],
    setupFiles: ['test/setup/per-file-env.ts'],
    testTimeout: 20_000,
    hookTimeout: 120_000,
  },
  // Nest needs decorator metadata for DI; the default transformer does not emit it.
  plugins: [swc.vite({ module: { type: 'es6' } })],
});
