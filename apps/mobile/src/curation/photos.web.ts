// The web preview has no photo library, so it uses a fixed set of stock photos
// (one per hour of the range) to exercise the rest of the pipeline.

export type Candidate = {
  id: string;
  takenAt: number;
  width: number;
  height: number;
  favorite: boolean;
};

const SAMPLE_IDS = [10, 15, 28, 29, 37, 42, 48, 54, 57, 64, 76, 82, 91, 100, 106, 110];

export async function findCandidates(from: Date, to: Date, max: number): Promise<Candidate[]> {
  const days = Math.max(1, Math.round((to.getTime() - from.getTime()) / 86_400_000));
  const count = Math.min(max, SAMPLE_IDS.length, 4 + days * 2);
  return SAMPLE_IDS.slice(0, count).map((id, i) => ({
    id: String(id),
    takenAt: from.getTime() + i * 3_600_000,
    width: 1200,
    height: 1500,
    favorite: false,
  }));
}

export async function displayUri(id: string) {
  return `https://picsum.photos/id/${id}/1080/1350`;
}

/** Downloads the stock photo at thumbnail size and returns it as raw base64 (no data: prefix). */
/** Same shape as on iOS; there's no temporary file here (`uri` is empty). */
export async function thumbnail(c: Candidate): Promise<{ base64: string; uri: string }> {
  const res = await fetch(`https://picsum.photos/id/${c.id}/410/512.jpg`);
  if (!res.ok) throw new Error(`Couldn’t load sample photo ${c.id}.`);
  const blob = await res.blob();
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
  return { base64: dataUrl.slice(dataUrl.indexOf(',') + 1), uri: '' };
}
