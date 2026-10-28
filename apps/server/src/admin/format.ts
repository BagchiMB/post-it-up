/** Formatting for admin API text (e.g. status check details). */

export const usd = (n: number | null | undefined, digits = 2) =>
  typeof n === 'number' ? `$${n < 0.01 && n > 0 ? n.toFixed(4) : n.toFixed(digits)}` : '—';
