import type { InstagramProfile, PostResult, PostSpec, Song, SongClip } from '@postitup/shared';
import * as Clipboard from 'expo-clipboard';
import { Image } from 'expo-image';
import * as Linking from 'expo-linking';
import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { useDisplayUris } from '@/curation/use-display-uris';
import { errorMessage } from '@/lib/api';
import { trackUrl } from '@/lib/spotify';
import { useLowFitThreshold } from '@/state/app-config';
import { applyAlternative, changeMusic, markPosted } from '@/state/jobs';
import { Avatar, Button, Caption, Field, radius, space, type, useColors } from '@/ui';

import { SongPlayer, useCanPlayInApp } from './song-player';

const KIND_LABEL: Record<PostSpec['kind'], string> = {
  people: 'People',
  scenery: 'Scenery',
  mix: 'Mix',
};

/** 52 → "0:52", 127 → "2:07". */
export function formatClock(sec: number) {
  const s = Math.max(0, Math.floor(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function clipLine(clip: SongClip) {
  const length = clip.lengthSec || Math.round(clip.endSec - clip.startSec);
  if (clip.estimated) return `From about ${formatClock(clip.startSec)} · ${length} s (estimated)`;
  const lyric = clip.lyric ? ` · “${clip.lyric}”` : '';
  return `${formatClock(clip.startSec)} – ${formatClock(clip.endSec)} · ${length} s${lyric}`;
}

/** One finished post: an Instagram-style preview plus its song tools. */
export function PostCard({
  jobId,
  index,
  post,
  account,
}: {
  jobId: string;
  index: number;
  post: PostResult;
  account?: InstagramProfile;
}) {
  const c = useColors();
  const handle = account?.handle ?? 'you';
  const photos = useDisplayUris(post.assetIds);
  const { song } = post;
  const clip = song.clip;
  const [copied, setCopied] = useState(false);
  const count = post.assetIds.length;

  return (
    <View style={{ gap: space.md }}>
      <Caption muted style={styles.kind}>
        {`${KIND_LABEL[post.kind]} · ${count > 1 ? `Carousel · ${count} photos` : 'Single photo'}`.toUpperCase()}
      </Caption>

      {/* Instagram-style post mock */}
      <View style={styles.postHeader}>
        <Avatar uri={account?.avatarUri} label={handle} size={36} />
        <View style={{ flex: 1 }}>
          <Text style={[type.label, { color: c.text, fontWeight: '600' }]}>{handle}</Text>
          <SongLines song={song} />
        </View>
      </View>

      <Carousel photos={photos} />

      <Text style={[type.body, { color: c.text }]}>
        <Text style={{ fontWeight: '600' }}>{handle} </Text>
        {post.caption}
      </Text>

      {clip ? (
        <Caption muted>
          In Instagram, start the song at {formatClock(clip.startSec)} (
          {clip.lengthSec || Math.round(clip.endSec - clip.startSec)} s).
        </Caption>
      ) : null}
      <Button
        title={copied ? 'Caption copied' : 'Copy caption'}
        variant="secondary"
        onPress={async () => {
          await Clipboard.setStringAsync(post.caption);
          setCopied(true);
        }}
      />
      <PostedControl jobId={jobId} index={index} postedAt={post.postedAt} />

      <View style={[styles.note, { backgroundColor: c.surface }]}>
        <Caption muted>{post.reason}</Caption>
      </View>

      {post.alternative ? (
        <Alternative
          jobId={jobId}
          index={index}
          note={song.fit?.note}
          alternative={post.alternative}
        />
      ) : null}

      <ChangeMusic jobId={jobId} index={index} post={post} />
    </View>
  );
}

/** "Mark as posted" ↔ "✓ Posted · Oct 27" with Undo (the app can't see Instagram). */
function PostedControl({
  jobId,
  index,
  postedAt,
}: {
  jobId: string;
  index: number;
  postedAt?: number;
}) {
  const c = useColors();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function set(posted: boolean) {
    setBusy(true);
    setError(undefined);
    try {
      await markPosted(jobId, index, posted);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={{ gap: space.xs }}>
      {postedAt ? (
        <View style={[styles.inline, { justifyContent: 'center' }]}>
          <Text style={[type.label, { color: c.text }]}>
            ✓ Posted ·{' '}
            {new Date(postedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
          </Text>
          <Pressable
            accessibilityRole="button"
            hitSlop={8}
            disabled={busy}
            onPress={() => void set(false)}>
            <Text style={[type.caption, { color: c.textMuted }]}>Undo</Text>
          </Pressable>
        </View>
      ) : (
        <Button title="Mark as posted" onPress={() => void set(true)} loading={busy} />
      )}
      {error ? <Caption style={{ color: c.danger, textAlign: 'center' }}>{error}</Caption> : null}
    </View>
  );
}

/** Song line with its fit badge, the clip line and a play control (or a Spotify link). */
function SongLines({ song, alternative }: { song: Song; alternative?: boolean }) {
  const c = useColors();
  const canPlayInApp = useCanPlayInApp(song.spotifyId);
  const clip = song.clip;
  return (
    <>
      <View style={styles.inline}>
        {alternative ? (
          <Caption numberOfLines={1} style={{ flexShrink: 1 }}>
            Better match: {song.title} · {song.artist}
            {song.fit ? ` (${Math.round(song.fit.score)}%)` : ''}
          </Caption>
        ) : (
          <>
            <Caption muted numberOfLines={1} style={{ flexShrink: 1 }}>
              ♪ {song.title} · {song.artist}
            </Caption>
            {song.fit ? <FitBadge score={song.fit.score} /> : null}
          </>
        )}
      </View>
      {clip ? (
        <Caption muted numberOfLines={1}>
          {clipLine(clip)}
        </Caption>
      ) : null}
      {song.spotifyId && canPlayInApp ? (
        <SongPlayer
          spotifyId={song.spotifyId}
          startSec={clip?.startSec ?? 0}
          formatClock={formatClock}
        />
      ) : song.spotifyId && canPlayInApp === false ? (
        <Pressable
          accessibilityRole="link"
          hitSlop={8}
          onPress={() => Linking.openURL(trackUrl(song.spotifyId!))}>
          <Text style={[type.caption, { color: c.text, fontWeight: '600', marginTop: 2 }]}>
            Open in Spotify
          </Text>
        </Pressable>
      ) : null}
    </>
  );
}

/** "Fit 82%": muted, amber when below the server's low-fit threshold. */
function FitBadge({ score }: { score: number }) {
  const c = useColors();
  const low = score < useLowFitThreshold();
  return (
    <View style={[styles.badge, { borderColor: low ? c.warning : c.border }]}>
      <Text style={[styles.badgeText, { color: low ? c.warning : c.textMuted }]}>
        Fit {Math.round(score)}%
      </Text>
    </View>
  );
}

/** Offered when the song fits poorly: a better match from any artist. */
function Alternative({
  jobId,
  index,
  note,
  alternative,
}: {
  jobId: string;
  index: number;
  note?: string;
  alternative: Song;
}) {
  const c = useColors();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function use() {
    setBusy(true);
    setError(undefined);
    try {
      await applyAlternative(jobId, index);
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  }

  return (
    <View style={{ gap: space.sm }}>
      {note ? <Caption muted>{note}</Caption> : null}
      <View
        style={[
          styles.note,
          { borderWidth: StyleSheet.hairlineWidth, borderColor: c.border, gap: space.sm },
        ]}>
        <View>
          <SongLines song={alternative} alternative />
        </View>
        <Button title="Use this" variant="secondary" onPress={use} loading={busy} />
        {error ? <Caption style={{ color: c.danger }}>{error}</Caption> : null}
      </View>
    </View>
  );
}

/** "Change the music": the server picks a new song that still fits the photos. */
function ChangeMusic({ jobId, index, post }: { jobId: string; index: number; post: PostResult }) {
  const c = useColors();
  const [prompt, setPrompt] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string>();
  const changing = post.musicStatus === 'changing';

  async function send() {
    setSending(true);
    setError(undefined);
    try {
      await changeMusic(jobId, index, prompt.trim());
      setPrompt('');
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSending(false);
    }
  }

  return (
    <View style={[styles.note, { backgroundColor: c.surface, gap: space.sm }]}>
      <Text style={[type.label, { color: c.text }]}>Change the music</Text>
      {changing ? (
        <View style={styles.inline}>
          <ActivityIndicator size="small" />
          <Caption muted>Finding a new song…</Caption>
        </View>
      ) : (
        <>
          <Field
            placeholder="e.g. more upbeat, Bollywood"
            value={prompt}
            onChangeText={setPrompt}
            maxLength={300}
            autoCapitalize="sentences"
            returnKeyType="send"
            onSubmitEditing={() => prompt.trim() && send()}
            style={{ backgroundColor: c.background }}
          />
          <Button
            title="Send"
            variant="primary"
            onPress={send}
            loading={sending}
            disabled={!prompt.trim()}
          />
        </>
      )}
      {error || (post.musicStatus === 'failed' && post.musicError) ? (
        <Caption style={{ color: c.danger }}>{error ?? post.musicError}</Caption>
      ) : null}
      {post.previousSongs.length ? (
        <View style={{ gap: 2 }}>
          {post.previousSongs.map((s, i) => (
            <Caption key={i} muted numberOfLines={1}>
              Previous: {s.title} · {s.artist}
            </Caption>
          ))}
        </View>
      ) : null}
    </View>
  );
}

/** `photos` entries are undefined while loading and null when the photo was deleted from the phone. */
function Carousel({ photos }: { photos: (string | null | undefined)[] }) {
  const c = useColors();
  const [width, setWidth] = useState(0);
  const [page, setPage] = useState(0);

  return (
    <View style={{ gap: space.sm }} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
      {width > 0 ? (
        <ScrollView
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          onMomentumScrollEnd={(e) => setPage(Math.round(e.nativeEvent.contentOffset.x / width))}
          style={{ borderRadius: radius.md }}>
          {photos.map((uri, i) =>
            uri ? (
              <Image
                key={i}
                source={{ uri }}
                style={{ width, aspectRatio: 4 / 5, backgroundColor: c.surface }}
                contentFit="cover"
              />
            ) : (
              <View key={i} style={[styles.missing, { width, backgroundColor: c.surface }]}>
                {uri === null ? (
                  <Caption muted>This photo is no longer on your phone.</Caption>
                ) : null}
              </View>
            ),
          )}
        </ScrollView>
      ) : null}
      {photos.length > 1 ? (
        <View style={styles.dots}>
          {photos.map((_, i) => (
            <View
              key={i}
              style={[styles.dot, { backgroundColor: i === page ? c.text : c.border }]}
            />
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  kind: { letterSpacing: 0.6 },
  postHeader: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  dots: { flexDirection: 'row', justifyContent: 'center', gap: 5 },
  dot: { width: 6, height: 6, borderRadius: 3 },
  note: { borderRadius: radius.md, padding: space.lg, gap: space.xs },
  inline: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  badge: { borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: 6, paddingVertical: 1 },
  badgeText: { fontSize: 11, fontWeight: '600', fontVariant: ['tabular-nums'] },
  missing: {
    aspectRatio: 4 / 5,
    alignItems: 'center',
    justifyContent: 'center',
    padding: space.xl,
  },
});
