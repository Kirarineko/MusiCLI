import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    outDir: 'dist',
    target: 'esnext',
    minify: process.env.TAURI_DEBUG !== 'true',
    sourcemap: process.env.TAURI_DEBUG === 'true',
  },
  clearScreen: false,
  server: {
    port: 1430,
    strictPort: false,
    watch: {
      ignored: ['**/src-tauri/**'],
    },
  },
  envPrefix: ['VITE_', 'TAURI_'],
});
