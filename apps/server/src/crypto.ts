import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { config } from './config.ts';
import { log } from './log.ts';

function parseKey(text: string): Buffer {
  const t = text.trim();
  const key = /^[0-9a-f]{64}$/i.test(t) ? Buffer.from(t, 'hex') : Buffer.from(t, 'base64');
  if (key.length !== 32) throw new Error('MASTER_KEY must be 32 bytes (64 hex chars or base64).');
  return key;
}

function loadMasterKey(): Buffer {
  if (config.masterKey) return parseKey(config.masterKey);
  const file = path.join(config.dataDir, 'master.key');
  if (!existsSync(file)) {
    mkdirSync(config.dataDir, { recursive: true });
    writeFileSync(file, randomBytes(32).toString('hex') + '\n', { mode: 0o600, flag: 'wx' });
    log(`generated a new master key at ${file} — back it up with app.db`);
  }
  return parseKey(readFileSync(file, 'utf8'));
}

const MASTER_KEY = loadMasterKey();

/**
 * AES-256-GCM. `context` (e.g. "<userId>:openrouter") is bound as associated data, so a
 * ciphertext copied to another user or field won't decrypt.
 */
export function encrypt(plain: string, context: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', MASTER_KEY, iv);
  cipher.setAAD(Buffer.from(context));
  const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return `v1:${Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64')}`;
}

export function decrypt(stored: string, context: string): string {
  if (!stored.startsWith('v1:')) throw new Error('Unknown secret format');
  const raw = Buffer.from(stored.slice(3), 'base64');
  const decipher = createDecipheriv('aes-256-gcm', MASTER_KEY, raw.subarray(0, 12));
  decipher.setAAD(Buffer.from(context));
  decipher.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8');
}

export const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');

/** Random 32-byte bearer token (base64url). */
export const newToken = () => randomBytes(32).toString('base64url');

export const newId = () => randomBytes(12).toString('base64url');

/** Lowercase letters and digits, unbiased. */
export function randomAlnum(length: number) {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let out = '';
  while (out.length < length) {
    for (const b of randomBytes(length * 2)) {
      if (b < 252 && out.length < length) out += alphabet[b % 36];
    }
  }
  return out;
}
