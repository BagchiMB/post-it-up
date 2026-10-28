import type { DbRow, DbStructure, DbWritePreview } from '@postitup/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router';

import { api, errorMessage } from '../../api/client';
import { ConfirmDialog, Drawer } from '../../components/Overlay';
import { ErrorBox, Msg, SkeletonLines } from '../../components/ui';
import { useMsg } from '../../lib/hooks';
import { toast } from '../../lib/toast';
import { cellText, dbKeys, MASK, prettyJson, tablePath, useWriteMode } from './dbApi';

type Col = DbStructure['columns'][number];
type Draft = Record<string, { text: string; isNull: boolean }>;

/** Turns an edited field back into a value: numbers stay numbers for numeric columns. */
function toValue(d: { text: string; isNull: boolean }, col: Col | undefined, original: unknown) {
  if (d.isNull) return null;
  const numeric = typeof original === 'number' || /INT|REAL|FLOA|DOUB|NUM/i.test(col?.type ?? '');
  if (numeric && d.text.trim() !== '' && Number.isFinite(Number(d.text))) return Number(d.text);
  if (col?.json && d.text.trim() !== '') {
    // Store JSON compactly (it was pretty-printed for editing).
    return JSON.stringify(JSON.parse(d.text));
  }
  return d.text;
}

const compact = (json: string) => {
  try {
    return JSON.stringify(JSON.parse(json));
  } catch {
    return json;
  }
};

function initialDraft(row: Record<string, unknown> | null, cols: Col[]): Draft {
  return Object.fromEntries(
    cols.map((c) => {
      const v = row ? row[c.name] : null;
      const isNull = row ? v === null || v === undefined : false;
      const text = isNull
        ? ''
        : ((c.json ? prettyJson(v) : null) ?? (v === undefined ? '' : cellText(v)));
      return [c.name, { text, isNull: row ? isNull : false }];
    }),
  );
}

type PendingWrite = {
  preview: DbWritePreview['preview'];
  run: (token: string) => Promise<void>;
  token: string;
};

/**
 * Right-side drawer for one row (`rowid`) or a new row (`rowid === null`): every field, related-row
 * links, and — in write mode — edit / insert / delete with a "N rows will change" confirmation.
 */
