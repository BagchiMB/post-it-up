// Web is only used to preview screens during development, so localStorage
// stands in for both SQLite and the Keychain here.

function store(prefix: string) {
  return {
    get: async (key: string) => globalThis.localStorage?.getItem(prefix + key) ?? null,
    set: async (key: string, value: string) => {
      globalThis.localStorage?.setItem(prefix + key, value);
    },
    remove: async (key: string) => {
      globalThis.localStorage?.removeItem(prefix + key);
    },
  };
}

export const kv = store('kv:');
export const secrets = store('secret:');
