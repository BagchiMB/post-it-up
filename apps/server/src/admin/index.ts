import { type Context, Hono, type MiddlewareHandler } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';

import { clientIp } from '../auth.ts';
import { config } from '../config.ts';
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
import { layout } from './layout.ts';
import { navItems, PAGES } from './pages.ts';

const COOKIE = 'postitup_admin';

export type AdminEnv = { Variables: { adminSession: string } };

const isHttps = (c: Context) =>
  new URL(c.req.url).protocol === 'https:' ||
  (config.trustProxy && c.req.header('X-Forwarded-Proto') === 'https');

const secureHeaders: MiddlewareHandler = async (c, next) => {
  await next();
  c.header('Cache-Control', 'no-store');
  c.header('X-Frame-Options', 'DENY');
  c.header('Referrer-Policy', 'no-referrer');
  c.header('X-Content-Type-Options', 'nosniff');
  if ((c.res.headers.get('Content-Type') ?? '').startsWith('text/html')) {
    c.header(
      'Content-Security-Policy',
      "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    );
  }
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

adminRoutes.get('/login', (c) => {
  if (validSession(getCookie(c, COOKIE))) return c.redirect('/admin', 302);
  const enabled = loginEnabled();
  return c.html(
    layout({
      title: 'Sign in',
      body: `<div class="login-wrap"><form class="login" id="login">
        <div class="brand"><strong>Post It Up</strong><span>Admin</span></div>
        <h1>Sign in</h1>
        <p class="sub">Manage models, prompts, integrations and users.</p>
        ${enabled ? '' : '<p class="callout">Admin sign-in is disabled. Set ADMIN_USERNAME and ADMIN_PASSWORD in the server\'s .env and restart it.</p>'}
        <label for="username">Username</label>
        <input id="username" autocomplete="username" autocapitalize="none" spellcheck="false" required${enabled ? ' autofocus' : ' disabled'}>
        <label for="password">Password</label>
        <input id="password" type="password" autocomplete="current-password" required${enabled ? '' : ' disabled'}>
        <button type="submit"${enabled ? '' : ' disabled'}>Log in</button>
        <div class="msg" id="msg" role="alert"></div>
      </form></div>`,
      script: `
      $('login').addEventListener('submit', async (e) => {
        e.preventDefault(); say('msg', '');
        try { await api('POST', '/admin/login', { username: $('username').value, password: $('password').value }); location.href = '/admin'; }
        catch (err) { say('msg', err.message, 'bad'); $('password').value = ''; }
      });`,
    }),
  );
});

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
  if (cookie) endSession(cookie);
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
adminRoutes.use('/api/*', requireAdminApi, requireJson);
adminRoutes.route('/api', adminApi);

// Pages ---------------------------------------------------------------------------

const requireAdminPage: MiddlewareHandler<AdminEnv> = async (c, next) => {
  const cookie = getCookie(c, COOKIE);
  if (!cookie || !validSession(cookie)) return c.redirect('/admin/login', 302);
  c.set('adminSession', cookie);
  await next();
};

for (const page of PAGES) {
  const sub = page.path.replace(/^\/admin/, '') || '/';
  adminRoutes.get(sub, requireAdminPage, async (c) => {
    const out = await page.render(c);
    return c.html(
      layout({
        title: out.title ?? page.title,
        ...((out.description ?? page.description)
          ? { description: out.description ?? page.description }
          : {}),
        body: out.body,
        ...(out.script ? { script: out.script } : {}),
        nav: navItems(),
        current: page.section ?? page.path,
      }),
    );
  });
}
