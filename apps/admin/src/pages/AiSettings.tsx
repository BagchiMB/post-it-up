import type {
  AdminSettings,
  AdminSettingsPatch,
  ListedModel,
  StepKey,
  StepModelRow,
} from '@postitup/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router';

import { api, errorMessage } from '../api/client';
import { modelsQuery, qk, useSession, useSettings, useStepModels } from '../api/queries';
import { type Column, DataTable } from '../components/DataTable';
import { Drawer } from '../components/Overlay';
import { ErrorBox, Msg, PageHead, Pill, SkeletonLines } from '../components/ui';
import { num, price, usd } from '../lib/format';
import { useMsg } from '../lib/hooks';
import { toast } from '../lib/toast';

type Target = 'default' | StepKey;

const isFree = (m: ListedModel) =>
  !m.router && (m.id.endsWith(':free') || (m.inputPrice === 0 && m.outputPrice === 0));
const total = (m: ListedModel) =>
  m.router ? Infinity : (m.inputPrice ?? 0) + (m.outputPrice ?? 0);

const NoSO = ({ so }: { so: boolean | undefined }) =>
  so === false ? (
    <>
      {' '}
      <Pill kind="warn">No structured outputs</Pill>
    </>
  ) : null;

function ModelPicker({
  target,
  settings,
  steps,
  onClose,
}: {
  target: Target;
  settings: AdminSettings;
  steps: StepModelRow[];
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const models = useQuery(modelsQuery);
  const [search, setSearch] = useState('');
  const [free, setFree] = useState(false);
  const [so, setSo] = useState(false);
  const [routers, setRouters] = useState(false);
  const [sort, setSort] = useState<'asc' | 'desc' | 'name'>('asc');
  const [msg, say] = useMsg();
  const step = target === 'default' ? null : steps.find((s) => s.key === target);
  const needsVision = target === 'default' ? true : !!step?.vision;
  const currentId = target === 'default' ? settings.model.id : (step?.model ?? settings.model).id;
  const title = target === 'default' ? 'Default model' : (step?.label ?? target);

  const shown = useMemo(() => {
    if (!models.data) return [];
    const q = search.trim().toLowerCase();
    const list = models.data.filter(
      (m) =>
        (!q || m.name.toLowerCase().includes(q) || m.id.toLowerCase().includes(q)) &&
        (routers || !m.router || m.id === currentId) &&
        (!free || isFree(m)) &&
        (!so || m.structuredOutputs),
    );
    list.sort((a, b) =>
      sort === 'name'
        ? a.name.localeCompare(b.name)
        : a.router !== b.router
          ? a.router
            ? 1
            : -1
          : (sort === 'asc' ? 1 : -1) * (total(a) - total(b) || 0),
    );
    return list.slice(0, 150);
  }, [models.data, search, routers, free, so, sort, currentId]);

  const choose = async (m: ListedModel) => {
    const model = { id: m.id, name: m.name, structuredOutputs: m.structuredOutputs };
    say('Saving…');
    try {
      const patch: AdminSettingsPatch =
        target === 'default' ? { model } : { stepModels: { [target]: model } };
      const next = await api.put<AdminSettings>('/settings', patch);
      qc.setQueryData(qk.settings, next);
      await Promise.all([
        qc.invalidateQueries({ queryKey: qk.stepModels }),
        qc.invalidateQueries({ queryKey: qk.overview }),
        qc.invalidateQueries({ queryKey: qk.prompts }),
      ]);
      toast(
        `${title}: ${m.name}${m.structuredOutputs ? '' : ' (no structured outputs; JSON may be less reliable)'}`,
        m.structuredOutputs ? 'good' : 'bad',
      );
      onClose();
    } catch (e) {
      say(errorMessage(e), 'bad');
    }
  };

  return (
    <Drawer
      kicker="Choose a model for"
      title={title}
      onClose={onClose}
      initialFocus="#picker-search">
      <div className="drawer-tools">
        <label htmlFor="picker-search" className="sr-only">
          Search models
        </label>
        <input
          id="picker-search"
          type="search"
          placeholder="Search models…"
          autoComplete="off"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div className="row" style={{ alignItems: 'center', marginTop: 10 }}>
          <label className="chip">
            <input type="checkbox" checked={free} onChange={(e) => setFree(e.target.checked)} />{' '}
            Free
          </label>
          <label className="chip">
            <input type="checkbox" checked={so} onChange={(e) => setSo(e.target.checked)} />{' '}
            Structured outputs
          </label>
          <label className="chip">
            <input
              type="checkbox"
              checked={routers}
              onChange={(e) => setRouters(e.target.checked)}
            />{' '}
            Include auto-routers
          </label>
          <label htmlFor="f-sort" className="sr-only">
            Sort
          </label>
          <select
            id="f-sort"
            style={{ width: 'auto', height: 32, marginLeft: 'auto' }}
            value={sort}
            onChange={(e) => setSort(e.target.value as typeof sort)}>
            <option value="asc">Price ↑</option>
            <option value="desc">Price ↓</option>
            <option value="name">Name</option>
          </select>
        </div>
      </div>
      {routers ? (
        <p className="muted" style={{ margin: 0 }}>
          Auto-routers pick a model per request — great for varied requests, but they make
          prompt-version comparisons noisier.
        </p>
      ) : null}
      <ul className="list drawer-list" role="listbox" aria-label="Models">
        {models.isPending ? (
          <li className="muted">Loading models…</li>
        ) : models.error ? (
          <li className="msg bad">{errorMessage(models.error)}</li>
        ) : shown.length === 0 ? (
          <li className="empty">No models match these filters.</li>
        ) : (
          shown.map((m) => {
            const blocked = needsVision && !m.vision;
            const sel = m.id === currentId;
            return (
              <li
                key={m.id}
                className={`pick${sel ? ' sel' : ''}`}
                role="option"
                aria-selected={sel}
                aria-disabled={blocked || undefined}
                tabIndex={blocked ? -1 : 0}
                title={blocked ? 'This step sees photos; this model can’t read images.' : undefined}
                onClick={blocked ? undefined : () => void choose(m)}
                onKeyDown={
                  blocked
                    ? undefined
                    : (e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          void choose(m);
                        }
                      }
                }>
                <span className="name">
                  {m.name}
                  <div className="muted mono">{m.id}</div>
                  <div className="tags">
                    {m.vision ? <Pill kind="neutral">Images</Pill> : null}
                    {!m.structuredOutputs ? <Pill kind="warn">No structured outputs</Pill> : null}
                    {isFree(m) ? <Pill kind="ok">Free</Pill> : null}
                    {m.router ? <Pill kind="pending">Auto · variable price</Pill> : null}
                  </div>
                </span>
                <span className="muted" style={{ textAlign: 'right' }}>
                  {m.router
                    ? 'variable'
                    : `${price(m.inputPrice ?? 0)} / ${price(m.outputPrice ?? 0)}`}
                </span>
              </li>
            );
          })
        )}
      </ul>
      <Msg msg={msg} />
    </Drawer>
  );
}

