import { type ReactNode, type RefObject, useEffect, useId, useRef, useState } from 'react';

import { useEscape } from '../lib/hooks';
import { Icon } from './Icon';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Moves focus into `ref` on mount, keeps Tab inside it, and restores focus on unmount. */
function useFocusTrap(ref: RefObject<HTMLElement | null>, initial?: string) {
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const el = ref.current;
    const first =
      (initial ? el?.querySelector<HTMLElement>(initial) : null) ??
      el?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? el)?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab' || !el) return;
      const items = [...el.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
        (x) => x.offsetParent !== null,
      );
      if (!items.length) return;
      const a = items[0];
      const z = items[items.length - 1];
      if (e.shiftKey && document.activeElement === a) {
        e.preventDefault();
        z.focus();
      } else if (!e.shiftKey && document.activeElement === z) {
        e.preventDefault();
        a.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      prev?.focus?.();
    };
  }, [ref, initial]);
}

/** Right-side drawer (model picker, row detail). Escape or the overlay closes it. */
export function Drawer({
  title,
  kicker,
  onClose,
  children,
  footer,
  wide,
  initialFocus,
}: {
  title: ReactNode;
  kicker?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
  /** CSS selector of the element to focus first. */
  initialFocus?: string;
}) {
  const ref = useRef<HTMLElement>(null);
  const titleId = useId();
  useFocusTrap(ref, initialFocus);
  useEscape(true, onClose);
  return (
    <>
      <div className="drawer-overlay" onClick={onClose} />
      <aside
        ref={ref}
        className={`drawer${wide ? ' wide' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}>
        <div className="drawer-head">
          <div style={{ minWidth: 0 }}>
            {kicker ? <div className="muted">{kicker}</div> : null}
            <h2 id={titleId} style={{ margin: 0, overflowWrap: 'anywhere' }}>
              {title}
            </h2>
          </div>
          <button className="icon-btn" type="button" aria-label="Close" onClick={onClose}>
            <Icon name="close" size={18} />
          </button>
        </div>
        {children}
        {footer ? <div className="drawer-foot">{footer}</div> : null}
      </aside>
    </>
  );
}

/** Centered modal dialog. */
export function Modal({
  title,
  onClose,
  children,
  initialFocus,
}: {
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  initialFocus?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useFocusTrap(ref, initialFocus);
  useEscape(true, onClose);
  return (
    <div
      className="modal-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}>
      <div
        ref={ref}
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}>
        <h2 id={titleId}>{title}</h2>
        {children}
      </div>
    </div>
  );
}

/**
 * Replacement for window.confirm / window.prompt: a modal with a message, an optional text field
 * and Cancel / confirm buttons. `onConfirm` receives the field's value.
 */
export function ConfirmDialog({
  title,
  message,
  confirmLabel = 'Confirm',
  danger,
  input,
  busy,
  onConfirm,
  onCancel,
}: {
  title: string;
  message?: ReactNode;
  confirmLabel?: string;
  danger?: boolean;
  input?: { label: string; placeholder?: string; maxLength?: number };
  busy?: boolean;
  onConfirm: (value: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState('');
  const inputId = useId();
  return (
    <Modal title={title} onClose={onCancel} initialFocus={input ? 'input' : 'button.confirm'}>
      {message ? (
        <div className="muted" style={{ fontSize: 14 }}>
          {message}
        </div>
      ) : null}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onConfirm(value);
        }}>
        {input ? (
          <div style={{ marginTop: 14 }}>
            <label htmlFor={inputId}>{input.label}</label>
            <input
              id={inputId}
              value={value}
              maxLength={input.maxLength}
              placeholder={input.placeholder}
              onChange={(e) => setValue(e.target.value)}
            />
          </div>
        ) : null}
        <div className="actions">
          <button className="ghost" type="button" onClick={onCancel}>
            Cancel
          </button>
          <button className={`confirm${danger ? ' danger' : ''}`} type="submit" disabled={busy}>
            {busy ? 'Working…' : confirmLabel}
          </button>
        </div>
      </form>
    </Modal>
  );
}
