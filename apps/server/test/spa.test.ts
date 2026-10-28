// Serving the React admin build: 503 until it's built, then index.html for every non-API path,
// long-cached hashed assets, no traversal; the API is unaffected either way. No network.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';

const root = mkdtempSync(path.join(tmpdir(), 'postitup-spa-'));
process.env.DATA_DIR = path.join(root, 'data');
const dist = path.join(root, 'dist');
process.env.ADMIN_DIST = dist;
after(() => rmSync(root, { recursive: true, force: true }));

async function app() {
  const { Hono } = await import('hono');
  const { adminRoutes } = await import('../src/admin/index.ts');
  const { ApiError } = await import('../src/http.ts');
  const h = new Hono();
  h.route('/admin', adminRoutes);
  h.onError((err, c) =>
    c.json({ error: err.message }, err instanceof ApiError ? (err.status as 401) : 500),
  );
  return h;
}

test('no build: plain 503 for the UI, API still answers', async () => {
  const a = await app();
  const res = await a.request('/admin/integrations');
  assert.equal(res.status, 503);
  assert.equal(await res.text(), 'Admin UI not built — run npm run build:admin');
  assert.equal((await a.request('/admin/api/login-status')).status, 200);
});

test('with a build: SPA fallback, cached assets, 404s, no traversal', async () => {
  mkdirSync(path.join(dist, 'assets'), { recursive: true });
  writeFileSync(path.join(dist, 'index.html'), '<!doctype html><title>Admin</title>');
  writeFileSync(path.join(dist, 'assets', 'index-AbCdEf12.js'), 'export {}');
  const a = await app();
  for (const p of [
    '/admin',
    '/admin/',
    '/admin/integrations',
    '/admin/db/tables/users',
    '/admin/login',
  ]) {
    const res = await a.request(p);
    assert.equal(res.status, 200, p);
    assert.match(await res.text(), /<title>Admin<\/title>/, p);
    assert.equal(res.headers.get('Cache-Control'), 'no-cache', p);
  }
  const asset = await a.request('/admin/assets/index-AbCdEf12.js');
  assert.equal(asset.status, 200);
  assert.match(asset.headers.get('Cache-Control') ?? '', /immutable/);
  assert.equal((await a.request('/admin/assets/missing-12345678.js')).status, 404);
  assert.equal((await a.request('/admin/..%2f..%2fpackage.json')).status, 404);
  const api = await a.request('/admin/api/nope');
  assert.equal(api.status, 401, 'API paths never fall back to the app shell');
  assert.match(api.headers.get('Content-Type') ?? '', /json/);
});
