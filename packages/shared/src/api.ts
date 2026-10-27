/**
 * Types of the app ⇄ server API, shared by apps/mobile and apps/server.
 * The spec is docs/api-contract.md; change both together.
 */

export type Reminder = { hour: number; minute: number };

export type CaptionTone = 'casual' | 'witty' | 'poetic' | 'minimal';

export type InstagramProfile = {
  id: string;
  /** Without "@". */
  handle: string;
  /** Small data: URI of the avatar picked from the gallery (used in the post preview). */
  avatarUri?: string;
  tone: CaptionTone;
  emojis: boolean;
  /** Hashtags appended to every caption as-is, e.g. "#travel #weekend". */
  hashtags: string;
  /** Days this account gets a suggestion, 0 = Sunday … 6 = Saturday. */
  activeDays: number[];
};

/** Where a post's song comes from; chosen per post on the Create screen. */
export type MusicChoice =
  /** The user's Spotify top + recently played tracks (needs Spotify connected). */
  | { source: 'history' }
  /** 1–5 Spotify playlists the user picked. */
  | { source: 'playlists'; playlists: { id: string; name: string }[] }
  /** 1–10 artists; `id` is set when the artist was picked from Spotify search. */
  | { source: 'artists'; artists: { name: string; id?: string }[] }
  /** Free choice, with optional hints. */
  | { source: 'ai'; artistHint?: string; genreHint?: string };

/** Which photos: people as the subject, places/things, or a carousel of both. */
export type PostKind = 'people' | 'scenery' | 'mix';

/** One post a task should make. */
export type PostSpec = {
  kind: PostKind;
  /** "mix" is always a carousel. */
  format: 'single' | 'carousel';
  /** 1 for single; 2–20 for a carousel. */
  maxPhotos: number;
};

/** What a task makes: used for manual tasks and the automatic daily one. */
export type TaskConfig = {
  /** InstagramProfile.id */
  accountId: string;
  /** 1–5 posts; photos are never reused across posts in one task. */
  posts: PostSpec[];
  music: MusicChoice;
};

/** The signed-in user's settings (stored on the server; the phone keeps a copy). */
export type UserSettings = {
  onboarded: boolean;
  /** Pre-fill the Create screen. */
  lastMusic?: MusicChoice;
  lastPosts?: PostSpec[];
  reminder: Reminder;
  /** The automatic daily task (photos from "today"). */
  dailyTask?: TaskConfig & { enabled: boolean };
  accounts: InstagramProfile[];
};

export type SpotifyProfile = { displayName: string; imageUrl?: string };

/** Spotify dev mode only admits accounts the owner adds by hand, so users ask first. */
export type SpotifyAccess =
  | { status: 'none' }
  | { status: 'requested'; spotifyEmail: string; at: number }
  /** The owner added them in Spotify's dashboard. */
  | { status: 'approved'; spotifyEmail: string; at: number }
  | { status: 'declined'; at: number; note?: string };

/** The signed-in user, as the server describes them. */
export type Me = {
  id: string;
  email: string;
  /** From Google. */
  name?: string;
  /** Google avatar URL. */
  picture?: string;
  /** Private ntfy topic the server posts "your post is ready" to. */
  ntfyTopic: string;
  spotify: SpotifyProfile | null;
  spotifyAccess: SpotifyAccess;
  settings: UserSettings;
};

/** `PUT /me/spotify` body. `expiresAt` is ms epoch. */
export type SpotifyTokens = { accessToken: string; refreshToken: string; expiresAt: number };

export type DraftRequest = TaskConfig & {
  /** Local calendar days, inclusive, as YYYY-MM-DD. */
  from: string;
  to: string;
  /** Made by the daily background task. */
  auto?: boolean;
};

export type JobStatus = 'queued' | 'running' | 'ready' | 'failed';

/** The part of the song to use, like Instagram's clip picker. */
export type SongClip = {
  startSec: number;
  /** `startSec` + one of the admin's allowed clip lengths. */
  endSec: number;
  lengthSec: number;
  /** The line sung at `startSec` (from timed lyrics). */
  lyric?: string;
  /** Guessed without timed lyrics. */
  estimated: boolean;
};

/** 0–100: how well the song fits what's in the photo(s), with a one-line why. */
export type SongFit = { score: number; note: string };

export type Song = {
  title: string;
  artist: string;
  /** Set when the song was found on Spotify. */
  spotifyId?: string;
  clip?: SongClip;
  fit?: SongFit;
};

export type PostResult = {
  kind: PostKind;
  /** Photo library ids of the chosen photos, in post order. */
  assetIds: string[];
  /** Hashtags already appended. */
  caption: string;
  reason: string;
  photoSummary: string;
  song: Song;
  /** Songs replaced via "Change the music", newest first. */
  previousSongs: Song[];
  /** A better-fitting song from any artist, offered when a restricted source gave a weak fit. */
  alternative?: Song;
  /** While a "Change the music" request runs / if it failed. */
  musicStatus?: 'changing' | 'failed';
  musicError?: string;
};

export type JobResult = {
  /** Same order as `request.posts`, minus the skipped ones. */
  posts: PostResult[];
  skipped?: { index: number; reason: string }[];
  modelName: string;
};

/** A task on the server: one run over a date range that makes one or more posts. */
export type Job = {
  id: string;
  /** ms epoch */
  createdAt: number;
  updatedAt: number;
  request: DraftRequest;
  status: JobStatus;
  /** Human-readable step while queued/running, e.g. "Shortlisting photos (2 of 4)". */
  progress?: string;
  /** When failed. */
  error?: string;
  /** When ready. */
  result?: JobResult;
};

/** A photo offered to `POST /jobs`. */
export type UploadCandidate = { id: string; takenAt: number };

/** `POST /jobs` body: `images[i]` is the base64 JPEG (no `data:` prefix) of `candidates[i]`. */
export type CreateJobBody = {
  request: DraftRequest;
  candidates: UploadCandidate[];
  images: string[];
};

/** `GET /health`. `version`/`devLogin` are optional because older servers omit them. */
export type Health = { ok: boolean; version?: string; devLogin?: boolean };

/** `GET /config`: public settings (no auth). Optional fields are missing from older servers. */
export type AppConfig = {
  spotifyClientId: string | null;
  /** False when the server's Spotify user cap is reached (connected users keep their connection). */
  spotifyConnect?: { available: boolean };
  /** Fit scores below this are shown as low (server setting). */
  lowFitThreshold?: number;
};
