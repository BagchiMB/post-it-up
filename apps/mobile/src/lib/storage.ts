import * as SecureStore from 'expo-secure-store';
import KV from 'expo-sqlite/kv-store';

/** Plain app data (settings, profiles, drafts). */
export const kv = {
  get: (key: string) => KV.getItemAsync(key),
  set: (key: string, value: string) => KV.setItemAsync(key, value),
  remove: async (key: string) => {
    await KV.removeItemAsync(key);
  },
};

/** API keys and tokens — stored in the iOS Keychain. */
export const secrets = {
  get: (key: string) => SecureStore.getItemAsync(key),
  set: (key: string, value: string) => SecureStore.setItemAsync(key, value),
  remove: (key: string) => SecureStore.deleteItemAsync(key),
};