export function RowDrawer({
  table,
  rowid,
  structure,
  onClose,
}: {
  table: string;
  rowid: number | null;
  structure: DbStructure | undefined;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const wm = useWriteMode();
  const writable = wm.data?.on === true && table !== 'db_audit';
  const isNew = rowid === null;
  const detail = useQuery({
    queryKey: dbKeys.row(table, rowid ?? -1),
    queryFn: () => api.get<DbRow>(`/db/tables/${encodeURIComponent(table)}/rows/${rowid}`),
    enabled: !isNew,
  });
  const cols = structure?.columns ?? [];
  const row = detail.data?.row ?? null;
  const [editing, setEditing] = useState(isNew);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [pending, setPending] = useState<PendingWrite | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, say] = useMsg();

  const current = draft ?? (structure && (isNew || row) ? initialDraft(row, cols) : null);

  const refresh = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ['db', 'rows', table] }),
      qc.invalidateQueries({ queryKey: ['db', 'row', table] }),
      qc.invalidateQueries({ queryKey: ['db', 'audit'] }),
      qc.invalidateQueries({ queryKey: dbKeys.tables }),
      qc.invalidateQueries({ queryKey: dbKeys.writeMode }),
    ]);
  };

  /** First call previews (returns a token); the confirm dialog re-sends with it. */
  const startWrite = async (send: (token?: string) => Promise<unknown>, done: string) => {
    say('');
    setBusy(true);
    try {
      const p = (await send()) as DbWritePreview;
      setPending({
        preview: p.preview,
        token: p.confirmToken,
        run: async (token) => {
          await send(token);
          await refresh();
          toast(done, 'good');
        },
      });
    } catch (e) {
      say(errorMessage(e), 'bad');
    } finally {
      setBusy(false);
    }
  };

  const changedValues = () => {
    if (!current) return {};
    const out: Record<string, unknown> = {};
    for (const c of cols) {
      if (c.masked) continue;
      const d = current[c.name];
      if (!d) continue;
      const original = row?.[c.name];
      if (original === MASK) continue;
      if (c.json && !d.isNull && d.text.trim() !== '') {
        try {
          JSON.parse(d.text);
        } catch {
          throw new Error(`${c.name} isn’t valid JSON.`);
        }
      }
      const v = toValue(d, c, original);
      if (isNew) {
        if (d.isNull || d.text !== '') out[c.name] = v;
      } else {
        const before = original === undefined ? null : original;
        const same =
          v === before || (c.json && typeof before === 'string' && v === compact(before));
        if (!same) out[c.name] = v;
      }
    }
    return out;
  };

  const save = () => {
    let values: Record<string, unknown>;
    try {
      values = changedValues();
    } catch (e) {
      say(errorMessage(e), 'bad');
      return;
    }
    const base = `/db/tables/${encodeURIComponent(table)}/rows`;
    if (isNew) {
      void startWrite(
        (token) => api.post(base, { values, ...(token ? { confirmToken: token } : {}) }),
        `Row added to ${table}.`,
      );
      return;
    }
    if (!Object.keys(values).length) {
      say('Nothing changed.', 'bad');
      return;
    }
    void startWrite(
      (token) =>
        api.patch(`${base}/${rowid}`, { values, ...(token ? { confirmToken: token } : {}) }),
      `Row ${rowid} updated.`,
    );
  };

  const remove = () =>
    void startWrite(
      (token) =>
        api.delete(
          `/db/tables/${encodeURIComponent(table)}/rows/${rowid}`,
          token ? { confirmToken: token } : {},
        ),
      `Row ${rowid} deleted.`,
    );

  const confirm = async () => {
    if (!pending) return;
    setBusy(true);
    try {
      await pending.run(pending.token);
      setPending(null);
      if (isNew || pending.preview.action === 'delete') onClose();
      else {
        setEditing(false);
        setDraft(null);
      }
    } catch (e) {
      setPending(null);
      say(errorMessage(e), 'bad');
    } finally {
      setBusy(false);
    }
  };

  const setField = (name: string, patch: Partial<{ text: string; isNull: boolean }>) =>
    setDraft({
      ...(current ?? {}),
      [name]: { ...(current?.[name] ?? { text: '', isNull: false }), ...patch },
    });

  const fieldValue = (c: Col) => {
    const v = row?.[c.name];
    if (v === null || v === undefined) return <span className="cell-null">NULL</span>;
    if (v === MASK || c.masked) return <span className="masked">{MASK}</span>;
    const pretty = c.json ? prettyJson(v) : null;
    return <div className="value">{pretty ?? cellText(v)}</div>;
  };

  const footer = writable ? (
    editing ? (
      <>
        <button
          className="ghost"
          type="button"
          onClick={() => {
            if (isNew) onClose();
            else {
              setEditing(false);
              setDraft(null);
              say('');
            }
          }}>
          Cancel
        </button>
        <button type="button" disabled={busy || !current} onClick={save}>
          {isNew ? 'Insert row' : 'Save changes'}
        </button>
      </>
    ) : (
      <>
        <button className="danger" type="button" disabled={busy || !row} onClick={remove}>
          Delete row
        </button>
        <button type="button" disabled={!row} onClick={() => setEditing(true)}>
          Edit
        </button>
      </>
    )
  ) : null;

  return (
    <>
      <Drawer
        wide
        kicker={<span className="mono">{table}</span>}
        title={isNew ? 'New row' : `Row ${rowid}`}
        onClose={onClose}
        footer={footer}>
        <div className="drawer-body">
          {detail.error ? <ErrorBox error={detail.error} /> : null}
          {!writable && !isNew ? (
            <p className="muted" style={{ marginTop: 0 }}>
              {table === 'db_audit'
                ? 'The audit log can’t be edited.'
                : 'Turn on write mode (banner above) to edit or delete this row.'}
            </p>
          ) : null}
          {!current && !row ? (
            <SkeletonLines lines={8} />
          ) : (
            <div className="field-list">
              {(cols.length
                ? cols
                : Object.keys(row ?? {})
                    .filter((k) => k !== '__rowid')
                    .map((name) => ({
                      name,
                      type: '',
                      notNull: false,
                      default: null,
                      primaryKey: false,
                      masked: false,
                      json: false,
                    }))
              ).map((c) => {
                const d = current?.[c.name];
                const locked = c.masked || row?.[c.name] === MASK;
                const id = `fld-${c.name}`;
                return (
                  <div className="fld" key={c.name}>
                    <div className="fld-head">
                      {editing && !locked ? (
                        <label htmlFor={id} className="mono" style={{ margin: 0 }}>
                          {c.name}
                        </label>
                      ) : (
                        <strong className="mono">{c.name}</strong>
                      )}
                      <span className="muted">
                        {[c.type, c.primaryKey && 'PK', c.json && 'JSON', locked && 'masked']
                          .filter(Boolean)
                          .join(' · ')}
                      </span>
                    </div>
                    {editing && !locked && d ? (
                      <>
                        <textarea
                          id={id}
                          rows={
                            c.json
                              ? Math.min(14, Math.max(3, d.text.split('\n').length))
                              : d.text.length > 80
                                ? 3
                                : 1
                          }
                          spellCheck={false}
                          disabled={d.isNull}
                          placeholder={
                            isNew ? (c.default !== null ? `default: ${c.default}` : '') : ''
                          }
                          value={d.text}
                          onChange={(e) => setField(c.name, { text: e.target.value })}
                        />
                        {!c.notNull ? (
                          <label className="check" style={{ marginTop: 6 }}>
                            <input
                              type="checkbox"
                              checked={d.isNull}
                              onChange={(e) => setField(c.name, { isNull: e.target.checked })}
                            />{' '}
                            NULL
                          </label>
                        ) : null}
                        {c.json && !d.isNull && d.text.trim() && prettyJson(d.text) === null ? (
                          <div className="msg bad">Not valid JSON.</div>
                        ) : null}
                      </>
                    ) : isNew ? (
                      <span className="masked">{MASK} (secret, set elsewhere)</span>
                    ) : (
                      fieldValue(c)
                    )}
                  </div>
                );
              })}
            </div>
          )}
          {detail.data && (detail.data.outgoing.length || detail.data.incoming.length) ? (
            <>
              <h3 className="section-title" style={{ marginTop: 18 }}>
                Related rows
              </h3>
              <ul className="side-list">
                {detail.data.outgoing.map((r) => (
                  <li key={`o-${r.column}`}>
                    <span className="mono">{r.column}</span> →{' '}
                    <Link
                      to={tablePath(r.table, { [`f.${r.toColumn}`]: `eq:${cellText(r.value)}` })}
                      onClick={onClose}>
                      {r.table}.{r.toColumn} = {cellText(r.value)}
                    </Link>
                    {r.inferred ? <span className="muted"> (inferred)</span> : null}
                  </li>
                ))}
                {detail.data.incoming.map((r) => (
                  <li key={`i-${r.table}-${r.column}`}>
                    <Link
                      to={tablePath(r.table, { [`f.${r.column}`]: `eq:${cellText(r.value)}` })}
                      onClick={onClose}>
                      {r.count} row{r.count === 1 ? '' : 's'} in {r.table}
                    </Link>{' '}
                    <span className="muted">
                      via {r.column}
                      {r.inferred ? ' (inferred)' : ''}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
          <Msg msg={msg} />
        </div>
      </Drawer>
      {pending ? (
        <ConfirmDialog
          title={
            pending.preview.action === 'insert'
              ? 'Insert this row?'
              : `${pending.preview.affected ?? 0} row${pending.preview.affected === 1 ? '' : 's'} will change`
          }
          message={
            pending.preview.action === 'insert'
              ? `A new row will be inserted into ${pending.preview.table}.`
              : `${pending.preview.action === 'delete' ? 'Delete' : 'Update'} ${pending.preview.affected ?? 0} row(s) in ${pending.preview.table}. The change is backed up and recorded in the audit log.`
          }
          confirmLabel={
            pending.preview.action === 'delete'
              ? 'Delete'
              : pending.preview.action === 'insert'
                ? 'Insert'
                : 'Save'
          }
          danger={pending.preview.action === 'delete'}
          busy={busy}
          onConfirm={() => void confirm()}
          onCancel={() => setPending(null)}
        />
      ) : null}
    </>
  );
}
