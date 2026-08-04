import react from '@vitejs/plugin-react';
// From vitest/config, not vite: same defineConfig plus the `test` block below.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  build: {
    // dist/ is what the runtime stage of client/Dockerfile copies into /www.
    outDir: 'dist',
  },
  server: {
    // Local development only. In production there is no proxy: web and api are
    // two workloads behind ONE host, and the ingress routes /api to the api
    // service. This proxy exists so `npm run dev` sees the same same-origin
    // /api/... URLs the browser will see in production.
    //
    // Note there is no path rewrite: the platform does not strip the prefix
    // either, and the api serves its routes under /api.
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8080',
        changeOrigin: false,
      },
    },
  },
  test: {
    // jsdom for the React tests; serve.test.js opts into the node environment
    // with its own `@vitest-environment node` docblock.
    environment: 'jsdom',
    globals: false,
    include: ['src/**/*.test.{ts,tsx}', 'serve.test.js'],
  },
});
