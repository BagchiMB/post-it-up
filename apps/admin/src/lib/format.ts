/** Formatting helpers, same output as the server-rendered admin (layout.ts). */

export const usd = (n: number | null | undefined, digits = 2) =>
  typeof n === 'number' ? `$${n < 0.01 && n > 0 ? n.toFixed(4) : n.toFixed(digits)}` : '—';

export const when = (ms: number | null | undefined) =>
  ms ? new Date(ms).toISOString().replace('T', ' ').slice(0, 16) + ' UTC' : '—';

export const num = (n: number) => n.toLocaleString('en-US');

export const mb = (n: number) => `${(n / 1024 / 1024).toFixed(n < 10 * 1024 * 1024 ? 2 : 1)} MB`;

export const bytes = (n: number | null | undefined) => {
  if (n === null || n === undefined) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return mb(n);
};

/** Model price per 1M tokens, as in the model picker. */
export const price = (n: number) =>
  n === 0 ? 'free' : '$' + (n < 1 ? n.toFixed(2) : n < 10 ? n.toFixed(1) : n.toFixed(0));

export const uptime = (seconds: number) =>
  seconds < 3600
    ? `${Math.floor(seconds / 60)} min`
    : seconds < 86400
      ? `${(seconds / 3600).toFixed(1)} h`
      : `${(seconds / 86400).toFixed(1)} days`;

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
