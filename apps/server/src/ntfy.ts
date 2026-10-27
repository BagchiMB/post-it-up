import type { DraftRequest } from '@postitup/shared';

import { config } from './config.ts';
import { log } from './log.ts';
import { outbound } from './outbound.ts';
import { formatRange } from './pipeline.ts';

/** Generic push via ntfy (never the caption). Failures are logged and swallowed. */
export async function notifyJobFinished(
  topic: string,
  jobId: string,
  request: DraftRequest,
  outcome: 'ready' | 'failed',
  postCount = 1,
) {
  const range = formatRange(request);
  const ready = outcome === 'ready';
  const many = postCount > 1;
  const title = ready
    ? many
      ? 'Your posts are ready'
      : 'Your post is ready'
    : "Couldn't make your posts";
  const body = ready
    ? many
      ? `Your ${postCount} posts for ${range} are ready`
      : `Your post for ${range} is ready`
    : `Couldn't make your posts for ${range}`;
  try {
    // The topic is a private address, so the log shows a placeholder instead.
    const url = `${config.ntfyUrl}/${encodeURIComponent(topic)}`;
    const res = await outbound(
      { integration: 'ntfy', operation: 'push', logPath: `${new URL(url).host}/[topic]` },
      url,
      {
        method: 'POST',
        headers: {
          // Header values must stay ASCII; the en dash only appears in the body.
          Title: title,
          Click: `postitup://draft/${jobId}`,
          Tags: ready ? 'camera_flash' : 'warning',
        },
        body,
        signal: AbortSignal.timeout(10_000),
      },
    );
    if (!res.ok) log(`job ${jobId} ntfy returned ${res.status}`);
  } catch (e) {
    log(`job ${jobId} ntfy failed: ${(e as Error).message}`);
  }
}

/** A small generic push to one user (titles ASCII; never secrets). Failures are logged and swallowed. */
export async function notifyUser(
  topic: string,
  msg: { title: string; body: string; click: string; tags: string },
) {
  try {
    const url = `${config.ntfyUrl}/${encodeURIComponent(topic)}`;
    const res = await outbound(
      { integration: 'ntfy', operation: 'push', logPath: `${new URL(url).host}/[topic]` },
      url,
      {
        method: 'POST',
        headers: { Title: msg.title, Click: msg.click, Tags: msg.tags },
        body: msg.body,
        signal: AbortSignal.timeout(10_000),
      },
    );
    if (!res.ok) log(`ntfy returned ${res.status}`);
  } catch (e) {
    log(`ntfy failed: ${(e as Error).message}`);
  }
}
