import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  root: resolve(__dirname, 'web'),
  build: {
    outDir: resolve(__dirname, 'web/dist'),
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    fs: { allow: [resolve(__dirname)] },
    proxy: {
      '/api': 'http://127.0.0.1:3780',
      '/health': 'http://127.0.0.1:3780',
      '/docs': 'http://127.0.0.1:3780',
    },
  },
});
