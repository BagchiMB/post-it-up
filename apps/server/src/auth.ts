import { getConnInfo } from '@hono/node-server/conninfo';
import { type Context, Hono, type MiddlewareHandler } from 'hono';

import { config } from './config.ts';
import { newToken, sha256 } from './crypto.ts';
import { one, run } from './db.ts';
import { InvalidTokenError, verifyGoogleIdToken } from './google.ts';
import { ApiError, readJson } from './http.ts';
import { log } from './log.ts';
import { getMe, upsertUser } from './users.ts';

export type AuthEnv = { Variables: { userId: string; tokenHash: string } };

const DAY = 24 * 60 * 60 * 1000;
/** Sessions expire after this long without use. */
const SESSION_TTL = 90 * DAY;

function createSession(userId: string) {
  const token = newToken();
  const now = Date.now();
  run(
    'INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)',
    sha256(token),
    userId,
    now,
    now + SESSION_TTL,
  );
  return token;
}

export const requireAuth: MiddlewareHandler<AuthEnv> = async (c, next) => {
  const m = /^Bearer\s+(\S+)$/i.exec(c.req.header('Authorization') ?? '');
  if (!m) throw new ApiError(401, 'Please sign in.');
  const tokenHash = sha256(m[1]);
  const s = one<{ user_id: string; expires_at: number }>(
    'SELECT user_id, expires_at FROM sessions WHERE token_hash = ?',
    tokenHash,
  );
  const now = Date.now();
  if (!s || s.expires_at <= now) {
    if (s) run('DELETE FROM sessions WHERE token_hash = ?', tokenHash);
    throw new ApiError(401, 'Please sign in again.');
  }
  // Slide the expiry forward, at most once a day per session.
  if (s.expires_at - now < SESSION_TTL - DAY) {
    run('UPDATE sessions SET expires_at = ? WHERE token_hash = ?', now + SESSION_TTL, tokenHash);
  }
  c.set('userId', s.user_id);
  c.set('tokenHash', tokenHash);
  await next();
};

export function clientIp(c: Context) {
  if (config.trustProxy) {
    const fwd = c.req.header('X-Forwarded-For')?.split(',')[0]?.trim();
    if (fwd) return fwd;
  }
  try {
    return getConnInfo(c).remote.address ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

// A light fixed-window limit per IP for /auth/*.
const LIMIT = 20;
const WINDOW = 60_000;
const hits = new Map<string, { count: number; resetAt: number }>();
setInterval(() => {
  const now = Date.now();
  for (const [ip, h] of hits) if (h.resetAt <= now) hits.delete(ip);
}, WINDOW).unref();

const rateLimit: MiddlewareHandler = async (c, next) => {
  const ip = clientIp(c);
  const now = Date.now();
  let h = hits.get(ip);
  if (!h || h.resetAt <= now) {
    h = { count: 0, resetAt: now + WINDOW };
    hits.set(ip, h);
  }
  if (++h.count > LIMIT) {
    c.header('Retry-After', String(Math.ceil((h.resetAt - now) / 1000)));
    throw new ApiError(429, 'Too many sign-in attempts. Try again in a minute.');
  }
  await next();
};

function signedIn(c: Context, userId: string, created: boolean, how: string) {
  log(`user ${userId} signed in via ${how}${created ? ' (new user)' : ''}`);
  return c.json({ token: createSession(userId), me: getMe(userId) });
}

export const authRoutes = new Hono<AuthEnv>();
authRoutes.use('*', rateLimit);

authRoutes.post('/google', async (c) => {
  const { idToken } = await readJson(c);
  if (typeof idToken !== 'string' || !idToken)
    throw new ApiError(401, 'Missing Google sign-in token.');
  let who;
  try {
    who = await verifyGoogleIdToken(idToken);
  } catch (e) {
    throw new ApiError(
      401,
      e instanceof InvalidTokenError ? e.message : 'Invalid Google sign-in token.',
    );
  }
  const { id, created } = upsertUser(who.sub, who);
  return signedIn(c, id, created, 'google');
});

if (config.devLogin) {
  authRoutes.post('/dev', async (c) => {
    const { email } = await readJson(c);
    const e = typeof email === 'string' ? email.trim().toLowerCase() : '';
    if (!/^[^\s@]+@[^\s@]+$/.test(e) || e.length > 254)
      throw new ApiError(400, 'Enter an email address.');
    const { id, created } = upsertUser(`dev:${e}`, { email: e });
    return signedIn(c, id, created, 'dev login');
  });
}

authRoutes.post('/logout', requireAuth, (c) => {
  run('DELETE FROM sessions WHERE token_hash = ?', c.get('tokenHash'));
  return c.body(null, 204);
});

/** Drops expired sessions; called by the periodic sweep. */
export function sweepSessions() {
  run('DELETE FROM sessions WHERE expires_at <= ?', Date.now());
}
