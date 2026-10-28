import type { BalanceStatus } from '@postitup/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { Link, Outlet, useLocation, useNavigate } from 'react-router';

import { request } from '../api/client';
import { useSession, useSettings, useSpotifyAccess } from '../api/queries';
import { usd } from '../lib/format';
import { useEscape } from '../lib/hooks';
import { Icon, type IconName } from './Icon';
import { Toasts } from './Toasts';

type NavItem = {
  to: string;
  label: string;
  icon: IconName;
  group?: string;
  /** Extra paths that highlight this entry (e.g. /db/tables/* → Tables). */
  match?: (path: string) => boolean;
  badge?: 'spotify';
};

/** Sidebar order: Overview; AI; People; System; Database; Admin account at the bottom. */
const NAV: NavItem[] = [
  { to: '/', label: 'Overview', icon: 'overview', match: (p) => p === '/' },
  { to: '/ai-usage', label: 'AI usage', icon: 'usage', group: 'AI' },
  { to: '/ai', label: 'AI settings', icon: 'ai', group: 'AI' },
  { to: '/prompts', label: 'Prompts', icon: 'prompts', group: 'AI' },
  { to: '/users', label: 'Users', icon: 'users', group: 'People' },
  {
    to: '/spotify-access',
    label: 'Spotify access',
    icon: 'music',
    group: 'People',
    badge: 'spotify',
  },
  { to: '/integrations', label: 'Integrations', icon: 'integrations', group: 'System' },
  { to: '/limits', label: 'Limits & quality', icon: 'limits', group: 'System' },
  { to: '/status', label: 'Status', icon: 'status', group: 'System' },
  { to: '/logs', label: 'Logs', icon: 'logs', group: 'System' },
  {
    to: '/db',
    label: 'Tables',
    icon: 'database',
    group: 'Database',
    match: (p) => p === '/db' || p.startsWith('/db/tables'),
  },
  { to: '/db/query', label: 'SQL console', icon: 'query', group: 'Database' },
  { to: '/db/audit', label: 'Audit log', icon: 'audit', group: 'Database' },
];
const ACCOUNT: NavItem = { to: '/account', label: 'Admin account', icon: 'account' };

const isCurrent = (n: NavItem, path: string) =>
  n.match ? n.match(path) : path === n.to || path.startsWith(`${n.to}/`);

/** Pending Spotify requests (connected users and the Spotify owner never count). */
function usePendingSpotify() {
  const access = useSpotifyAccess();
  const settings = useSettings();
  const owner = settings.data?.spotifyOwnerUserId ?? null;
  return (access.data?.items ?? []).filter(
    (i) => i.access.status === 'requested' && !i.connected && i.userId !== owner,
  ).length;
}

function NavLinkItem({ n, path, badge }: { n: NavItem; path: string; badge?: number }) {
  return (
    <Link to={n.to} aria-current={isCurrent(n, path) ? 'page' : undefined}>
      <Icon name={n.icon} />
      <span>{n.label}</span>
      {badge ? (
        <span className="count" aria-label={`${badge} pending`}>
          {badge}
        </span>
      ) : null}
    </Link>
  );
}

/** Global OpenRouter balance banner (red when empty, amber when low). */
export function BalanceBanner({ balance }: { balance: BalanceStatus | undefined }) {
  if (!balance || (balance.status !== 'empty' && balance.status !== 'low')) return null;
  const empty = balance.status === 'empty';
  return (
    <p className={`callout${empty ? ' bad' : ''}`} role="alert">
      {empty
        ? `OpenRouter balance is ${usd(balance.balanceUsd ?? 0)}: AI features will fail until you add credits${balance.isFreeTier ? ' (free models still work)' : ''}.`
        : `OpenRouter balance is low (${usd(balance.balanceUsd)}).`}{' '}
      <Link to="/integrations">Integrations</Link>
    </p>
  );
}

export function Shell() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const session = useSession();
  const pending = usePendingSpotify();
  const [open, setOpen] = useState(false);
  const openBtn = useRef<HTMLButtonElement>(null);
  const closeBtn = useRef<HTMLButtonElement>(null);

  useEscape(open, () => {
    setOpen(false);
    openBtn.current?.focus();
  });
  useEffect(() => {
    if (open) closeBtn.current?.focus();
  }, [open]);

  // Scroll to top on page change (anchors like /ai#step-x handle their own scrolling).
  useEffect(() => {
    if (!window.location.hash) window.scrollTo(0, 0);
  }, [pathname]);

  const signOut = async () => {
    await request('POST', '/admin/logout', {}).catch(() => undefined);
    qc.clear();
    void navigate('/login', { replace: true });
  };

  const items = NAV.flatMap((n, i) => [
    ...(n.group && n.group !== NAV[i - 1]?.group
      ? [
          <div className="nav-group" key={`g-${n.group}`}>
            {n.group}
          </div>,
        ]
      : []),
    <NavLinkItem
      key={n.to}
      n={n}
      path={pathname}
      {...(n.badge === 'spotify' ? { badge: pending } : {})}
    />,
  ]);

  return (
    <div className={`shell${open ? ' drawer-open' : ''}`}>
      <aside
        className="sidebar"
        id="sidebar"
        aria-label="Admin navigation"
        onClick={(e) => {
          if ((e.target as HTMLElement).closest('a')) setOpen(false);
        }}>
        <div className="brand">
          <strong>Post It Up</strong>
          <span>Admin</span>
          <button
            ref={closeBtn}
            className="icon-btn menu-close"
            type="button"
            aria-label="Close menu"
            onClick={() => {
              setOpen(false);
              openBtn.current?.focus();
            }}>
            <Icon name="close" size={18} />
          </button>
        </div>
        <nav className="nav" aria-label="Sections">
          {items}
        </nav>
        <div className="nav nav-bottom">
          <NavLinkItem n={ACCOUNT} path={pathname} />
          <button type="button" onClick={signOut}>
            <Icon name="signout" />
            <span>Sign out</span>
          </button>
        </div>
      </aside>
      <div className="overlay" aria-hidden="true" onClick={() => setOpen(false)} />
      <div style={{ minWidth: 0 }}>
        <header className="topbar">
          <button
            ref={openBtn}
            className="icon-btn"
            type="button"
            aria-label="Open menu"
            aria-controls="sidebar"
            aria-expanded={open}
            onClick={() => setOpen(true)}>
            <Icon name="menu" size={20} />
          </button>
          <strong>Post It Up</strong>
          <span className="badge">Admin</span>
        </header>
        <main className="content">
          <div className="content-inner">
            <BalanceBanner balance={session.data?.openrouter?.balance} />
            <Outlet />
          </div>
        </main>
      </div>
      <Toasts />
    </div>
  );
}
