/** Tiny toast store (no React context needed, so mutations and the API layer can toast too). */

export type ToastKind = 'good' | 'bad';
export type ToastItem = { id: number; text: string; kind: ToastKind };

let items: ToastItem[] = [];
let nextId = 1;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function toast(text: string, kind: ToastKind = 'good') {
  const id = nextId++;
  items = [...items, { id, text, kind }];
  emit();
  setTimeout(
    () => {
      items = items.filter((t) => t.id !== id);
      emit();
    },
    kind === 'bad' ? 6000 : 3500,
  );
}

export const toastStore = {
  subscribe: (l: () => void) => {
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  },
  get: () => items,
};
