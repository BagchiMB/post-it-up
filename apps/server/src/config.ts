import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** The server/ directory, whatever the current working directory is. */
export const SERVER_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const envFile = path.join(SERVER_ROOT, '.env');
if (existsSync(envFile) && typeof process.loadEnvFile === 'function') {
  process.loadEnvFile(envFile);
}

const env = (name: string, fallback = '') => (process.env[name] ?? '').trim() || fallback;
const flag = (name: string) => ['1', 'true', 'yes'].includes(env(name).toLowerCase());

export const config = {
  port: Number(env('PORT', '8787')),
  host: env('HOST', '0.0.0.0'),
  dataDir: path.resolve(SERVER_ROOT, env('DATA_DIR', './data')),
  masterKey: env('MASTER_KEY'),
  googleClientIds: env('GOOGLE_CLIENT_IDS')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  devLogin: flag('DEV_LOGIN'),
  /** Admin page login. If either is empty, admin login is disabled. Never logged. */
  adminUsername: env('ADMIN_USERNAME'),
  adminPassword: process.env.ADMIN_PASSWORD ?? '',
  /** Seeds the stored server-wide OpenRouter key on first boot (the owner pays). Never logged. */
  openRouterKey: env('OPENROUTER_API_KEY'),
  /** Seeds for the runtime server settings (edited later in /admin). */
  defaultModel: env('OPENROUTER_DEFAULT_MODEL', 'openai/gpt-6-astra'),
  dailyJobLimit: Math.max(1, Number(env('DAILY_JOB_LIMIT', '20')) || 20),
  spotifyClientId: env('SPOTIFY_CLIENT_ID'),
  /** Server-only secret for the Client Credentials flow. Never sent to the app or logged. */
  spotifyClientSecret: env('SPOTIFY_CLIENT_SECRET'),
  ntfyUrl: env('NTFY_URL', 'https://ntfy.sh').replace(/\/+$/, ''),
  trustProxy: flag('TRUST_PROXY'),
  /** The app's iOS bundle ID, only shown in admin notes (keeps it out of the repo). */
  appBundleId: env('APP_BUNDLE_ID'),
  version: (
    JSON.parse(readFileSync(path.join(SERVER_ROOT, 'package.json'), 'utf8')) as { version: string }
  ).version,
};
