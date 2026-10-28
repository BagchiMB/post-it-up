import { Directory, File, Paths } from 'expo-file-system';

/** Where expo-image-manipulator's `saveAsync` writes (its cache subfolder on iOS). */
const THUMBNAIL_DIR = 'ImageManipulator';

/** Deletes temporary files; a file that's already gone is fine. */
export function deleteTempFiles(uris: string[]) {
  for (const uri of uris) {
    try {
      const file = new File(uri);
      if (file.exists) file.delete();
    } catch {
      // Best effort: the OS clears the cache folder eventually anyway.
    }
  }
}

/** At launch: removes upload thumbnails left behind (e.g. the app was killed mid-upload). */
export function sweepThumbnailCache() {
  try {
    const dir = new Directory(Paths.cache, THUMBNAIL_DIR);
    if (!dir.exists) return;
    for (const entry of dir.list()) {
      if (entry instanceof File) entry.delete();
    }
  } catch {
    // Best effort.
  }
}
