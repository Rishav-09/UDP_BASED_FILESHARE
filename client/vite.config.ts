import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  base: './', // Ensures relative path imports in index.html for Electron compatibility
  server: {
    port: 5173,
    strictPort: true
  }
});
