import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { Buffer } from 'buffer';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  return {
    plugins: [react()],
    define: {
      'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
      'global': 'globalThis',
    },
    resolve: {
      alias: {
        buffer: 'buffer',
      },
    },
    optimizeDeps: {
      include: ['buffer', '@solana/web3.js', '@coral-xyz/anchor'],
      esbuildOptions: {
        target: 'esnext',
        define: {
          global: 'globalThis',
        },
      },
    },
    server: {
      port: 5173,
      // Forward any /api/* request to the backend Express server.
      // Without this, fetch('/api/...') from the React app would try
      // to hit localhost:5173/api/... (Vite's own server), which has
      // no such route and returns an empty response — causing
      // "Unexpected end of JSON input" errors in the frontend.
      proxy: {
        '/api': {
          target: 'http://localhost:3000',
          changeOrigin: true,
        },
      },
    },
  };
});
