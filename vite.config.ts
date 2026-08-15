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
      dedupe: ['react', 'react-dom'],
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
  };
});
