import * as Linking from 'expo-linking';
import { getPermissionsAsync, requestPermissionsAsync } from 'expo-media-library';

export type PhotoAccess = 'full' | 'limited' | 'denied' | 'undetermined';

function toAccess(p: Awaited<ReturnType<typeof getPermissionsAsync>>): PhotoAccess {
  if (p.status === 'undetermined') return 'undetermined';
  if (!p.granted) return 'denied';
  return p.accessPrivileges === 'limited' ? 'limited' : 'full';
}

export async function getPhotoAccess() {
  return toAccess(await getPermissionsAsync());
}

export async function requestPhotoAccess() {
  return toAccess(await requestPermissionsAsync());
}

/** Limited access can't see new photos, so the fix is "Full Access" in iOS Settings. */
export function openAppSettings() {
  return Linking.openSettings();
}
