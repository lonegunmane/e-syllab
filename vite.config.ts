import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default defineConfig(() => {
  return {
    plugins: [react()],
    define: {
      'global': 'globalThis',
    },
    resolve: {
      dedupe: ['react', 'react-dom'],
      alias: {
        buffer: 'buffer',
      },
    },
    optimizeDeps: {
      include: [
        'react',
        'react-dom',
        'react/jsx-runtime',
        'react-dom/client',
        'buffer',
        'lucide-react',
        'motion/react',
        'recharts',
        '@solana/web3.js',
        '@coral-xyz/anchor',
      ],
      esbuildOptions: {
        target: 'esnext',
        define: {
          global: 'globalThis',
        },
      },
    },
  };
});
