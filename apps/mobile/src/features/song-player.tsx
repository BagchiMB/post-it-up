import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import {
  addErrorListener,
  addStateListener,
  disconnect,
  isRemotePlaybackAvailable,
  pause,
  playFrom,
  trackUri,
} from '@/lib/spotify-remote';
import { useMe } from '@/state/session';
import { Caption, space, type, useColors } from '@/ui';

/**
 * In-app playback is possible when the user connected Spotify, the Spotify app is installed and
 * the song was found on Spotify. Undefined while checking.
 */
export function useCanPlayInApp(spotifyId: string | undefined) {
  const { spotify } = useMe();
  const [installed, setInstalled] = useState<boolean>();
  useEffect(() => {
    let alive = true;
    isRemotePlaybackAvailable().then((ok) => alive && setInstalled(ok));
    return () => {
      alive = false;
    };
  }, []);
  if (!spotify || !spotifyId) return false;
  return installed;
}

/** "▶ Play from 0:52" / "❚❚ Pause" + "From start". Only plays on tap; stops when the screen goes away. */
export function SongPlayer({
  spotifyId,
  startSec,
  formatClock,
}: {
  spotifyId: string;
  startSec: number;
  formatClock: (sec: number) => string;
}) {
  const c = useColors();
  const uri = trackUri(spotifyId);
  const [playing, setPlaying] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string>();
  const started = useRef(false);

  useEffect(() => {
    const offState = addStateListener((s) => {
      const mine = s.playing && s.trackUri === uri;
      setPlaying(mine);
      if (mine) setStarting(false);
    });
    const offError = addErrorListener((message) => {
      setError(message);
      setStarting(false);
    });
    return () => {
      offState();
      offError();
      // Leaving the post stops the song (only if we started it).
      if (started.current) void pause().then(disconnect);
    };
  }, [uri]);

  async function play(fromSec: number) {
    setError(undefined);
    setStarting(true);
    started.current = true;
    try {
      await playFrom(uri, fromSec * 1000);
    } catch (e) {
      setError((e as Error).message);
      setStarting(false);
    }
  }

  const label = playing
    ? '❚❚ Pause'
    : starting
      ? 'Starting…'
      : `▶ Play from ${formatClock(startSec)}`;

  return (
    <View style={{ gap: 2 }}>
      <View style={styles.row}>
        <Pressable
          accessibilityRole="button"
          hitSlop={8}
          disabled={starting && !playing}
          onPress={() => (playing ? void pause() : void play(startSec))}>
          <Text style={[type.caption, styles.primary, { color: c.text }]}>{label}</Text>
        </Pressable>
        {startSec > 0 ? (
          <Pressable accessibilityRole="button" hitSlop={8} onPress={() => void play(0)}>
            <Text style={[type.caption, { color: c.textMuted }]}>From start</Text>
          </Pressable>
        ) : null}
      </View>
      {error ? <Caption style={{ color: c.danger }}>{error}</Caption> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.lg, marginTop: 2 },
  primary: { fontWeight: '600' },
});
