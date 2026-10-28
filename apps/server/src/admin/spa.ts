import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

import { Hono } from 'hono';

import { SERVER_ROOT } from '../config.ts';

/**
 * Serves the React admin build (apps/admin/dist, override with ADMIN_DIST) under /admin/:
 * real files as-is (hashed assets cached for a year), every other non-API GET → index.html
 * (SPA fallback, never cached); 503 plain text when there is no build. /admin/api/* and the POST
 * login/logout are handled before this.
 */
export const SPA_DIR = path.resolve(SERVER_ROOT, process.env.ADMIN_DIST ?? '../admin/dist');

export const spaAvailable = () => existsSync(path.join(SPA_DIR, 'index.html'));

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.map': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};

const CSP =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'";

/** A file inside SPA_DIR for this URL path, or null (no traversal outside the build). */
function resolveFile(urlPath: string): string | null {
  let rel: string;
  try {
    rel = decodeURIComponent(urlPath.replace(/^\/admin\/?/, ''));
  } catch {
    return null;
  }
  if (!rel || rel.includes('\0')) return null;
  const file = path.resolve(SPA_DIR, rel);
  if (!file.startsWith(SPA_DIR + path.sep)) return null;
  return existsSync(file) && statSync(file).isFile() ? file : null;
}

export const spaRoutes = new Hono();

spaRoutes.get('*', (c) => {
  const urlPath = new URL(c.req.url).pathname;
  if (urlPath.startsWith('/admin/api/')) return c.json({ error: 'Not found.' }, 404);
  // Checked per request, so building the admin while the server runs just works.
  if (!spaAvailable()) return c.text('Admin UI not built — run npm run build:admin', 503);
  const file = resolveFile(urlPath);
  if (file && !file.endsWith(`${path.sep}index.html`)) {
    const hashed =
      /[.-][A-Za-z0-9_-]{8,}\.(js|css|woff2?|png|svg|jpe?g|webp)$/.test(file) ||
      file.includes(`${path.sep}assets${path.sep}`);
    c.header('Content-Type', TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream');
    c.header('Cache-Control', hashed ? 'public, max-age=31536000, immutable' : 'no-cache');
    return c.body(readFileSync(file));
  }
  // A missing asset-looking path is a real 404, not the app shell.
  if (/\.[a-z0-9]{1,8}$/i.test(urlPath) && !urlPath.endsWith('.html'))
    return c.text('Not found', 404);
  c.header('Content-Type', TYPES['.html']);
  c.header('Cache-Control', 'no-cache');
  c.header('Content-Security-Policy', CSP);
  return c.body(readFileSync(path.join(SPA_DIR, 'index.html')));
});
