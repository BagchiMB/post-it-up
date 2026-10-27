import { type DraftRequest, MAX_UPLOAD_PHOTOS } from '@postitup/shared';

import { createJob, formatRange, fromDay } from '@/state/jobs';

import { findCandidates, thumbnail } from './photos';

/** Most photos sent for one post; long ranges are thinned evenly to this. */
const MAX_SCAN = MAX_UPLOAD_PHOTOS;
/** Thumbnails made at once (keeps memory down on long ranges). */
const PARALLEL = 6;

export type UploadStep = 'preparing' | 'uploading';

export class NoPhotosError extends Error {}

/**
 * Picks this range's candidate photos, makes small previews and hands them to the server,
 * which does the slow AI work. Resolves to the new job's id.
 */
export async function uploadJob(request: DraftRequest, onStep: (step: UploadStep) => void) {
  onStep('preparing');
  const from = fromDay(request.from);
  const to = fromDay(request.to);
  to.setHours(23, 59, 59, 999);
  const candidates = await findCandidates(from, to, MAX_SCAN);
  if (candidates.length === 0)
    throw new NoPhotosError(`No photos found for ${formatRange(request)}.`);

  const images: string[] = [];
  for (let i = 0; i < candidates.length; i += PARALLEL) {
    images.push(...(await Promise.all(candidates.slice(i, i + PARALLEL).map(thumbnail))));
  }

  onStep('uploading');
  const job = await createJob({
    request,
    candidates: candidates.map((c) => ({ id: c.id, takenAt: c.takenAt })),
    images,
  });
  return job.id;
}
