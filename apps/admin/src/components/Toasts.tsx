import { useSyncExternalStore } from 'react';

import { toastStore } from '../lib/toast';

export function Toasts() {
  const items = useSyncExternalStore(toastStore.subscribe, toastStore.get);
  return (
    <div className="toasts" role="status" aria-live="polite">
      {items.map((t) => (
        <div key={t.id} className={`toast${t.kind === 'bad' ? ' bad' : ''}`}>
          {t.text}
        </div>
      ))}
    </div>
  );
}
