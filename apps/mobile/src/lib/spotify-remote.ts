import { type NativeModule, requireOptionalNativeModule } from 'expo';

import { getSpotifyClientId } from '@/state/app-config';

/** Plays Spotify tracks through the Spotify app (iOS only; the local module in modules/spotify-remote). */

export type RemoteState = {
  connected: boolean;
  playing: boolean;
  positionMs: number;
  trackUri?: string;
};

type Events = {
  onStateChange: (state: RemoteState) => void;
  onError: (event: { message: string }) => void;
};

declare class SpotifyRemoteModule extends NativeModule<Events> {
  isSpotifyInstalled(): Promise<boolean>;
  playFrom(clientId: string, uri: string, positionMs: number): Promise<void>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  getState(): Promise<RemoteState>;
  disconnect(): Promise<void>;
}

// Null on web, Android and builds made before the module was added: callers fall back to a link.
const native = requireOptionalNativeModule<SpotifyRemoteModule>('SpotifyRemote');

/** Whether in-app playback can work at all here (module present + Spotify client ID set). */
export async function isRemotePlaybackAvailable() {
  if (!native || !getSpotifyClientId()) return false;
  return native.isSpotifyInstalled().catch(() => false);
}

export const trackUri = (spotifyId: string) => `spotify:track:${spotifyId}`;

/** Starts `uri` at `positionMs`. The first time, this opens the Spotify app to authorize and comes back. */
export async function playFrom(uri: string, positionMs: number) {
  if (!native) throw new Error('Spotify playback isn’t available here.');
  const clientId = getSpotifyClientId();
  if (!clientId) throw new Error('Spotify isn’t set up on the server yet.');
  await native.playFrom(clientId, uri, Math.max(0, Math.round(positionMs)));
}

export const pause = async () => native?.pause();
export const resume = async () => native?.resume();
export const disconnect = async () => native?.disconnect();

export async function getState(): Promise<RemoteState> {
  return native ? native.getState() : { connected: false, playing: false, positionMs: 0 };
}

export function addStateListener(listener: (state: RemoteState) => void) {
  const sub = native?.addListener('onStateChange', listener);
  return () => sub?.remove();
}

export function addErrorListener(listener: (message: string) => void) {
  const sub = native?.addListener('onError', (e) => listener(e.message));
  return () => sub?.remove();
}