function ClipLengths({ settings }: { settings: AdminSettings }) {
  const qc = useQueryClient();
  const [lengths, setLengths] = useState(settings.clipLengths);
  const [add, setAdd] = useState('');
  const [msg, say] = useMsg();
  const [busy, setBusy] = useState(false);

  const addLength = () => {
    const n = Number(add);
    if (!Number.isInteger(n) || n < 5 || n > 90) {
      say('Enter a whole number from 5 to 90.', 'bad');
      return;
    }
    if (!lengths.includes(n)) setLengths([...lengths, n].sort((a, b) => a - b));
    setAdd('');
    say('');
  };
  const save = async () => {
    say('Saving…');
    setBusy(true);
    try {
      const s = await api.put<AdminSettings>('/settings', { clipLengths: lengths });
      qc.setQueryData(qk.settings, s);
      setLengths(s.clipLengths);
      say('Saved.', 'good');
    } catch (e) {
      say(errorMessage(e), 'bad');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section>
      <h2>Song clip lengths</h2>
      <p className="muted">The AI picks one of these per song (seconds, 5–90, up to 8).</p>
      <div className="chips">
        {lengths.map((n) => (
          <button
            key={n}
            type="button"
            className="chip"
            aria-label={`Remove ${n} seconds`}
            onClick={() => setLengths(lengths.filter((x) => x !== n))}>
            {n} s ×
          </button>
        ))}
      </div>
      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault();
          addLength();
        }}>
        <div className="field">
          <label htmlFor="length-add">Add a length</label>
          <input
            id="length-add"
            type="number"
            min={5}
            max={90}
            step={1}
            value={add}
            onChange={(e) => setAdd(e.target.value)}
          />
        </div>
        <button className="secondary" type="submit">
          Add
        </button>
        <button type="button" onClick={save} disabled={busy}>
          Save lengths
        </button>
      </form>
      <Msg msg={msg} />
    </section>
  );
}

