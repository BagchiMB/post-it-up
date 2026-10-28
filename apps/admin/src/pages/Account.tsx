import { useState } from 'react';

import { api, errorMessage } from '../api/client';
import { useAccount } from '../api/queries';
import { ErrorBox, Msg, PageHead, SkeletonLines } from '../components/ui';
import { when } from '../lib/format';
import { useMsg } from '../lib/hooks';

export function AccountPage() {
  const q = useAccount();
  const a = q.data;
  const [cur, setCur] = useState('');
  const [next, setNext] = useState('');
  const [next2, setNext2] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, say] = useMsg();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (next !== next2) {
      say('The new passwords don’t match.', 'bad');
      return;
    }
    say('Saving…');
    setBusy(true);
    try {
      await api.post('/account/password', { currentPassword: cur, newPassword: next });
      setCur('');
      setNext('');
      setNext2('');
      say('Password changed.', 'good');
      void q.refetch();
    } catch (err) {
      say(errorMessage(err), 'bad');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHead title="Admin account" description="Your admin sign-in and password." />
      {q.error ? <ErrorBox error={q.error} /> : null}
      {q.isSuccess && !a ? <p>No admin account.</p> : null}
      <section>
        <h2>Account</h2>
        {a ? (
          <>
            <p>
              Username <strong>{a.username}</strong> · password changed {when(a.updatedAt)}
            </p>
            <p className="muted">
              This sign-in: {when(a.lastLoginAt)} from {a.lastLoginIp ?? '—'}
              <br />
              Previous sign-in: {when(a.previousLoginAt)} from {a.previousLoginIp ?? '—'}
            </p>
            {a.weakPassword ? (
              <p className="callout">
                The password is shorter than 12 characters. Please change it.
              </p>
            ) : null}
          </>
        ) : (
          <SkeletonLines lines={3} />
        )}
      </section>
      <section>
        <h2>Change password</h2>
        <form style={{ maxWidth: 420 }} onSubmit={submit}>
          <input
            type="text"
            name="username"
            autoComplete="username"
            value={a?.username ?? ''}
            readOnly
            hidden
          />
          <label htmlFor="cur">Current password</label>
          <input
            id="cur"
            type="password"
            autoComplete="current-password"
            required
            value={cur}
            onChange={(e) => setCur(e.target.value)}
          />
          <label htmlFor="new" style={{ marginTop: 12 }}>
            New password (at least 10 characters)
          </label>
          <input
            id="new"
            type="password"
            autoComplete="new-password"
            minLength={10}
            required
            value={next}
            onChange={(e) => setNext(e.target.value)}
          />
          <label htmlFor="new2" style={{ marginTop: 12 }}>
            New password again
          </label>
          <input
            id="new2"
            type="password"
            autoComplete="new-password"
            minLength={10}
            required
            value={next2}
            onChange={(e) => setNext2(e.target.value)}
          />
          <p />
          <button type="submit" disabled={busy}>
            Change password
          </button>
          <Msg msg={msg} />
          <p className="muted">Other signed-in admin sessions are signed out.</p>
        </form>
      </section>
    </>
  );
}
