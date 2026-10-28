import { all, db, one, run } from './db.ts';
import { log } from './log.ts';

/**
 * Admin-editable, versioned prompt templates. Wording lives in the DB (`prompt_versions`, one
 * active version per key in `prompt_active`); JSON response schemas stay in code. Editing never
 * overwrites: it inserts version N+1 and activates it.
 */
export type PromptKey =
  'shortlist' | 'final_post' | 'song_clip' | 'song_clip_estimate' | 'song_change';
export const PROMPT_KEYS: PromptKey[] = [
  'shortlist',
  'final_post',
  'song_clip',
  'song_clip_estimate',
  'song_change',
];
/** Steps whose model call includes photos (needs an image-capable model). */
export const VISION_STEPS = new Set<PromptKey>(['shortlist', 'final_post']);

type PromptDef = {
  key: PromptKey;
  title: string;
  description: string;
  placeholders: { name: string; description: string }[];
  /** v1 default. */
  defaultBody: string;
  /** Built-in revisions after v1, added (and activated) once each as new versions on boot. */
  revisions?: { body: string; note: string }[];
};

export const PROMPTS: PromptDef[] = [
  {
    key: 'shortlist',
    title: 'Shortlist',
    description:
      'Long date ranges: picks the best few photos from each batch of up to 16 before the final choice.',
    placeholders: [
      { name: 'keep', description: 'How many photos to keep from this batch' },
      { name: 'photoCount', description: 'How many photos are in this batch' },
    ],
    defaultBody: `These are {{photoCount}} numbered photos from one person's camera roll. Pick the {{keep}} best candidates for an Instagram post.

Judge each photo on:
- sharpness and exposure: in focus, not too dark, not blown out
- composition: a clear subject and pleasing framing
- flattering faces: eyes open, natural expressions, nobody caught mid-blink or mid-bite
- interesting or meaningful moments: people together, celebrations, places and things worth remembering

Skip near-duplicates (keep only the best shot of a burst or series), screenshots, documents, receipts and blurry shots.

Return exactly {{keep}} photo numbers, best first (all of them if there are fewer than {{keep}}).`,
  },
  {
    key: 'final_post',
    title: 'Final post',
    description:
      'Makes every requested post in one call: photos (never reused across posts), caption, song and why.',
    placeholders: [
      { name: 'handle', description: 'Instagram handle, without @' },
      {
        name: 'range',
        description: 'When the photos were taken, e.g. "on Oct 27" or "between Oct 21 and Oct 27"',
      },
      {
        name: 'postsInstructions',
        description: 'Numbered list of the requested posts: kind, single/carousel, max photos',
      },
      { name: 'tone', description: 'Caption tone: casual, witty, poetic or minimal' },
      { name: 'emojiRule', description: '"a couple of emojis are welcome" or "no emojis"' },
      {
        name: 'musicInstructions',
        description:
          "Per music source: the candidate track list, the user's artists, or free choice with hints",
      },
      {
        name: 'lowFitThreshold',
        description:
          'Fit score below which a limited-source song also gets an alternative (admin setting)',
      },
    ],
    defaultBody: `You are the Instagram curator for @{{handle}}. The numbered photos below were taken {{range}}. Build one post from them.

PHOTOS
{{formatInstructions}}
Judge sharpness, exposure, composition, flattering faces, and how interesting or meaningful the moment is. Never choose screenshots, documents, receipts or blurry shots.

CAPTION
- {{tone}} tone, under 150 characters, {{emojiRule}}, no hashtags.
- It should sound like a person wrote it, not an ad or a brand.
- No clichés such as "living my best life", "good vibes only", "making memories" or "no filter needed".
- Write about what is actually in the photos.

SONG
The song MUST fit what is actually in the chosen photo(s): the scene, mood, energy, colours, season, occasion and the people in them. A quiet sunset needs a different song from a loud night out.
{{musicInstructions}}

ALSO RETURN
- reason: one sentence on why these photos, plus why the song fits them.
- photoSummary: one plain sentence describing the chosen photo(s): what is in them, the setting and the mood.`,
    revisions: [
      {
        note: 'Multiple posts + clip lengths',
        body: `You are the Instagram curator for @{{handle}}. The numbered photos below were taken {{range}}. Make the posts listed under POSTS from them.

POSTS
{{postsInstructions}}

Rules for every post:
- Never use the same photo in more than one post.
- Follow each post's kind: "people" means people are the subject; "scenery" means places, landscapes, food or objects, with no people as the main subject; "mix" is a carousel that combines both.
- Judge sharpness, exposure, composition, flattering faces, and how interesting or meaningful the moment is. Never choose screenshots, documents, receipts or blurry shots.
- If there aren't enough suitable photos for a post, return it with an empty photos list and say why in reason. Don't force weak or off-kind photos into a post.

CAPTION (one per post)
- {{tone}} tone, under 150 characters, {{emojiRule}}, no hashtags.
- It should sound like a person wrote it, not an ad or a brand.
- No clichés such as "living my best life", "good vibes only", "making memories" or "no filter needed".
- Write about what is actually in that post's photos, and don't repeat the same caption idea across posts.

SONG (one per post)
Each song MUST fit what is actually in that post's photo(s): the scene, mood, energy, colours, season, occasion and the people in them. A quiet sunset needs a different song from a loud night out. Use a different song for each post.
{{musicInstructions}}

FOR EACH POST ALSO RETURN
- post: the post's number from the list above.
- reason: one sentence on why these photos, plus why the song fits them.
- photoSummary: one plain sentence describing the post's photo(s): what is in them, the setting and the mood.`,
      },
      {
        note: 'Fit score + alternative',
        body: `You are the Instagram curator for @{{handle}}. The numbered photos below were taken {{range}}. Make the posts listed under POSTS from them.

POSTS
{{postsInstructions}}

Rules for every post:
- Never use the same photo in more than one post.
- Follow each post's kind: "people" means people are the subject; "scenery" means places, landscapes, food or objects, with no people as the main subject; "mix" is a carousel that combines both.
- Judge sharpness, exposure, composition, flattering faces, and how interesting or meaningful the moment is. Never choose screenshots, documents, receipts or blurry shots.
- If there aren't enough suitable photos for a post, return it with an empty photos list and say why in reason. Don't force weak or off-kind photos into a post.

CAPTION (one per post)
- {{tone}} tone, under 150 characters, {{emojiRule}}, no hashtags.
- It should sound like a person wrote it, not an ad or a brand.
- No clichés such as "living my best life", "good vibes only", "making memories" or "no filter needed".
- Write about what is actually in that post's photos, and don't repeat the same caption idea across posts.

SONG (one per post)
Each song MUST fit what is actually in that post's photo(s): the scene, mood, energy, colours, season, occasion and the people in them. A quiet sunset needs a different song from a loud night out. Use a different song for each post.
{{musicInstructions}}

FIT SCORE (one per post)
Rate how well the chosen song fits what is actually in the photo(s), from 0 to 100:
- 90–100 excellent: mood, energy and theme all match
- 70–89 good
- 50–69 okay: it partly fits
- under 50 poor
Score honestly and calibrated. Don't inflate: a weak match should score low so the user can choose something better. Add a short note (under 120 characters) saying why.

ALTERNATIVE (only sometimes)
If your song choice was limited (to a list of tracks or to particular artists) AND its fit score is below {{lowFitThreshold}}, also give in alternative the best-fitting well-known song by ANY artist, likely to be in Instagram's music library, with its own fit score and note. It must be a different song from the one you chose. In every other case set all alternative fields to null.

FOR EACH POST ALSO RETURN
- post: the post's number from the list above.
- reason: one sentence on why these photos, plus why the song fits them.
- photoSummary: one plain sentence describing the post's photo(s): what is in them, the setting and the mood.`,
      },
    ],
  },
  {
    key: 'song_clip',
    title: 'Song clip',
    description: 'Picks where the song clip starts and how long it is, from the timed lyrics.',
    placeholders: [
      { name: 'title', description: 'Song title' },
      { name: 'artist', description: 'Song artist' },
      { name: 'photoSummary', description: 'One-sentence description of the chosen photo(s)' },
      { name: 'caption', description: 'The caption (without hashtags)' },
      {
        name: 'clipLengths',
        description: 'Allowed clip lengths, e.g. "10, 15, 20, 25 or 30" (admin setting)',
      },
      { name: 'lyrics', description: 'Timed lyrics, one per line as "[index] m:ss text"' },
    ],
    defaultBody: `Pick the part of "{{title}}" by {{artist}} to play with an Instagram post, like choosing a clip in Instagram's music picker.

The photo(s): {{photoSummary}}
Caption: {{caption}}

Below are the song's timed lyrics, one per line as [index] m:ss text. Choose the line that starts the best {{clipSeconds}}-second window:
- prefer the hook or chorus, or the most recognisable part of the song
- its words should suit the photo(s) and the caption
- avoid the intro, silence or instrumental gaps, and lines with explicit content

{{lyrics}}

Return the index of the line the clip should start on.`,
    revisions: [
      {
        note: 'Multiple posts + clip lengths',
        body: `Pick the part of "{{title}}" by {{artist}} to play with an Instagram post, like choosing a clip in Instagram's music picker.

The photo(s): {{photoSummary}}
Caption: {{caption}}

Below are the song's timed lyrics, one per line as [index] m:ss text.

1. Choose startIndex: the line the clip starts on.
- prefer the hook or chorus, or the most recognisable part of the song
- its words should suit the photo(s) and the caption
- avoid the intro, silence or instrumental gaps, and lines with explicit content
- start at the beginning of a phrase, not in the middle of one

2. Choose lengthSec, which must be one of {{clipLengths}} seconds: the length that covers a natural lyrical unit starting at that line, such as the whole chorus or hook, or a complete verse passage. Use the timestamps: for example, a four-line chorus running from 0:52 to 1:13 needs 20 seconds. Don't end the clip in the middle of a line if a slightly longer allowed length would finish it.

{{lyrics}}`,
      },
    ],
  },
  {
    key: 'song_clip_estimate',
    title: 'Song clip (no lyrics)',
    description:
      'Estimates where the hook starts and how long it lasts when no timed lyrics are found.',
    placeholders: [
      { name: 'title', description: 'Song title' },
      { name: 'artist', description: 'Song artist' },
      { name: 'photoSummary', description: 'One-sentence description of the chosen photo(s)' },
      {
        name: 'clipLengths',
        description: 'Allowed clip lengths, e.g. "10, 15, 20, 25 or 30" (admin setting)',
      },
    ],
    defaultBody: `"{{title}}" by {{artist}} will play with an Instagram post. The photo(s): {{photoSummary}}

There are no timed lyrics for this song. Give your best estimate, in seconds from the start of the song, of where its hook or chorus begins: the most recognisable part, good for a {{clipSeconds}}-second clip.

Be honest with yourself about how sure you are; if you don't know the song well, estimate from how songs like it are usually structured. Always return your best guess as a number.`,
    revisions: [
      {
        note: 'Multiple posts + clip lengths',
        body: `"{{title}}" by {{artist}} will play with an Instagram post. The photo(s): {{photoSummary}}

There are no timed lyrics for this song. From what you know of it, estimate:
- startSec: where its hook or chorus begins, in seconds from the start of the song (the most recognisable part)
- lengthSec: how long that hook or chorus lasts, as one of {{clipLengths}} seconds, choosing the allowed length that best covers it

Be honest with yourself about how sure you are; if you don't know the song well, estimate from how songs like it are usually structured. Always return your best guess as numbers.`,
      },
    ],
  },
  {
    key: 'song_change',
    title: 'Change the music',
    description:
      '"Change the music" on one post: a new song that honours the user\'s request and still fits the photo(s).',
    placeholders: [
      { name: 'photoSummary', description: "One-sentence description of the post's photo(s)" },
      { name: 'caption', description: "The post's caption" },
      {
        name: 'userRequest',
        description: 'What the user asked for, e.g. "more upbeat, Bollywood"',
      },
      {
        name: 'previousSongs',
        description:
          'The current and earlier songs for this post, one per line (never repeat these)',
      },
      {
        name: 'musicInstructions',
        description: "The task's original music source: candidate list / artists / hints",
      },
      {
        name: 'lowFitThreshold',
        description:
          'Fit score below which a limited-source song also gets an alternative (admin setting)',
      },
    ],
    defaultBody: `The user wants a different song for this Instagram post.

The photo(s): {{photoSummary}}
Caption: {{caption}}

Their request: "{{userRequest}}"

Songs already used for this post. Never suggest any of these again, including other versions, covers or remixes of them:
{{previousSongs}}

Choose one new song that:
- honours the request as closely as you can (mood, energy, genre, language, era or artist)
- still fits what is actually in the photo(s): the scene, mood, energy, colours, season, occasion and the people in them
- is a real, released song

{{musicInstructions}}
If the request clearly asks for something those options don't cover (for example a specific artist, genre or language), follow the request instead: suggest a well-known song that matches it and set trackId to null.

Also return reason: one sentence on why this song fits the photo(s) and the request.`,
    revisions: [
      {
        note: 'Fit score + alternative',
        body: `The user wants a different song for this Instagram post.

The photo(s): {{photoSummary}}
Caption: {{caption}}

Their request: "{{userRequest}}"

Songs already used for this post. Never suggest any of these again, including other versions, covers or remixes of them:
{{previousSongs}}

Choose one new song that:
- honours the request as closely as you can (mood, energy, genre, language, era or artist)
- still fits what is actually in the photo(s): the scene, mood, energy, colours, season, occasion and the people in them
- is a real, released song

{{musicInstructions}}
If the request clearly asks for something those options don't cover (for example a specific artist, genre or language), follow the request instead: suggest a well-known song that matches it and set trackId to null.

FIT SCORE
Rate how well the new song fits what is actually in the photo(s), from 0 to 100:
- 90–100 excellent: mood, energy and theme all match
- 70–89 good
- 50–69 okay: it partly fits
- under 50 poor
Score honestly and calibrated. Don't inflate: a weak match should score low so the user can choose something better. Add a short note (under 120 characters) saying why.

ALTERNATIVE (only sometimes)
If you had to pick from a limited list of tracks or particular artists AND the fit score is below {{lowFitThreshold}}, also give in alternative the best-fitting well-known song by ANY artist that still honours the request, likely to be in Instagram's music library, with its own fit score and note. It must not be the new song or any song listed above. In every other case set all alternative fields to null.

Also return reason: one sentence on why this song fits the photo(s) and the request.`,
      },
    ],
  },
];

