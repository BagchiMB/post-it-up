import type { CSSProperties, ReactNode } from 'react';

import { errorMessage } from '../api/client';
import type { MsgState } from '../lib/hooks';
import { useTitle } from '../lib/hooks';

export type PillKind = 'ok' | 'warn' | 'bad' | 'pending' | 'neutral';

export const Pill = ({ kind, children }: { kind: PillKind; children: ReactNode }) => (
  <span className={`pill ${kind}`}>{children}</span>
);

/** Page title + one-line description (also sets the document title). */
export function PageHead({ title, description }: { title: string; description?: ReactNode }) {
  useTitle(title);
  return (
    <div className="page-head">
      <h1>{title}</h1>
      {description ? <p>{description}</p> : null}
    </div>
  );
}

/** Stat tile. */
export const StatCard = ({
  label,
  value,
  sub,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
}) => (
  <div className="card">
    <div className="label">{label}</div>
    <div className="big">{value}</div>
    {sub ? <div className="muted">{sub}</div> : null}
  </div>
);

export const Msg = ({ msg, id }: { msg: MsgState; id?: string }) => (
  <div className={`msg${msg.kind ? ` ${msg.kind}` : ''}`} id={id} role="status" aria-live="polite">
    {msg.text}
  </div>
);

export const Empty = ({ children }: { children: ReactNode }) => (
  <div className="empty">{children}</div>
);

export const Skeleton = ({
  width = '100%',
  height = 14,
  style,
}: {
  width?: number | string;
  height?: number | string;
  style?: CSSProperties;
}) => <span className="skeleton" style={{ width, height, ...style }} aria-hidden="true" />;

/** Placeholder for a loading section: a few shimmering lines. */
export const SkeletonLines = ({ lines = 4 }: { lines?: number }) => (
  <div aria-busy="true" aria-label="Loading">
    {Array.from({ length: lines }, (_, i) => (
      <Skeleton key={i} width={`${90 - ((i * 17) % 40)}%`} style={{ margin: '10px 0' }} />
    ))}
  </div>
);

export const SkeletonCards = ({ count = 4 }: { count?: number }) => (
  <div className="cards" aria-busy="true" aria-label="Loading">
    {Array.from({ length: count }, (_, i) => (
      <div className="card" key={i}>
        <Skeleton width="50%" height={12} />
        <Skeleton width="70%" height={28} style={{ marginTop: 10 }} />
        <Skeleton width="60%" height={12} style={{ marginTop: 10 }} />
      </div>
    ))}
  </div>
);

export const ErrorBox = ({ error }: { error: unknown }) => (
  <p className="callout bad" role="alert">
    {errorMessage(error)}
  </p>
);
