import type { Health } from '@postitup/shared';

/** The Post It Up server (on the laptop for now). A physical phone needs the laptop's LAN IP. */
export const API_URL = (process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:8787').replace(
  /\/+$/,
  '',
);

/** The request never got an answer: the server is off, asleep or on another network. */
export class ServerUnreachableError extends Error {
  constructor() {
    super('Server isn’t running — start it on your laptop.');
    this.name = 'ServerUnreachableError';
  }
}

/** The server answered with an error; `message` is its human-readable `error`. */
export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

let token: string | null = null;
let onUnauthorized: () => void = () => {};

export function setAuthToken(next: string | null) {
  token = next;
}

/** Called when the server rejects the session token (the session store signs out). */
export function setUnauthorizedHandler(handler: () => void) {
  onUnauthorized = handler;
}

async function send(url: string, init: RequestInit, timeoutMs: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch {
    throw new ServerUnreachableError();
  } finally {
    clearTimeout(timer);
  }
}

type Options = { body?: unknown; timeoutMs?: number };

export async function api<T = void>(
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  path: string,
  { body, timeoutMs = 15_000 }: Options = {},
): Promise<T> {
  const sentToken = token;
  const res = await send(
    `${API_URL}${path}`,
    {
      method,
      headers: {
        Accept: 'application/json',
        ...(body !== undefined && { 'Content-Type': 'application/json' }),
        ...(sentToken && { Authorization: `Bearer ${sentToken}` }),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    },
    timeoutMs,
  );

  const data = res.status === 204 ? undefined : await res.json().catch(() => undefined);
  if (!res.ok) {
    // A 401 from /auth/* is a failed sign-in, not an expired session.
    if (res.status === 401 && sentToken && !path.startsWith('/auth/')) onUnauthorized();
    throw new ApiError(data?.error ?? `Server returned ${res.status}`, res.status);
  }
  return data as T;
}

/** `/health`, or null when the server can't be reached. Also used by the background task. */
export async function fetchHealth(): Promise<Health | null> {
  try {
    const res = await send(`${API_URL}/health`, { headers: { Accept: 'application/json' } }, 5_000);
    if (!res.ok) return null;
    return ((await res.json().catch(() => null)) as Health | null) ?? { ok: true };
  } catch {
    return null;
  }
}

/** A message fit to show under a form. */
export function errorMessage(e: unknown) {
  return e instanceof Error ? e.message : 'Something went wrong.';
}