export const promptDef = (key: string) => PROMPTS.find((p) => p.key === key);

/**
 * First boot (or a newly added key): v1 = the built-in default, active. Built-in revisions
 * (e.g. v2 "Multiple posts + clip lengths") are appended once each as the next version and
 * activated; which ones were applied is tracked in server_settings.promptBuiltins, so admin
 * edits are never overwritten and nothing is added twice.
 */
export function seedPrompts() {
  const appliedRow = one<{ value: string }>(
    "SELECT value FROM server_settings WHERE key = 'promptBuiltins'",
  );
  const applied = (appliedRow ? JSON.parse(appliedRow.value) : {}) as Record<string, number>;
  for (const p of PROMPTS) {
    const exists = !!one('SELECT 1 FROM prompt_versions WHERE key = ? LIMIT 1', p.key);
    if (!exists) {
      run(
        'INSERT INTO prompt_versions (key, version, body, note, created_at) VALUES (?, 1, ?, ?, ?)',
        p.key,
        p.defaultBody,
        'Default',
        Date.now(),
      );
      run('INSERT OR REPLACE INTO prompt_active (key, version) VALUES (?, 1)', p.key);
    }
    const revisions = p.revisions ?? [];
    // Built-ins already in the DB: v1 always; revisions per the tracker.
    for (let i = applied[p.key] ?? 0; i < revisions.length; i++) {
      const v = createVersion(p.key, revisions[i].body, revisions[i].note);
      log(`prompt ${p.key}: added built-in v${v} "${revisions[i].note}" and made it active`);
    }
    applied[p.key] = revisions.length;
  }
  run(
    `INSERT INTO server_settings (key, value) VALUES ('promptBuiltins', ?)
     ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
    JSON.stringify(applied),
  );
}

type VersionRow = { version: number; body: string; note: string | null; created_at: number };

const activeCache = new Map<PromptKey, { version: number; body: string }>();

/** The live template for a key (cached until a new version is saved or activated). */
export function activePrompt(key: PromptKey): { version: number; body: string } {
  const cached = activeCache.get(key);
  if (cached) return cached;
  const row = one<{ version: number; body: string }>(
    `SELECT v.version, v.body FROM prompt_active a
     JOIN prompt_versions v ON v.key = a.key AND v.version = a.version WHERE a.key = ?`,
    key,
  );
  const value = row ?? { version: 0, body: promptDef(key)!.defaultBody };
  activeCache.set(key, value);
  return value;
}

/** Fills `{{name}}` placeholders; unknown ones are left as they are. */
export function render(body: string, vars: Record<string, string | number>) {
  return body.replace(/\{\{\s*(\w+)\s*\}\}/g, (m, name: string) =>
    name in vars ? String(vars[name]) : m,
  );
}

/** Renders the active version of `key` and records which version was used. */
export function prompt(
  key: PromptKey,
  vars: Record<string, string | number>,
  used: PromptVersionsUsed,
) {
  const { version, body } = activePrompt(key);
  used[key] = version;
  return render(body, vars);
}

export type PromptVersionsUsed = Partial<Record<PromptKey, number>>;

// Admin

const view = (r: VersionRow) => ({
  version: r.version,
  body: r.body,
  note: r.note ?? '',
  createdAt: r.created_at,
});

export function listPrompts() {
  return PROMPTS.map((p) => {
    const active = one<VersionRow>(
      `SELECT v.version, v.body, v.note, v.created_at FROM prompt_active a
       JOIN prompt_versions v ON v.key = a.key AND v.version = a.version WHERE a.key = ?`,
      p.key,
    );
    const count =
      one<{ n: number }>('SELECT COUNT(*) AS n FROM prompt_versions WHERE key = ?', p.key)?.n ?? 0;
    return {
      key: p.key,
      title: p.title,
      description: p.description,
      placeholders: p.placeholders,
      active: active ? view(active) : null,
      versionCount: count,
    };
  });
}

export function listVersions(key: PromptKey) {
  const activeVersion = activePrompt(key).version;
  const path = `$.${key}`;
  return all<VersionRow & { jobs: number; failed: number; posted: number }>(
    `SELECT v.version, v.body, v.note, v.created_at,
            (SELECT COUNT(*) FROM jobs j WHERE json_extract(j.prompt_versions, ?) = v.version
               AND j.status IN ('ready', 'failed')) AS jobs,
            (SELECT COUNT(*) FROM jobs j WHERE json_extract(j.prompt_versions, ?) = v.version
               AND j.status = 'failed') AS failed,
            (SELECT COUNT(*) FROM jobs j, json_each(j.result, '$.posts') p
               WHERE json_extract(j.prompt_versions, ?) = v.version AND j.status = 'ready'
                 AND json_extract(p.value, '$.postedAt') IS NOT NULL) AS posted
     FROM prompt_versions v WHERE v.key = ? ORDER BY v.version DESC`,
    path,
    path,
    path,
    key,
  ).map((r) => ({
    ...view(r),
    active: r.version === activeVersion,
    jobs: r.jobs,
    failed: r.failed,
    posted: r.posted,
  }));
}

export function createVersion(key: PromptKey, body: string, note: string) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const next =
      (one<{ v: number | null }>('SELECT MAX(version) AS v FROM prompt_versions WHERE key = ?', key)
        ?.v ?? 0) + 1;
    run(
      'INSERT INTO prompt_versions (key, version, body, note, created_at) VALUES (?, ?, ?, ?, ?)',
      key,
      next,
      body,
      note,
      Date.now(),
    );
    run('INSERT OR REPLACE INTO prompt_active (key, version) VALUES (?, ?)', key, next);
    db.exec('COMMIT');
    activeCache.delete(key);
    return next;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

export function activateVersion(key: PromptKey, version: number) {
  if (!one('SELECT 1 FROM prompt_versions WHERE key = ? AND version = ?', key, version))
    return false;
  run('INSERT OR REPLACE INTO prompt_active (key, version) VALUES (?, ?)', key, version);
  activeCache.delete(key);
  return true;
}
