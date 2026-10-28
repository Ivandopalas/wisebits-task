/// <reference types="vitest/config" />
import adapter from '@sveltejs/adapter-node';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

// In development the API runs separately; proxying keeps a single origin, so the refresh
// cookie and the socket work exactly as behind nginx.
const api = process.env.API_URL ?? 'http://localhost:3000';

export default defineConfig({
  plugins: [
    sveltekit({
      adapter: adapter(),
      csp: {
        mode: 'auto',
        directives: {
          'default-src': ['self'],
          'script-src': ['self'],
          'style-src': ['self', 'unsafe-inline'],
          'img-src': ['self', 'data:', 'blob:'],
          'media-src': ['self', 'blob:'],
          'connect-src': ['self'],
          'object-src': ['none'],
          'base-uri': ['self'],
          'frame-ancestors': ['none'],
        },
      },
    }),
  ],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': { target: api, changeOrigin: false },
      '/socket.io': { target: api, ws: true },
    },
  },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
