import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

import { api, errorMessage } from '../../api/client';
import { Icon } from '../../components/Icon';
import { Modal } from '../../components/Overlay';
import { Msg } from '../../components/ui';
import { useMsg, useNow } from '../../lib/hooks';
import { toast } from '../../lib/toast';
import { dbKeys, useWriteMode } from './dbApi';

const mmss = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

function UnlockModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, say] = useMsg();
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    say('');
    try {
      const state = await api.post('/db/write-mode', { password });
      qc.setQueryData(dbKeys.writeMode, state);
      toast('Write mode on for 15 minutes. A backup is taken before the first change.', 'good');
      onClose();
    } catch (err) {
      setPassword('');
      say(errorMessage(err), 'bad');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title="Turn on write mode" onClose={onClose} initialFocus="#unlock-password">
      <p className="muted">
        Re-enter your admin password. Write mode lasts 15 minutes (or until you sign out); every
        change is backed up first and recorded in the audit log.
      </p>
      <form onSubmit={submit}>
        <input type="text" autoComplete="username" hidden readOnly value="" />
        <label htmlFor="unlock-password">Password</label>
        <input
          id="unlock-password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <Msg msg={msg} />
        <div className="actions">
          <button className="ghost" type="button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" disabled={busy || !password}>
            {busy ? 'Checking…' : 'Turn on'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/** Sticky banner on every Database page: read-only, or write mode with a countdown. */
export function WriteModeBanner() {
  const qc = useQueryClient();
  const wm = useWriteMode();
  const [unlock, setUnlock] = useState(false);
  const on = wm.data?.on === true;
  const now = useNow(on);
  const left = wm.data?.on ? wm.data.until - now : 0;

  useEffect(() => {
    if (on && left <= 0) void qc.invalidateQueries({ queryKey: dbKeys.writeMode });
  }, [on, left, qc]);

  const off = async () => {
    try {
      const state = await api.delete('/db/write-mode', {});
      qc.setQueryData(dbKeys.writeMode, state);
      toast('Write mode off.', 'good');
    } catch (e) {
      toast(errorMessage(e), 'bad');
    }
  };

  return (
    <>
      <div className={`write-banner${on ? ' on' : ''}`} role="status">
        {wm.data?.on ? (
          <>
            <span>
              <strong>Write mode on</strong> · {mmss(left)} left ·{' '}
              {wm.data.backedUp ? 'backup taken' : 'a backup is taken before the first change'}
            </span>
            <button className="small secondary" type="button" onClick={off}>
              Turn off
            </button>
          </>
        ) : (
          <>
            <span className="row" style={{ gap: 8, alignItems: 'center' }}>
              <Icon name="lock" />
              Read-only. Secret columns are masked (••••) and never editable.
            </span>
            <button
              className="small"
              type="button"
              disabled={!wm.data}
              onClick={() => setUnlock(true)}>
              Turn on write mode
            </button>
          </>
        )}
      </div>
      {unlock ? <UnlockModal onClose={() => setUnlock(false)} /> : null}
    </>
  );
}
