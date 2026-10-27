import { createPublicKey, createVerify, type KeyObject, type webcrypto } from 'node:crypto';

import { config } from './config.ts';
import { outbound } from './outbound.ts';

const JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
const ISSUERS = ['accounts.google.com', 'https://accounts.google.com'];
const SKEW_S = 60;

export type GoogleIdentity = { sub: string; email: string; name?: string; picture?: string };

/** Thrown for any reason a token is not accepted; the message is safe to show. */
export class InvalidTokenError extends Error {}

let keys = new Map<string, KeyObject>();
let keysExpireAt = 0;
let inflight: Promise<void> | null = null;

async function fetchKeys() {
  const res = await outbound({ integration: 'google', operation: 'jwks' }, JWKS_URL, {
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Google certs returned ${res.status}`);
  const { keys: jwks } = (await res.json()) as { keys: (webcrypto.JsonWebKey & { kid: string })[] };
  const next = new Map<string, KeyObject>();
  for (const jwk of jwks) {
    if (jwk.kty === 'RSA' && jwk.kid)
      next.set(jwk.kid, createPublicKey({ key: jwk, format: 'jwk' }));
  }
  const maxAge = Number(/max-age=(\d+)/.exec(res.headers.get('cache-control') ?? '')?.[1] ?? 3600);
  keys = next;
  keysExpireAt = Date.now() + maxAge * 1000;
}

function refreshKeys() {
  inflight ??= fetchKeys().finally(() => {
    inflight = null;
  });
  return inflight;
}

async function keyFor(kid: string): Promise<KeyObject | undefined> {
  if (Date.now() >= keysExpireAt) await refreshKeys();
  if (!keys.has(kid)) await refreshKeys(); // Google rotated its keys
  return keys.get(kid);
}

const decodePart = (part: string) =>
  JSON.parse(Buffer.from(part, 'base64url').toString('utf8')) as Record<string, unknown>;

/** Verifies a Google ID token (RS256 signature, issuer, audience, expiry, verified email). */
export async function verifyGoogleIdToken(idToken: string): Promise<GoogleIdentity> {
  if (config.googleClientIds.length === 0) {
    throw new InvalidTokenError('Google sign-in is not configured on this server.');
  }
  const parts = idToken.split('.');
  if (parts.length !== 3) throw new InvalidTokenError('Invalid Google sign-in token.');
  let header: Record<string, unknown>;
  let payload: Record<string, unknown>;
  try {
    header = decodePart(parts[0]);
    payload = decodePart(parts[1]);
  } catch {
    throw new InvalidTokenError('Invalid Google sign-in token.');
  }
  if (header.alg !== 'RS256' || typeof header.kid !== 'string') {
    throw new InvalidTokenError('Invalid Google sign-in token.');
  }

  let key: KeyObject | undefined;
  try {
    key = await keyFor(header.kid);
  } catch {
    throw new InvalidTokenError('Couldn’t reach Google to check the sign-in. Try again.');
  }
  if (!key) throw new InvalidTokenError('Invalid Google sign-in token.');

  const verifier = createVerify('RSA-SHA256');
  verifier.update(`${parts[0]}.${parts[1]}`);
  if (!verifier.verify(key, Buffer.from(parts[2], 'base64url'))) {
    throw new InvalidTokenError('Invalid Google sign-in token.');
  }

  const now = Date.now() / 1000;
  if (!ISSUERS.includes(payload.iss as string))
    throw new InvalidTokenError('Token is not from Google.');
  const aud = payload.aud;
  const auds = Array.isArray(aud) ? aud : [aud];
  if (!auds.some((a) => typeof a === 'string' && config.googleClientIds.includes(a))) {
    throw new InvalidTokenError('Token was issued for a different app.');
  }
  if (typeof payload.exp !== 'number' || payload.exp + SKEW_S < now) {
    throw new InvalidTokenError('Google sign-in expired. Try again.');
  }
  if (typeof payload.iat === 'number' && payload.iat - SKEW_S > now) {
    throw new InvalidTokenError('Invalid Google sign-in token.');
  }
  if (payload.email_verified !== true || typeof payload.email !== 'string') {
    throw new InvalidTokenError('Your Google email address isn’t verified.');
  }
  if (typeof payload.sub !== 'string' || !payload.sub)
    throw new InvalidTokenError('Invalid Google sign-in token.');

  return {
    sub: payload.sub,
    email: payload.email.toLowerCase(),
    ...(typeof payload.name === 'string' ? { name: payload.name } : {}),
    ...(typeof payload.picture === 'string' ? { picture: payload.picture } : {}),
  };
}

/** Admin status check: fetch Google's signing keys now. */
export async function checkJwks() {
  await fetchKeys();
  return keys.size;
}
