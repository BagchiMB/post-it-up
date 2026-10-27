/** One concise line per event. Never pass tokens, keys or image data in here. */
export function log(message: string) {
  console.log(`${new Date().toISOString()} ${message}`);
}

export function logError(message: string, err?: unknown) {
  const detail =
    // eslint-disable-next-line @typescript-eslint/no-base-to-string -- any thrown value; objects print as [object Object], which never leaks their contents
    err instanceof Error ? err.message : err === undefined ? '' : String(err);
  console.error(`${new Date().toISOString()} ERROR ${message}${detail ? `: ${detail}` : ''}`);
}

/** A loud multi-line warning (stderr, no timestamp) for settings that must not stay on. */
export function banner(lines: string[]) {
  for (const line of lines) console.warn(line);
}
