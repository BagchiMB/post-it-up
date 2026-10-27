import type { UserSettings } from './api.ts';

/** Most posts one task can make. */
export const MAX_POSTS = 5;
/** Photos in a carousel post (a single post has exactly 1). */
export const MIN_CAROUSEL_PHOTOS = 2;
export const MAX_CAROUSEL_PHOTOS = 20;
/** Most candidate photos one `POST /jobs` can upload. */
export const MAX_UPLOAD_PHOTOS = 96;

/** Allowed song clip lengths in seconds until the admin changes them. */
export const DEFAULT_CLIP_LENGTHS = [10, 15, 20, 25, 30];
/** Fit scores below this count as low until the admin changes it. */
export const DEFAULT_LOW_FIT_THRESHOLD = 65;

/** Settings of a new user. Returns a fresh object each call. */
export const defaultUserSettings = (): UserSettings => ({
  onboarded: false,
  reminder: { hour: 20, minute: 0 },
  accounts: [],
});
