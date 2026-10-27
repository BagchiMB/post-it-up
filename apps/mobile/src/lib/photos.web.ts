// The photo library is iOS-only; the web preview pretends access is granted.

export type PhotoAccess = 'full' | 'limited' | 'denied' | 'undetermined';

export async function getPhotoAccess(): Promise<PhotoAccess> {
  return 'full';
}

export async function requestPhotoAccess(): Promise<PhotoAccess> {
  return 'full';
}

export async function openAppSettings() {}
