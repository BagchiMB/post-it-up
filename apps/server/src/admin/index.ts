import { type Context, Hono, type MiddlewareHandler } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';

import { clientIp } from '../auth.ts';
import { config } from '../config.ts';
import { sha256 } from '../crypto.ts';
import { ApiError, readJson } from '../http.ts';
import { log } from '../log.ts';
import {
  checkLogin,
  createSession,
  endSession,
  loginEnabled,
  recordLogin,
  SESSION_MS,
  validSession,
} from './account.ts';
import { adminApi } from './api.ts';
import { dbApi } from './db-api.ts';
import { closeWriteWindow } from './db-browser.ts';
import { sessionView } from './session.ts';
import { spaRoutes } from './spa.ts';

const COOKIE = 'postitup_admin';

export type AdminEnv = { Variables: { adminSession: string } };

const isHttps = (c: Context) =>
  new URL(c.req.url).protocol === 'https:' ||
  (config.trustProxy && c.req.header('X-Forwarded-Proto') === 'https');

const secureHeaders: MiddlewareHandler = async (c, next) => {
  await next();
  if (!c.res.headers.has('Cache-Control')) c.header('Cache-Control', 'no-store');
  c.header('X-Frame-Options', 'DENY');
  c.header('Referrer-Policy', 'no-referrer');
  c.header('X-Content-Type-Options', 'nosniff');
};

const requireJson: MiddlewareHandler = async (c, next) => {
  if (c.req.method !== 'GET' && c.req.method !== 'HEAD') {
    if (!/^application\/json\b/i.test(c.req.header('Content-Type') ?? '')) {
      throw new ApiError(415, 'Send JSON (Content-Type: application/json).');
    }
  }
  await next();
};

// Login throttle: 10 attempts per 15 minutes per IP.
const attempts = new Map<string, { count: number; resetAt: number }>();
setInterval(() => {
  const now = Date.now();
  for (const [ip, a] of attempts) if (a.resetAt <= now) attempts.delete(ip);
}, 60_000).unref();

function throttle(ip: string) {
  const now = Date.now();
  let a = attempts.get(ip);
  if (!a || a.resetAt <= now) {
    a = { count: 0, resetAt: now + 15 * 60_000 };
    attempts.set(ip, a);
  }
  if (++a.count > 10) throw new ApiError(429, 'Too many attempts. Try again in a few minutes.');
}

export const adminRoutes = new Hono<AdminEnv>();
adminRoutes.use('*', secureHeaders);

// Sign-in ----------------------------------------------------------------------

adminRoutes.post('/login', requireJson, async (c) => {
  if (!loginEnabled()) {
    throw new ApiError(
      503,
      'Admin sign-in is disabled: set ADMIN_USERNAME and ADMIN_PASSWORD on the server.',
    );
  }
  const ip = clientIp(c);
  throttle(ip);
  const { username, password } = await readJson(c);
  const ok = await checkLogin(
    typeof username === 'string' ? username : '',
    typeof password === 'string' ? password : '',
  );
  if (!ok) {
    log('admin sign-in failed');
    throw new ApiError(401, 'Wrong username or password.');
  }
  recordLogin(ip);
  setCookie(c, COOKIE, createSession(), {
    httpOnly: true,
    sameSite: 'Strict',
    path: '/admin',
    secure: isHttps(c),
    maxAge: SESSION_MS / 1000,
  });
  log('admin signed in');
  return c.json({ ok: true });
});

adminRoutes.post('/logout', requireJson, (c) => {
  const cookie = getCookie(c, COOKIE);
  if (cookie) {
    endSession(cookie);
    closeWriteWindow(sha256(cookie)); // DB write mode ends with the session
  }
  deleteCookie(c, COOKIE, { path: '/admin' });
  return c.body(null, 204);
});

// JSON API ------------------------------------------------------------------------

const requireAdminApi: MiddlewareHandler<AdminEnv> = async (c, next) => {
  const cookie = getCookie(c, COOKIE);
  if (!cookie || !validSession(cookie)) throw new ApiError(401, 'Please sign in.');
  c.set('adminSession', cookie);
  await next();
};
/** Unauthenticated: lets the login page say "admin login disabled" before anyone submits. */
adminRoutes.get('/api/login-status', (c) => c.json({ enabled: loginEnabled() }));

adminRoutes.use('/api/*', requireAdminApi, requireJson);

/** For the SPA: who is signed in (401 when not). */
adminRoutes.get('/api/session', (c) => c.json(sessionView()));
adminRoutes.route('/api/db', dbApi);
adminRoutes.route('/api', adminApi);

// UI ------------------------------------------------------------------------------
// The React admin (apps/admin, built to apps/admin/dist). Every non-API GET /admin/* is the SPA;
// without a build it's a plain 503 telling you how to build it.
adminRoutes.route('/', spaRoutes);
