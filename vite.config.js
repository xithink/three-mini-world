import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import { loadProjectEnv } from './scripts/loadEnv.js';

loadProjectEnv(fileURLToPath(new URL('.', import.meta.url)));

const saveServerPort = process.env.SAVE_SERVER_PORT ?? '3001';

export default defineConfig({
  server: {
    host: '0.0.0.0',
    proxy: {
      '/api': {
        target: `http://127.0.0.1:${saveServerPort}`,
        changeOrigin: true,
        configure: (proxy) => {
          proxy.on('error', (error) => {
            console.error(`Save API proxy failed: http://127.0.0.1:${saveServerPort}`, error.message);
          });
        },
      },
    },
  },
  preview: {
    host: '0.0.0.0',
  },
});
