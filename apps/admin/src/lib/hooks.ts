import { useCallback, useEffect, useRef, useState } from 'react';

import { toast, type ToastKind } from './toast';

export type MsgKind = ToastKind | undefined;
export type MsgState = { text: string; kind: MsgKind };

/**
 * Inline status line under a form ("Saving…", "Saved.") that also toasts results — the same
 * behaviour as `say()` in the server-rendered admin.
 */
export function useMsg() {
  const [msg, setMsg] = useState<MsgState>({ text: '', kind: undefined });
  const say = useCallback((text: string, kind?: MsgKind) => {
    setMsg({ text, kind });
    if (text && kind) toast(text, kind);
  }, []);
  return [msg, say] as const;
}

/** Sets `document.title` like the old layout: "<title> · Post It Up admin". */
export function useTitle(title: string) {
  useEffect(() => {
    document.title = `${title} · Post It Up admin`;
  }, [title]);
}

/** Calls `onEscape` on Escape while `active`. */
export function useEscape(active: boolean, onEscape: () => void) {
  const ref = useRef(onEscape);
  useEffect(() => {
    ref.current = onEscape;
  });
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') ref.current();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [active]);
}

/** Re-renders every `ms` while `active` (countdowns). */
export function useNow(active: boolean, ms = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [active, ms]);
  return now;
}
