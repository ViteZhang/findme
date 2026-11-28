import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  for (const [k, v] of Object.entries(env)) {
    if (process.env[k] === undefined) {
      process.env[k] = v;
    }
  }

  return {
    plugins: [
      react(),
      {
        name: 'findme-local-api',
        configureServer(server) {
          server.middlewares.use(async (req, res, next) => {
            const url = req.url || '';
            if (url.startsWith('/api/app')) {
              const { handleAppApi } = await server.ssrLoadModule('/server/api-handler.ts');
              return handleAppApi(req, res);
            }
            if (url.startsWith('/api/stream')) {
              const { handleStreamApi } = await server.ssrLoadModule('/server/api-handler.ts');
              return handleStreamApi(req, res);
            }
            next();
          });
        },
      },
    ],
    server: {
      port: 5173,
      host: '127.0.0.1',
    },
  };
});
