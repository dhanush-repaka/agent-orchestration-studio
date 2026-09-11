import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';
import { adoDevProxy } from './vite.ado-dev';
import { playwrightDevRunner } from './vite.playwright-dev';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react(), adoDevProxy(), playwrightDevRunner()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  optimizeDeps: {
    exclude: ['lucide-react'],
  },
});
