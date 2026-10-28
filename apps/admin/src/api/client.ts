/**
 * Fetch wrapper for the admin JSON API: same-origin cookie auth, JSON in/out, `{ error }` bodies
 * become `ApiError`s, and a 401 (expired/missing session) triggers the global sign-in redirect.
 */

export class ApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export type RequestOptions = {
  /** A 401 here means "wrong password", not "signed out" (sign-in, write-mode unlock). */
  noAuthRedirect?: boolean;
  signal?: AbortSignal;
};

let onUnauthorized: (() => void) | null = null;
/** Registered once by the app shell: clears cached data and sends the admin to the sign-in page. */
export const setUnauthorizedHandler = (fn: () => void) => {
  onUnauthorized = fn;
};

async function send(method: Method, path: string, body: unknown, opts: RequestOptions) {
  // The server requires `Content-Type: application/json` on every non-GET request (CSRF guard),
  // even ones without a payload, so those send `{}`.
  const res = await fetch(path, {
    method,
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: method === 'GET' ? undefined : JSON.stringify(body ?? {}),
    ...(opts.signal ? { signal: opts.signal } : {}),
  });
  if (res.status === 401 && !opts.noAuthRedirect) {
    onUnauthorized?.();
    throw new ApiError(401, 'Please sign in.');
  }
  return res;
}

async function errorFrom(res: Response): Promise<ApiError> {
  const data = (await res.json().catch(() => null)) as { error?: unknown } | null;
  const message =
    data && typeof data.error === 'string' && data.error
      ? data.error
      : `Request failed (${res.status})`;
  return new ApiError(res.status, message);
}

export async function request<T>(
  method: Method,
  path: string,
  body?: unknown,
  opts: RequestOptions = {},
): Promise<T> {
  const res = await send(method, path, body, opts);
  if (!res.ok) throw await errorFrom(res);
  if (res.status === 204) return null as T;
  return (await res.json().catch(() => null)) as T;
}

/** For endpoints that return a file (CSV export). */
export async function requestBlob(path: string, body: unknown): Promise<Blob> {
  const res = await send('POST', path, body, {});
  if (!res.ok) throw await errorFrom(res);
  return res.blob();
}

export const API = '/admin/api';

export const api = {
  get: <T>(path: string, opts?: RequestOptions) => request<T>('GET', API + path, undefined, opts),
  post: <T>(path: string, body?: unknown, opts?: RequestOptions) =>
    request<T>('POST', API + path, body, opts),
  put: <T>(path: string, body?: unknown, opts?: RequestOptions) =>
    request<T>('PUT', API + path, body, opts),
  patch: <T>(path: string, body?: unknown, opts?: RequestOptions) =>
    request<T>('PATCH', API + path, body, opts),
  delete: <T>(path: string, body?: unknown, opts?: RequestOptions) =>
    request<T>('DELETE', API + path, body, opts),
};

export const errorMessage = (e: unknown) =>
  e instanceof Error ? e.message : 'Something went wrong.';
