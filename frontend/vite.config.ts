import { fileURLToPath } from 'node:url';

import { reactRouter } from '@react-router/dev/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

// In development the browser talks to the API through this proxy, same-origin, as production
// will behind Caddy (setup proposal §5.12–§5.13). `/files` is where the backend serves uploads it
// stored on its own disk, when no S3 is configured; its URLs for them are relative.
const apiTarget = process.env.API_INTERNAL_URL ?? 'http://localhost:3000';

export default defineConfig({
  plugins: [tailwindcss(), reactRouter()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: { '/api': { target: apiTarget }, '/files': { target: apiTarget } },
  },
});
