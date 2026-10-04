import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

// Admin console is a standalone web app. The backend runs on :8180 and already
// allows CORS for http://localhost:* origins, so we call it directly via
// VITE_API_BASE (no dev proxy needed). Never point this at a commercial-cloud
// endpoint by default — the operator self-hosts and injects the base URL.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    host: true,
  },
});