export function AiSettingsPage() {
  const qc = useQueryClient();
  const settings = useSettings();
  const steps = useStepModels();
  const models = useQuery(modelsQuery);
  const session = useSession();
  const { hash } = useLocation();
  const [target, setTarget] = useState<Target | null>(null);
  const s = settings.data;
  const st = steps.data;

  // /admin/ai#step-<key> (from a prompt page): highlight and scroll to that row.
  const hashKey = hash.startsWith('#step-') ? decodeURIComponent(hash.slice(6)) : null;
  useEffect(() => {
    if (!hashKey || !st) return;
    document.getElementById(`step-${hashKey}`)?.scrollIntoView({ block: 'center' });
  }, [hashKey, st]);

  const reset = async (key: StepKey) => {
    try {
      const next = await api.put<AdminSettings>('/settings', { stepModels: { [key]: null } });
      qc.setQueryData(qk.settings, next);
      await qc.invalidateQueries({ queryKey: qk.stepModels });
      toast('Reset to the default model.', 'good');
    } catch (e) {
      toast(errorMessage(e), 'bad');
    }
  };

  const cols = useMemo<Column<StepModelRow>[]>(
    () => [
      {
        id: 'step',
        header: 'Step',
        wrap: true,
        cell: (r) => (
          <span id={`step-${r.key}`}>
            <strong>{r.label}</strong> {r.vision ? <Pill kind="pending">Sees photos</Pill> : null}
            <div className="muted">{r.description}</div>
          </span>
        ),
      },
      {
        id: 'model',
        header: 'Model',
        wrap: true,
        cell: (r) =>
          r.model ? (
            <>
              <strong>{r.model.name}</strong>
              <NoSO so={r.model.structuredOutputs} />
              <div className="muted mono">{r.model.id}</div>
            </>
          ) : (
            <>
              <span className="muted">Default ·</span> {r.effective.name}
              <NoSO so={s?.model.structuredOutputs} />
            </>
          ),
      },
      {
        id: 'stats',
        header: 'Last 30 days (avg)',
        num: true,
        cell: (r) =>
          r.last30d.calls ? (
            <>
              {usd(r.last30d.avgCostUsd, 4)}/call
              <div className="muted">
                {r.last30d.calls} calls · {num(r.last30d.avgPromptTokens)} in /{' '}
                {num(r.last30d.avgCompletionTokens)} out tok
              </div>
            </>
          ) : (
            <span className="muted">No calls yet</span>
          ),
      },
      {
        id: 'actions',
        header: '',
        cell: (r) => (
          <div className="actions">
            <button className="secondary small" type="button" onClick={() => setTarget(r.key)}>
              Change
            </button>
            {r.model ? (
              <button className="ghost small" type="button" onClick={() => void reset(r.key)}>
                Reset to default
              </button>
            ) : null}
          </div>
        ),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `reset` only uses stable refs
    [s?.model.structuredOutputs],
  );

  // "A paid model is in use but the balance is $0" (same rule as before).
  const balance = session.data?.openrouter?.balance;
  const paidInUse =
    !!st &&
    st.some((x) => {
      const m = models.data?.find((y) => y.id === x.effective.id);
      return m ? !isFree(m) : !x.effective.id.endsWith(':free');
    });

  return (
    <>
      <PageHead
        title="AI settings"
        description="The default model, a model per AI step, and the song clip lengths."
      />
      {settings.error || steps.error ? <ErrorBox error={settings.error ?? steps.error} /> : null}
      {paidInUse && balance?.status === 'empty' ? (
        <p className="callout" role="note">
          A paid model is in use but the OpenRouter balance is {usd(balance.balanceUsd ?? 0)}. Tasks
          will fail until you add credits on openrouter.ai or pick free models.
        </p>
      ) : null}
      <section id="default">
        {s ? (
          <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ minWidth: 0 }}>
              <div className="muted">Default model · used by every step without its own model</div>
              <div className="big">{s.model.name}</div>
              <div className="muted mono">
                {s.model.id}
                <NoSO so={s.model.structuredOutputs} />
              </div>
            </div>
            <button className="secondary" type="button" onClick={() => setTarget('default')}>
              Change
            </button>
          </div>
        ) : (
          <SkeletonLines lines={3} />
        )}
      </section>
      <section>
        <h2>Model per step</h2>
        {st ? (
          <DataTable
            columns={cols}
            data={st}
            getRowId={(r) => r.key}
            rowClassName={(r) => (r.key === hashKey ? 'outlined' : undefined)}
            label="Model per step"
          />
        ) : (
          <SkeletonLines lines={6} />
        )}
        <p className="muted" style={{ marginTop: 12 }}>
          Steps that see photos need an image-capable model. Models without structured outputs get
          the JSON format in the prompt instead, which is less reliable.
        </p>
      </section>
      {s ? <ClipLengths key={s.clipLengths.join(',')} settings={s} /> : null}
      {target && s && st ? (
        <ModelPicker target={target} settings={s} steps={st} onClose={() => setTarget(null)} />
      ) : null}
    </>
  );
}
