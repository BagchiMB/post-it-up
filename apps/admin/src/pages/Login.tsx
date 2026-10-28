import type { AdminSession } from '@postitup/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';

import { api, ApiError, errorMessage, request } from '../api/client';
import { qk } from '../api/queries';
import { Toasts } from '../components/Toasts';
import { Msg } from '../components/ui';
import { useMsg, useTitle } from '../lib/hooks';

/** Only same-site admin paths are allowed as `?next=` targets. */
const safeNext = (v: string | null) =>
  v && v.startsWith('/') && !v.startsWith('//') && !v.startsWith('/login') ? v : '/';

export function LoginPage() {
  useTitle('Sign in');
  const [params] = useSearchParams();
  const next = safeNext(params.get('next'));
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [disabled, setDisabled] = useState(false);
  const [msg, say] = useMsg();

  // Already signed in → straight to the target page.
  useEffect(() => {
    let live = true;
    api
      .get<AdminSession>('/session', { noAuthRedirect: true })
      .then((s) => {
        if (!live) return;
        qc.setQueryData(qk.session, s);
        void navigate(next, { replace: true });
      })
      .catch(() => undefined);
    // Sign-in disabled (no admin credentials on the server)? Older servers lack this endpoint.
    api
      .get<{ enabled: boolean }>('/login-status', { noAuthRedirect: true })
      .then((r) => {
        if (live && r && r.enabled === false) setDisabled(true);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [navigate, next, qc]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    say('');
    setBusy(true);
    try {
      await request('POST', '/admin/login', { username, password }, { noAuthRedirect: true });
      qc.clear();
      void navigate(next, { replace: true });
    } catch (err) {
      if (err instanceof ApiError && err.status === 503) setDisabled(true);
      say(errorMessage(err), 'bad');
      setPassword('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-wrap">
      <form className="login" onSubmit={submit} noValidate={false}>
        <div className="brand">
          <strong>Post It Up</strong>
          <span>Admin</span>
        </div>
        <h1>Sign in</h1>
        <p className="sub">Manage models, prompts, integrations and users.</p>
        {disabled ? (
          <p className="callout">
            Admin sign-in is disabled. Set ADMIN_USERNAME and ADMIN_PASSWORD in the server&apos;s
            .env and restart it.
          </p>
        ) : null}
        <label htmlFor="username">Username</label>
        <input
          id="username"
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          required
          autoFocus={!disabled}
          disabled={disabled}
          value={username}
          onChange={(e) => setUsername(e.target.value)}
        />
        <label htmlFor="password">Password</label>
        <input
          id="password"
          type="password"
          autoComplete="current-password"
          required
          disabled={disabled}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <button type="submit" disabled={busy || disabled}>
          {busy ? 'Signing in…' : 'Log in'}
        </button>
        <Msg msg={msg} />
      </form>
      <Toasts />
    </div>
  );
}
