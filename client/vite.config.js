import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

// In development the browser calls /api on the Vite server, which forwards it to
// the API (VITE_PROXY_TARGET). In production set VITE_API_URL to the API's URL.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
    plugins: [react()],
    server: {
      port: Number(env.PORT) || 5173,
      proxy: {
        '/api': { target: env.VITE_PROXY_TARGET || 'http://localhost:5000', changeOrigin: true },
      },
    },
    preview: {
      port: Number(env.PORT) || 4173,
    },
  };
});
