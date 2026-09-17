import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    proxy: {
      '/socket.io': {
        target: 'https://api-falfoos.duckdns.org',
        ws: true,
        changeOrigin: true,
        secure: true,
      },
      '/api': {
        target: 'https://api-falfoos.duckdns.org',
        changeOrigin: true,
        secure: true,
      },
    },
  },
});