import { randomBytes, scrypt, scryptSync, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

import { config } from '../config.ts';
import { newToken, sha256 } from '../crypto.ts';
import { one, run } from '../db.ts';
import { banner, log } from '../log.ts';

/**
 * The single admin account. Seeded from ADMIN_USERNAME / ADMIN_PASSWORD on first boot; afterwards
 * the DB is the source of truth (env ignored) unless ADMIN_RESET=1 re-seeds it for one boot.
 */

const scryptAsync = promisify(scrypt) as (
  pw: string,
  salt: Buffer,
  len: number,
  opts: object,
) => Promise<Buffer>;
const N = 16384;
const R = 8;
const P = 1;
const LEN = 32;

export async function hashPassword(password: string) {
  const salt = randomBytes(16);
  const hash = await scryptAsync(password, salt, LEN, { N, r: R, p: P });
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

function hashPasswordSync(password: string) {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, LEN, { N, r: R, p: P });
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export async function verifyPassword(password: string, stored: string) {
  const [scheme, n, r, p, salt, hash] = stored.split('$');
  if (scheme !== 'scrypt') return false;
  const expected = Buffer.from(hash, 'base64');
  const actual = await scryptAsync(password, Buffer.from(salt, 'base64'), expected.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
  });
  return timingSafeEqual(actual, expected);
}

/** Verified against when there's no account, so a wrong username costs the same time as a wrong password. */
const DUMMY_HASH = hashPasswordSync(randomBytes(16).toString('hex'));

export type AdminAccount = {
  username: string;
  password_hash: string;
  weak_password: number;
  updated_at: number;
  last_login_at: number | null;
  last_login_ip: string | null;
  prev_login_at: number | null;
  prev_login_ip: string | null;
};

export const getAccount = () => one<AdminAccount>('SELECT * FROM admin_account WHERE id = 1');
export const loginEnabled = () => !!getAccount();

const WEAK = 12;

export function seedAdminAccount() {
  const existing = getAccount();
  const reset = ['1', 'true', 'yes'].includes((process.env.ADMIN_RESET ?? '').toLowerCase());
  const haveEnv = !!(config.adminUsername && config.adminPassword);
  if ((!existing || reset) && haveEnv) {
    run(
      `INSERT INTO admin_account (id, username, password_hash, weak_password, updated_at)
       VALUES (1, ?, ?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET username = excluded.username, password_hash = excluded.password_hash,
         weak_password = excluded.weak_password, updated_at = excluded.updated_at`,
      config.adminUsername,
      hashPasswordSync(config.adminPassword),
      config.adminPassword.length < WEAK ? 1 : 0,
      Date.now(),
    );
    if (reset && existing) {
      banner([
        '!'.repeat(72),
        '!!  ADMIN_RESET=1 — admin account re-seeded from ADMIN_USERNAME/ADMIN_PASSWORD.',
        '!!  Remove ADMIN_RESET from the environment now.',
        '!'.repeat(72),
      ]);
    } else {
      log(`admin account "${config.adminUsername}" created from ADMIN_USERNAME/ADMIN_PASSWORD`);
    }
  } else if (reset && !haveEnv) {
    log('ADMIN_RESET=1 ignored: ADMIN_USERNAME and ADMIN_PASSWORD must both be set');
  }
  const account = getAccount();
  if (!account)
    log(
      'Admin login is disabled: set ADMIN_USERNAME and ADMIN_PASSWORD (first boot) to create the admin',
    );
  else if (account.weak_password)
    log('WARNING: the admin password is shorter than 12 characters — change it at /admin/account');
}

// Sessions (in memory; a restart means signing in again). Keyed by sha256(cookie value).

export const SESSION_MS = 12 * 60 * 60 * 1000;
const sessions = new Map<string, number>();
setInterval(() => {
  const now = Date.now();
  for (const [k, exp] of sessions) if (exp <= now) sessions.delete(k);
}, 60_000).unref();

export function createSession() {
  const token = newToken();
  sessions.set(sha256(token), Date.now() + SESSION_MS);
  return token;
}

export function validSession(cookie: string | undefined) {
  const exp = cookie ? sessions.get(sha256(cookie)) : undefined;
  return !!exp && exp > Date.now();
}

export const endSession = (cookie: string) => sessions.delete(sha256(cookie));

export function endOtherSessions(keep: string) {
  const k = sha256(keep);
  for (const key of [...sessions.keys()]) if (key !== k) sessions.delete(key);
}

/** Both username and password are always checked. */
export async function checkLogin(username: string, password: string) {
  const account = getAccount();
  const passOk = await verifyPassword(password, account?.password_hash ?? DUMMY_HASH);
  const userOk = !!account && username.trim().toLowerCase() === account.username.toLowerCase();
  return !!account && userOk && passOk;
}

export function recordLogin(ip: string) {
  run(
    `UPDATE admin_account SET prev_login_at = last_login_at, prev_login_ip = last_login_ip,
       last_login_at = ?, last_login_ip = ? WHERE id = 1`,
    Date.now(),
    ip,
  );
}

export async function changePassword(newPassword: string) {
  run(
    'UPDATE admin_account SET password_hash = ?, weak_password = ?, updated_at = ? WHERE id = 1',
    await hashPassword(newPassword),
    newPassword.length < WEAK ? 1 : 0,
    Date.now(),
  );
}
