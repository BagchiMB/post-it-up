import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/** The Node server (apps/server) that serves the admin JSON API and, in production, this build. */
const SERVER = process.env.ADMIN_API_URL ?? 'http://localhost:8787';

// The session cookie is host-only (`Path=/admin`, `SameSite=Strict`), so proxying these paths through
// localhost:5173 keeps it working in dev without any rewriting.
const proxied = { target: SERVER, changeOrigin: false };

export default defineConfig({
  base: '/admin/',
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/admin/api': proxied,
      '/admin/login': {
        ...proxied,
        // Only the JSON sign-in POST goes to the server; GET /admin/login is the React page.
        bypass: (req) => (req.method === 'POST' ? undefined : req.url),
      },
      '/admin/logout': proxied,
    },
  },
  preview: { port: 4173 },
  build: { outDir: 'dist', emptyOutDir: true, sourcemap: true },
});
