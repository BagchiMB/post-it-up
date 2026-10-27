import { serve } from '@hono/node-server';
import { Hono, type MiddlewareHandler } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { cors } from 'hono/cors';

import { seedAdminAccount } from './admin/account.ts';
import { adminRoutes } from './admin/index.ts';
import { type AuthEnv, authRoutes, requireAuth, sweepSessions } from './auth.ts';
import { config } from './config.ts';
import { db } from './db.ts';
import { ApiError } from './http.ts';
import {
  failInterruptedMusicChanges,
  jobRoutes,
  requeueUnfinished,
  sweepImages,
  sweepUsage,
} from './jobs.ts';
import { banner, log, logError } from './log.ts';
import { meRoutes } from './me.ts';
import { callContext, sweepLogs } from './outbound.ts';
import { seedPrompts } from './prompts.ts';
import {
  openRouterKey,
  seedServerSettings,
  serverSettings,
  spotifyClientId,
} from './server-settings.ts';
import { spotifyRoutes } from './spotify-routes.ts';
import { spotifySlotsUsed } from './users.ts';

const app = new Hono<AuthEnv>();

// One line per request: method, path (no query string), status, duration.
app.use('*', async (c, next) => {
  const start = performance.now();
  await next();
  log(`${c.req.method} ${c.req.path} ${c.res.status} ${Math.round(performance.now() - start)}ms`);
});

app.use(
  '*',
  cors({
    origin: (origin) => (/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin) ? origin : null),
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Authorization', 'Content-Type'],
    maxAge: 600,
  }),
);

app.use(
  '*',
  bodyLimit({
    maxSize: 25 * 1024 * 1024,
    onError: (c) => c.json({ error: 'Upload is too large (25 MB max).' }, 413),
  }),
);

app.get('/health', (c) => c.json({ ok: true, version: config.version, devLogin: config.devLogin }));

// Public app config (no auth): the app uses this client ID for Spotify login.
app.get('/config', (c) =>
  c.json({
    spotifyClientId: spotifyClientId(),
    spotifyConnect: { available: spotifySlotsUsed() < serverSettings().spotifyUserCap },
    lowFitThreshold: serverSettings().lowFitThreshold,
  }),
);

app.route('/auth', authRoutes);
app.use('/me', requireAuth);
app.use('/me/*', requireAuth);
app.use('/jobs', requireAuth);
app.use('/jobs/*', requireAuth);
app.use('/spotify/*', requireAuth);
// Outgoing calls made while serving a signed-in user are logged against that user.
const withUser: MiddlewareHandler<AuthEnv> = (c, next) =>
  callContext.run({ userId: c.get('userId') }, () => next());
app.use('/me/*', withUser);
app.use('/spotify/*', withUser);
app.route('/me', meRoutes);
app.route('/jobs', jobRoutes);
app.route('/spotify', spotifyRoutes);
// Admin page + API: its own cookie auth, never the app's bearer tokens.
app.route('/admin', adminRoutes);

app.notFound((c) => c.json({ error: 'Not found.' }, 404));

app.onError((err, c) => {
  if (err instanceof ApiError) {
    return c.json({ error: err.message }, err.status as 400);
  }
  logError(`${c.req.method} ${c.req.path}`, err);
  return c.json({ error: 'Something went wrong on the server.' }, 500);
});

// Boot

seedServerSettings();
seedPrompts();
seedAdminAccount();

if (config.devLogin) {
  banner([
    '!'.repeat(72),
    '!!  DEV_LOGIN=1 — POST /auth/dev signs anyone in with just an email.    !!',
    '!!  Local testing only. NEVER enable this on a public server.           !!',
    '!'.repeat(72),
  ]);
}
if (!openRouterKey()) {
  log(
    'No OpenRouter key stored — set OPENROUTER_API_KEY or add one at /admin; jobs fail until then',
  );
}
if (config.googleClientIds.length === 0) {
  log('GOOGLE_CLIENT_IDS is empty — Google sign-in will be rejected');
}

failInterruptedMusicChanges();
requeueUnfinished();
const sweep = () => {
  sweepSessions();
  sweepUsage();
  sweepLogs(serverSettings().logRetentionDays);
  sweepImages().catch((e) => logError('sweep', e));
};
sweep();
const sweepTimer = setInterval(sweep, 60 * 60 * 1000);
sweepTimer.unref();

const server = serve({ fetch: app.fetch, port: config.port, hostname: config.host }, (info) => {
  log(
    `Post It Up server ${config.version} listening on http://${config.host}:${info.port} (data: ${config.dataDir})`,
  );
});

function shutdown(signal: string) {
  log(`${signal} received, shutting down`);
  server.close();
  // Running jobs stay "running" in the DB and are re-queued on the next boot.
  try {
    db.close();
  } catch {}
  process.exit(0);
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
