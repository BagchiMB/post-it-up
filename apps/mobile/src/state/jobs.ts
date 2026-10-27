import type { CreateJobBody, Job } from '@postitup/shared';
import { useEffect, useSyncExternalStore } from 'react';

import { api, ApiError } from '@/lib/api';
import { useAppActive } from '@/lib/app-state';
import { kv } from '@/lib/storage';

/** Offline copy of the list, so ready posts still open when the server is down. (v3: multi-post results.) */
export const JOBS_CACHE = 'jobs.v3';
const POLL_MS = 3_000;

let jobs: Job[] = [];
/** Jobs opened directly (e.g. from a notification) that aren't in the latest list. */
let extra: Job[] = [];
let loaded = false;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

function setJobs(next: Job[]) {
  jobs = next;
  void kv.set(JOBS_CACHE, JSON.stringify(jobs));
  emit();
}

function upsert(job: Job) {
  if (jobs.some((j) => j.id === job.id)) setJobs(jobs.map((j) => (j.id === job.id ? job : j)));
  else if (!extra.some((j) => j.id === job.id) && job.createdAt >= (jobs[0]?.createdAt ?? 0)) {
    setJobs([job, ...jobs]);
  } else {
    extra = [job, ...extra.filter((j) => j.id !== job.id)];
    emit();
  }
}

export const isActive = (j: Job) => j.status === 'queued' || j.status === 'running';

/** Still changing on the server: being made, or a post's music is being changed. */
const needsPolling = (j: Job) =>
  isActive(j) || !!j.result?.posts.some((p) => p.musicStatus === 'changing');

/** Shows the cached list right away (before the server answers). */
export async function loadCachedJobs() {
  const raw = await kv.get(JOBS_CACHE);
  if (raw && !loaded) {
    jobs = JSON.parse(raw) as Job[];
    emit();
  }
}

export async function loadJobs() {
  const list = await api<Job[]>('GET', '/jobs');
  loaded = true;
  extra = extra.filter((e) => !list.some((j) => j.id === e.id));
  setJobs(list);
  return list;
}

/** Fetches one job; resolves to null when it no longer exists. */
export async function refreshJob(id: string) {
  try {
    const job = await api<Job>('GET', `/jobs/${encodeURIComponent(id)}`);
    upsert(job);
    return job;
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) {
      removeLocal(id);
      return null;
    }
    throw e;
  }
}

export async function createJob(body: CreateJobBody) {
  // Up to 96 thumbnails, so give the upload time on a slow network.
  const job = await api<Job>('POST', '/jobs', { body, timeoutMs: 120_000 });
  upsert(job);
  return job;
}

export async function retryJob(id: string) {
  const job = await api<Job>('POST', `/jobs/${encodeURIComponent(id)}/retry`);
  upsert(job);
  return job;
}

/** "Change the music" for one post; the server answers right away with `musicStatus: 'changing'`. */
export async function changeMusic(id: string, postIndex: number, prompt: string) {
  const job = await api<Job>('POST', `/jobs/${encodeURIComponent(id)}/posts/${postIndex}/music`, {
    body: { prompt },
  });
  upsert(job);
  return job;
}

/** Swaps the post's suggested `alternative` in as its song. */
export async function applyAlternative(id: string, postIndex: number) {
  const job = await api<Job>(
    'POST',
    `/jobs/${encodeURIComponent(id)}/posts/${postIndex}/use-alternative`,
  );
  upsert(job);
  return job;
}

export async function deleteJob(id: string) {
  await api('DELETE', `/jobs/${encodeURIComponent(id)}`);
  removeLocal(id);
}

function removeLocal(id: string) {
  extra = extra.filter((j) => j.id !== id);
  setJobs(jobs.filter((j) => j.id !== id));
}

/** Sign-out: forget the previous user's posts. */
export function resetJobs() {
  jobs = [];
  extra = [];
  loaded = false;
  void kv.remove(JOBS_CACHE);
  emit();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useJobs() {
  return useSyncExternalStore(subscribe, () => jobs);
}

export function useJob(id: string) {
  return useSyncExternalStore(
    subscribe,
    () => jobs.find((j) => j.id === id) ?? extra.find((j) => j.id === id),
  );
}

/**
 * Keeps the list fresh while signed in: loads it when the app comes to the foreground,
 * and polls every few seconds while a post is still being made.
 */
export function useJobsSync(enabled: boolean) {
  const active = useAppActive();
  const busy = useSyncExternalStore(
    subscribe,
    () => jobs.some(needsPolling) || extra.some(needsPolling),
  );

  useEffect(() => {
    if (enabled && active) loadJobs().catch(() => {});
  }, [enabled, active]);

  useEffect(() => {
    if (!enabled || !active || !busy) return;
    const timer = setInterval(() => {
      loadJobs().catch(() => {});
      extra.filter(needsPolling).forEach((j) => refreshJob(j.id).catch(() => {}));
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [enabled, active, busy]);
}

// Dates

export const toDay = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export function fromDay(day: string) {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(day: string, n: number) {
  const d = fromDay(day);
  d.setDate(d.getDate() + n);
  return toDay(d);
}

export function formatRange({ from, to }: { from: string; to: string }) {
  const today = toDay(new Date());
  const fmt = (day: string) =>
    fromDay(day).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  if (from === to)
    return from === today ? 'Today' : from === addDays(today, -1) ? 'Yesterday' : fmt(from);
  return `${fmt(from)} – ${fmt(to)}`;
}
