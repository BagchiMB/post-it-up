import { useSyncExternalStore } from 'react';
import { AppState } from 'react-native';

function subscribe(listener: () => void) {
  const sub = AppState.addEventListener('change', listener);
  return () => sub.remove();
}

/** True while the app is in the foreground ("inactive" is a brief overlay, not the background). */
export const isAppActive = () => AppState.currentState !== 'background';

export function useAppActive() {
  return useSyncExternalStore(subscribe, isAppActive);
}
