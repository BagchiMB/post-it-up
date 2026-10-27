import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { Asset, AssetField, MediaSubtype, MediaType, Query } from 'expo-media-library';

export type Candidate = {
  id: string;
  takenAt: number;
  width: number;
  height: number;
  favorite: boolean;
};

/** Photos closer together than this are treated as one burst; only the first is kept. */
const BURST_MS = 3_000;

/**
 * Photos taken between `from` and `to`, oldest first, without screenshots or bursts.
 * Thinned evenly (favorites always kept) when there are more than `max`.
 */
export async function findCandidates(from: Date, to: Date, max: number): Promise<Candidate[]> {
  const rows = await new Query()
    .eq(AssetField.MEDIA_TYPE, MediaType.IMAGE)
    .gte(AssetField.CREATION_TIME, from.getTime())
    .lte(AssetField.CREATION_TIME, to.getTime())
    .orderBy({ key: AssetField.CREATION_TIME, ascending: true })
    .exeForMetadata();

  const photos: Candidate[] = [];
  for (const r of rows) {
    if (r.mediaSubtypes?.includes(MediaSubtype.SCREENSHOT) || r.creationTime == null) continue;
    const prev = photos.at(-1);
    if (prev && r.creationTime - prev.takenAt < BURST_MS) continue;
    photos.push({
      id: r.id,
      takenAt: r.creationTime,
      width: r.width ?? 0,
      height: r.height ?? 0,
      favorite: r.isFavorite,
    });
  }
  return thinEvenly(photos, max);
}

function thinEvenly(photos: Candidate[], max: number) {
  if (photos.length <= max) return photos;
  const favorites = photos.filter((p) => p.favorite).slice(0, max);
  const rest = photos.filter((p) => !p.favorite);
  const slots = max - favorites.length;
  const step = rest.length / slots;
  const sampled = Array.from({ length: slots }, (_, i) => rest[Math.floor(i * step)]);
  return [...favorites, ...sampled].sort((a, b) => a.takenAt - b.takenAt);
}

/** A URI the app can display for a photo library id. */
export function displayUri(id: string) {
  return new Asset(id).getUri();
}

/** A small JPEG (longest side 512px) as raw base64, for upload to the server. */
export async function thumbnail(c: Candidate): Promise<string> {
  const uri = await displayUri(c.id);
  const size = c.width >= c.height ? { width: 512 } : { height: 512 };
  const image = await ImageManipulator.manipulate(uri).resize(size).renderAsync();
  const result = await image.saveAsync({ format: SaveFormat.JPEG, compress: 0.6, base64: true });
  if (!result.base64) throw new Error('Couldn’t read a photo.');
  return result.base64;
}
