import type { Context } from 'hono';

import { config } from '../config.ts';
import { one } from '../db.ts';
import { allModels, type Credits, credits, isFreeModel, type ListedModel } from '../openrouter.ts';
import { failuresSince, INTEGRATIONS, queryLogs } from '../outbound.ts';
import { listPrompts, listVersions, promptDef, type PromptKey } from '../prompts.ts';
import {
  keyHint,
  openRouterKey,
  secretHint,
  serverSettings,
  spotifyClientId,
  spotifyClientSecret,
  updateServerSettings,
} from '../server-settings.ts';
import { spendToday, usageBreakdown } from '../usage.ts';
import { spotifyConnectedCount, spotifySlotsUsed } from '../users.ts';
import {
  accountView,
  logFilterFrom,
  pendingSpotifyRequests,
  spotifyAccessList,
  stepModelsView,
  usersList,
} from './api.ts';
import { CHECKS, lastRun } from './checks.ts';
import { h, type NavItem, pill, usd, when } from './layout.ts';

/**
 * The admin site's page registry: add a section by adding an entry here (route + optional nav
 * label + renderer). Pages render on the server; `script` is the page's own inline JS.
 */
type PageOut = { body: string; script?: string; title?: string; description?: string };

export type AdminPage = {
  path: string;
  title: string;
  /** Shown in the nav when set. */
  nav?: string;
  /** Nav icon name (see layout.ts) and group label; `bottom` pins it above Sign out. */
  icon?: string;
  group?: 'AI' | 'People' | 'System';
  bottom?: boolean;
  /** One line under the page title. */
  description?: string;
  /** Which nav entry to highlight (defaults to `path`). */
  section?: string;
  /** A count shown next to the nav label (e.g. pending requests); hidden when 0. */
  badge?: () => number;
  render: (c: Context) => Promise<PageOut> | PageOut;
};

const json = (v: unknown) => JSON.stringify(v).replace(/</g, '\\u003c');
const STARTED = Date.now();

async function creditsOrNull(): Promise<{ value: Credits | null; error?: string }> {
  const key = openRouterKey();
  if (!key) return { value: null, error: 'No OpenRouter key is set.' };
  try {
    return { value: await credits(key) };
  } catch (e) {
    return { value: null, error: (e as Error).message };
  }
}

const card = (label: string, value: string, sub = '') =>
  `<div class="card"><div class="label">${h(label)}</div><div class="big">${value}</div>${sub ? `<div class="muted">${sub}</div>` : ''}</div>`;

function creditsCards(cr: { value: Credits | null; error?: string }) {
  const c = cr.value;
  if (!c) return card('Account balance', '—', h(cr.error ?? 'Unavailable'));
  const k = c.key;
  const balance =
    c.source === 'credits'
      ? card(
          'Account balance',
          usd(c.balance),
          `loaded ${h(usd(c.total))} · used ${h(usd(c.used))}`,
        )
      : card(
          'Account balance',
          '—',
          'OpenRouter didn’t return account credits (GET /credits failed)',
        );
  const limit = k
    ? card(
        'This key’s spending limit',
        k.limit === null ? 'No limit' : usd(k.limitRemaining),
        k.limit === null
          ? 'The key can spend the whole balance'
          : `left of ${h(usd(k.limit))} · not money in the account`,
      )
    : '';
  const usage = k
    ? card(
        'Key usage today',
        usd(k.usageDaily),
        `week ${h(usd(k.usageWeekly))} · month ${h(usd(k.usageMonthly))}`,
      )
    : '';
  return balance + limit + usage;
}

function freeTierWarning(c: Credits | null) {
  const k = c?.key;
  if (!k?.isFreeTier) return '';
  const left = k.freeRequests ? `${k.freeRequests.remaining} of ${k.freeRequests.limit}` : 'a few';
  return `<p class="callout" role="note">Free tier — only free models work (${h(left)} free requests left today). Add credits on openrouter.ai to use ${h(serverSettings().model.name)}.</p>`;
}

function barChart(byDay: { day: string; cost: number; calls: number }[]) {
  const W = 720;
  const H = 180;
  const pad = { l: 44, r: 8, t: 10, b: 24 };
  const max = Math.max(0.01, ...byDay.map((d) => d.cost));
  const bw = (W - pad.l - pad.r) / byDay.length;
  const y = (v: number) => pad.t + (H - pad.t - pad.b) * (1 - v / max);
  const bars = byDay
    .map((d, i) => {
      const top = y(d.cost);
      return `<rect class="bar" x="${(pad.l + i * bw + 1).toFixed(1)}" y="${top.toFixed(1)}" width="${Math.max(1, bw - 2).toFixed(1)}" height="${(H - pad.b - top).toFixed(1)}"><title>${h(d.day)}: ${h(usd(d.cost, 4))} · ${d.calls} calls</title></rect>`;
    })
    .join('');
  const labels = byDay
    .map((d, i) =>
      i % 5 === 0 || i === byDay.length - 1
        ? `<text x="${(pad.l + i * bw + bw / 2).toFixed(1)}" y="${H - 8}" text-anchor="middle">${h(d.day.slice(5))}</text>`
        : '',
    )
    .join('');
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Spend per day, last ${byDay.length} days">
    <line x1="${pad.l}" x2="${W - pad.r}" y1="${y(max)}" y2="${y(max)}"/><line x1="${pad.l}" x2="${W - pad.r}" y1="${y(0)}" y2="${y(0)}"/>
    <text x="${pad.l - 6}" y="${y(max) + 4}" text-anchor="end">${h(usd(max))}</text><text x="${pad.l - 6}" y="${y(0) + 4}" text-anchor="end">$0</text>
    ${bars}${labels}</svg>`;
}

function table(headers: [string, boolean?][], rows: string[][], empty = 'Nothing yet.') {
  if (rows.length === 0) return `<div class="empty">${h(empty)}</div>`;
  return `<div class="table-wrap"><table><thead><tr>${headers.map(([t, num]) => `<th${num ? ' class="num"' : ''}>${h(t)}</th>`).join('')}</tr></thead><tbody>${rows
    .map(
      (r) =>
        `<tr>${r.map((cell, i) => `<td${headers[i]?.[1] ? ' class="num"' : ''}>${cell}</td>`).join('')}</tr>`,
    )
    .join('')}</tbody></table></div>`;
}

// ---------------------------------------------------------------------------

export const PAGES: AdminPage[] = [
  {
    path: '/admin',
    nav: 'Overview',
    icon: 'overview',
    description: 'Credits, today’s activity and the health of every integration at a glance.',
    title: 'Overview',
    render: async () => {
      const cr = await creditsOrNull();
      const today = spendToday();
      const day = new Date().toISOString().slice(0, 10);
      const tasks = one<{ n: number }>(
        'SELECT COALESCE(SUM(count), 0) AS n FROM job_usage WHERE day = ?',
        day,
      )!.n;
      const since = Date.now() - 86_400_000;
      const failed = failuresSince(since);
      const s = serverSettings();
      const status = [
        ['OpenRouter key', !!openRouterKey()],
        ['Spotify app credentials', !!(spotifyClientId() && spotifyClientSecret())],
      ] as const;
      const checks = lastRun
        ? `<p class="muted">Last checks ${h(when(lastRun.at))}: ${lastRun.results.filter((r) => r.ok).length} of ${lastRun.results.length} OK. <a href="/admin/status">Status</a></p>`
        : `<p class="muted">No checks run yet. <a href="/admin/status">Run checks</a></p>`;
      return {
        body: `
        ${freeTierWarning(cr.value)}
        <div class="cards">
          ${
            cr.value?.source === 'credits'
              ? card(
                  'Account balance',
                  usd(cr.value.balance),
                  `<a href="/admin/ai-usage">AI usage</a>`,
                )
              : card(
                  'Account balance',
                  '—',
                  `${h(cr.error ?? 'Not available')} · <a href="/admin/ai-usage">AI usage</a>`,
                )
          }
          ${card('Spend today', usd(today.cost), `${today.calls} AI calls`)}
          ${card('Tasks today', String(tasks))}
          ${card('Failed calls (24 h)', String(failed), `<a href="/admin/logs?ok=failed&amp;from=${encodeURIComponent(new Date(since).toISOString())}">View in logs</a>`)}
        </div>
        <section><h2>Status</h2>
          <p class="row" style="align-items:center">${status.map(([label, ok]) => pill(ok ? 'ok' : 'bad', `${label}${ok ? '' : ': not set'}`)).join(' ')}</p>
          <p>Model: <strong>${h(s.model.name)}</strong> <span class="muted mono">${h(s.model.id)}</span></p>
          <p>Spotify: <strong>${spotifyConnectedCount()} of ${s.spotifyUserCap}</strong> connected · ${spotifySlotsUsed()} of ${s.spotifyUserCap} slots used${
            pendingSpotifyRequests()
              ? ` · <a href="/admin/spotify-access">${pendingSpotifyRequests()} pending request(s)</a>`
              : ''
          }</p>
          ${checks}
        </section>`,
      };
    },
  },
  {
    path: '/admin/ai-usage',
    nav: 'AI usage',
    icon: 'usage',
    group: 'AI',
    description: 'OpenRouter credits and what each user, step and model has cost.',
    title: 'AI usage',
    render: async () => {
      const cr = await creditsOrNull();
      const u = usageBreakdown(30);
      const names = new Map(
        (await allModels({ routers: true }).catch(() => [] as ListedModel[])).map((m) => [
          m.id,
          m.name,
        ]),
      );
      const total = u.byDay.reduce((n, d) => n + d.cost, 0);
      return {
        body: `
        <section><h2>OpenRouter</h2>${freeTierWarning(cr.value)}<div class="cards"${cr.value?.key?.isFreeTier ? ' style="margin-top:14px"' : ''}>${creditsCards(cr)}</div>
          <p class="muted">Account balance from GET /api/v1/credits; the key’s limit and usage from GET /api/v1/key. Cached for about a minute.</p></section>
        <section><h2>Our spend, last 30 days · ${h(usd(total))}</h2>${barChart(u.byDay)}</section>
        <section><h2>By user</h2>${table(
          [['User'], ['Tasks', true], ['Spend', true]],
          u.byUser.map((r) => [h(r.email), String(r.posts), h(usd(r.cost, 4))]),
        )}</section>
        <section><h2>By AI step</h2>${table(
          [['Step (prompt)'], ['Calls', true], ['Spend', true]],
          u.byStep.map((r) => [
            `<a href="/admin/prompts/${h(r.key)}">${h(r.key)}</a>`,
            String(r.calls),
            h(usd(r.cost, 4)),
          ]),
        )}</section>
        <section><h2>By model</h2>${table(
          [['Model'], ['Calls', true], ['Spend', true]],
          u.byModel.map((r) => [
            r.routedModel
              ? `<span class="mono">${h(names.get(r.model) ?? r.model)} → ${h(r.routedModel)}</span>`
              : `<span class="mono">${h(names.get(r.model) ?? r.model)}</span>`,
            String(r.calls),
            h(usd(r.cost, 4)),
          ]),
        )}</section>`,
      };
    },
  },
  {
    path: '/admin/ai',
    nav: 'AI settings',
    icon: 'ai',
    group: 'AI',
    description: 'The default model, a model per AI step, and the song clip lengths.',
    title: 'AI settings',
    render: async () => {
      const list = await allModels({ routers: true }).catch(() => [] as ListedModel[]);
      // A default seeded from env has only an id: fill in its name/details once the list is known.
      const seeded = serverSettings().model;
      const known =
        seeded.structuredOutputs === undefined ? list.find((m) => m.id === seeded.id) : undefined;
      if (known)
        updateServerSettings({
          model: { id: known.id, name: known.name, structuredOutputs: known.structuredOutputs },
        });
      const s = serverSettings();
      const cr = await creditsOrNull();
      const steps = stepModelsView();
      const effectiveIds = new Set(steps.map((st) => st.effective.id));
      const paidInUse = [...effectiveIds].some((id) => {
        const m = list.find((x) => x.id === id);
        return m ? !isFreeModel(m) : !id.endsWith(':free');
      });
      const broke = cr.value?.source === 'credits' && (cr.value.balance ?? 0) <= 0;
      const warn =
        paidInUse && broke
          ? `<p class="callout" role="note">A paid model is in use but the OpenRouter balance is ${h(usd(cr.value?.balance))}. Tasks will fail until you add credits on openrouter.ai or pick free models.</p>`
          : '';
      const noSO = (so: boolean | undefined) =>
        so === false ? ` ${pill('warn', 'No structured outputs')}` : '';
      const rows = steps.map((st) => {
        const m = st.model;
        const current = m
          ? `<strong>${h(m.name)}</strong>${noSO(m.structuredOutputs)}<div class="muted mono">${h(m.id)}</div>`
          : `<span class="muted">Default ·</span> ${h(st.effective.name)}${noSO(s.model.structuredOutputs)}`;
        const stats = st.last30d.calls
          ? `${h(usd(st.last30d.avgCostUsd, 4))}/call<div class="muted">${st.last30d.calls} calls · ${st.last30d.avgPromptTokens.toLocaleString('en-US')} in / ${st.last30d.avgCompletionTokens.toLocaleString('en-US')} out tok</div>`
          : '<span class="muted">No calls yet</span>';
        return `<tr id="step-${h(st.key)}">
          <td class="wrap"><strong>${h(st.label)}</strong> ${st.vision ? pill('pending', 'Sees photos') : ''}<div class="muted">${h(st.description)}</div></td>
          <td class="wrap">${current}</td>
          <td class="num">${stats}</td>
          <td><div class="actions"><button class="secondary small" type="button" data-change="${h(st.key)}">Change</button>${
            m
              ? `<button class="ghost small" type="button" data-reset="${h(st.key)}">Reset to default</button>`
              : ''
          }</div></td></tr>`;
      });
      return {
        body: `
        ${warn}
        <section id="default">
          <div class="row" style="justify-content:space-between;align-items:center">
            <div><div class="muted">Default model · used by every step without its own model</div>
              <div class="big">${h(s.model.name)}</div>
              <div class="muted mono">${h(s.model.id)}${noSO(s.model.structuredOutputs)}</div></div>
            <button class="secondary" type="button" data-change="default">Change</button>
          </div>
        </section>
        <section><h2>Model per step</h2>
          <div class="table-wrap"><table>
            <thead><tr><th>Step</th><th>Model</th><th class="num">Last 30 days (avg)</th><th></th></tr></thead>
            <tbody>${rows.join('')}</tbody></table></div>
          <p class="muted">Steps that see photos need an image-capable model. Models without structured outputs get the JSON format in the prompt instead, which is less reliable.</p>
        </section>
        <section><h2>Song clip lengths</h2>
          <p class="muted">The AI picks one of these per song (seconds, 5–90, up to 8).</p>
          <div class="chips" id="lengths"></div>
          <div class="row"><div class="field"><label for="length-add">Add a length</label><input id="length-add" type="number" min="5" max="90" step="1"></div>
            <button class="secondary" id="length-add-btn" type="button">Add</button><button id="lengths-save" type="button">Save lengths</button></div>
          <div class="msg" id="lengths-msg"></div>
        </section>
        <div class="drawer-overlay" id="picker-overlay" hidden></div>
        <aside class="drawer" id="picker" role="dialog" aria-modal="true" aria-labelledby="picker-title" hidden>
          <div class="drawer-head"><div><div class="muted">Choose a model for</div><h2 id="picker-title" style="margin:0"></h2></div>
            <button class="icon-btn" id="picker-close" type="button" aria-label="Close">×</button></div>
          <div class="drawer-tools">
            <label for="picker-search" class="sr-only">Search models</label>
            <input id="picker-search" type="search" placeholder="Search models…" autocomplete="off">
            <div class="row" style="align-items:center;margin-top:10px">
              <label class="chip"><input type="checkbox" id="f-free"> Free</label>
              <label class="chip"><input type="checkbox" id="f-so"> Structured outputs</label>
              <label class="chip"><input type="checkbox" id="f-routers"> Include auto-routers</label>
              <label for="f-sort" class="sr-only">Sort</label>
              <select id="f-sort" style="width:auto;height:32px;margin-left:auto"><option value="asc">Price ↑</option><option value="desc">Price ↓</option><option value="name">Name</option></select>
            </div>
          </div>
          <p class="muted" id="router-note" hidden>Auto-routers pick a model per request — great for varied requests, but they make prompt-version comparisons noisier.</p>
          <ul class="list drawer-list" id="picker-list" role="listbox"><li class="muted">Loading models…</li></ul>
          <div class="msg" id="picker-msg"></div>
        </aside>`,
        script: `
        const STEPS = ${json(steps.map((st) => ({ key: st.key, label: st.label, vision: st.vision, current: (st.model ?? s.model).id })))};
        const DEFAULT = ${json(s.model)};
        let lengths = ${json(s.clipLengths)};
        let models = null, target = null, lastFocus = null;
        const price = (n) => n === 0 ? 'free' : '$' + (n < 1 ? n.toFixed(2) : n < 10 ? n.toFixed(1) : n.toFixed(0));
        const isFree = (m) => !m.router && (m.id.endsWith(':free') || (m.inputPrice === 0 && m.outputPrice === 0));
        const total = (m) => m.router ? Infinity : m.inputPrice + m.outputPrice;
        function needsVision() { return target === 'default' ? true : STEPS.find((x) => x.key === target).vision; }
        function currentId() { return target === 'default' ? DEFAULT.id : STEPS.find((x) => x.key === target).current; }
        function render() {
          const list = $('picker-list'); list.textContent = '';
          if (!models) { const li = document.createElement('li'); li.className = 'muted'; li.textContent = 'Loading models…'; list.appendChild(li); return; }
          const q = $('picker-search').value.trim().toLowerCase();
          const routers = $('f-routers').checked;
          $('router-note').hidden = !routers;
          let shown = models.filter((m) => (!q || m.name.toLowerCase().includes(q) || m.id.toLowerCase().includes(q))
            && (routers || !m.router || m.id === currentId())
            && (!$('f-free').checked || isFree(m)) && (!$('f-so').checked || m.structuredOutputs));
          const sort = $('f-sort').value;
          shown.sort((a, b) => sort === 'name' ? a.name.localeCompare(b.name)
            : a.router !== b.router ? (a.router ? 1 : -1)
            : (sort === 'asc' ? 1 : -1) * (total(a) - total(b)));
          shown = shown.slice(0, 150);
          for (const m of shown) {
            const blocked = needsVision() && !m.vision;
            const li = document.createElement('li');
            li.className = 'pick' + (m.id === currentId() ? ' sel' : '');
            li.setAttribute('role', 'option'); li.tabIndex = blocked ? -1 : 0;
            if (blocked) { li.setAttribute('aria-disabled', 'true'); li.title = 'This step sees photos; this model can’t read images.'; li.style.opacity = '.45'; li.style.cursor = 'not-allowed'; }
            const name = document.createElement('span'); name.className = 'name'; name.textContent = m.name;
            const sub = document.createElement('div'); sub.className = 'muted mono'; sub.textContent = m.id; name.appendChild(sub);
            const tags = document.createElement('div'); tags.style.marginTop = '4px';
            const tag = (kind, text) => { const t = document.createElement('span'); t.className = 'pill ' + kind; t.textContent = text; t.style.marginRight = '4px'; tags.appendChild(t); };
            if (m.vision) tag('neutral', 'Images');
            if (!m.structuredOutputs) tag('warn', 'No structured outputs');
            if (isFree(m)) tag('ok', 'Free');
            if (m.router) tag('pending', 'Auto · variable price');
            name.appendChild(tags);
            const p = document.createElement('span'); p.className = 'muted'; p.style.textAlign = 'right'; p.textContent = m.router ? 'variable' : price(m.inputPrice) + ' / ' + price(m.outputPrice);
            li.append(name, p);
            if (!blocked) {
              li.addEventListener('click', () => choose(m));
              li.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); choose(m); } });
            }
            list.appendChild(li);
          }
          if (!shown.length) { const li = document.createElement('li'); li.className = 'empty'; li.textContent = 'No models match these filters.'; list.appendChild(li); }
        }
        function open(key) {
          target = key; lastFocus = document.activeElement;
          $('picker-title').textContent = key === 'default' ? 'Default model' : STEPS.find((x) => x.key === key).label;
          $('picker').hidden = false; $('picker-overlay').hidden = false; say('picker-msg', '');
          render(); $('picker-search').focus();
          if (!models) api('GET', '/admin/api/models?vision=0&routers=1').then((m) => { models = m; render(); }).catch((e) => say('picker-msg', e.message, 'bad'));
        }
        function close() { $('picker').hidden = true; $('picker-overlay').hidden = true; if (lastFocus) lastFocus.focus(); }
        async function choose(m) {
          const model = { id: m.id, name: m.name, structuredOutputs: m.structuredOutputs };
          say('picker-msg', 'Saving…');
          try {
            await api('PUT', '/admin/api/settings', target === 'default' ? { model } : { stepModels: { [target]: model } });
            toast((target === 'default' ? 'Default model' : STEPS.find((x) => x.key === target).label) + ': ' + m.name + (m.structuredOutputs ? '' : ' (no structured outputs; JSON may be less reliable)'), m.structuredOutputs ? 'good' : 'bad');
            setTimeout(() => location.reload(), 600);
          } catch (e) { say('picker-msg', e.message, 'bad'); }
        }
        document.querySelectorAll('[data-change]').forEach((b) => b.addEventListener('click', () => open(b.dataset.change)));
        document.querySelectorAll('[data-reset]').forEach((b) => b.addEventListener('click', async () => {
          try { await api('PUT', '/admin/api/settings', { stepModels: { [b.dataset.reset]: null } }); toast('Reset to the default model.', 'good'); setTimeout(() => location.reload(), 600); }
          catch (e) { toast(e.message, 'bad'); }
        }));
        $('picker-close').addEventListener('click', close);
        $('picker-overlay').addEventListener('click', close);
        document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('picker').hidden) close(); });
        ['picker-search', 'f-free', 'f-so', 'f-routers', 'f-sort'].forEach((id) => $(id).addEventListener(id === 'picker-search' ? 'input' : 'change', render));
        if (location.hash) { const row = document.querySelector(location.hash); if (row) { row.style.outline = '2px solid var(--accent)'; row.scrollIntoView({ block: 'center' }); } }
        function renderLengths() {
          const box = $('lengths'); box.textContent = '';
          for (const n of lengths) {
            const b = document.createElement('button'); b.type = 'button'; b.className = 'chip'; b.textContent = n + ' s ×'; b.setAttribute('aria-label', 'Remove ' + n + ' seconds');
            b.addEventListener('click', () => { lengths = lengths.filter((x) => x !== n); renderLengths(); });
            box.appendChild(b);
          }
        }
        $('length-add-btn').addEventListener('click', () => {
          const n = Number($('length-add').value);
          if (!Number.isInteger(n) || n < 5 || n > 90) { say('lengths-msg', 'Enter a whole number from 5 to 90.', 'bad'); return; }
          if (!lengths.includes(n)) lengths = [...lengths, n].sort((a, b) => a - b);
          $('length-add').value = ''; say('lengths-msg', ''); renderLengths();
        });
        $('lengths-save').addEventListener('click', async () => {
          say('lengths-msg', 'Saving…');
          try { const s = await api('PUT', '/admin/api/settings', { clipLengths: lengths }); lengths = s.clipLengths; renderLengths(); say('lengths-msg', 'Saved.', 'good'); }
          catch (e) { say('lengths-msg', e.message, 'bad'); }
        });
        renderLengths();`,
      };
    },
  },
  {
    path: '/admin/prompts',
    nav: 'Prompts',
    icon: 'prompts',
    group: 'AI',
    description:
      'The instructions sent to the model. Every save is a new version you can roll back.',
    title: 'Prompts',
    render: () => ({
      body: `<section>${table(
        [['Prompt'], ['Used for'], ['Active', true], ['Versions', true]],
        listPrompts().map((p) => [
          `<a href="/admin/prompts/${h(p.key)}"><strong>${h(p.title)}</strong></a><div class="muted mono">${h(p.key)}</div>`,
          `<span class="muted">${h(p.description)}</span>`,
          p.active ? `v${p.active.version}` : '—',
          String(p.versionCount),
        ]),
      ).replace(/<td>/g, '<td class="wrap">')}</section>`,
    }),
  },
  {
    path: '/admin/prompts/:key',
    section: '/admin/prompts',
    title: 'Prompt',
    render: (c) => {
      const key = c.req.param('key') ?? '';
      const def = promptDef(key);
      if (!def)
        return {
          title: 'Prompt not found',
          body: '<p>No such prompt. <a href="/admin/prompts">All prompts</a></p>',
        };
      const versions = listVersions(key as PromptKey);
      const active = versions.find((v) => v.active);
      return {
        title: def.title,
        body: `
        <p><a href="/admin/prompts">← All prompts</a> · <span class="muted mono">${h(def.key)}</span></p>
        <p class="muted">${h(def.description)}</p>
        <p>Model: <strong>${h((serverSettings().stepModels[def.key] ?? serverSettings().model).name)}</strong>${
          serverSettings().stepModels[def.key] ? '' : ' <span class="muted">(default)</span>'
        } · <a href="/admin/ai#step-${h(def.key)}">Change</a></p>
        <section><h2>Edit (saving creates a new version and makes it live)</h2>
          <label>Placeholders (click to insert)</label>
          <div class="chips">${def.placeholders.map((p) => `<button type="button" class="chip" data-ph="${h(p.name)}" title="${h(p.description)}">{{${h(p.name)}}}</button>`).join('')}</div>
          <textarea id="body" rows="22" spellcheck="false">${h(active?.body ?? '')}</textarea>
          <div class="msg bad" id="warn"></div>
          <div class="row"><div class="grow"><label for="note">Note for this version</label><input id="note" maxlength="300" placeholder="What changed and why"></div>
            <button id="save" type="button">Save as new version</button></div>
          <div class="msg" id="msg"></div>
        </section>
        <section><h2>History</h2>
          ${table(
            [['Version'], ['Date'], ['Note'], ['Posts', true], ['Failed', true], ['']],
            versions.map((v) => [
              `v${v.version}${v.active ? ' <span class="badge">Active</span>' : ''}`,
              h(when(v.createdAt)),
              `<span class="muted">${h(v.note || '—')}</span>`,
              String(v.jobs),
              String(v.failed),
              `<button class="ghost small" type="button" data-view="${v.version}">View</button>${v.active ? '' : ` <button class="small secondary" type="button" data-activate="${v.version}">Make active</button>`}`,
            ]),
          )}
          <div id="view" hidden>
            <div class="row" style="justify-content:space-between;align-items:center;margin-top:12px"><strong id="view-title"></strong><button class="ghost small" id="view-close" type="button">Close</button></div>
            <p class="muted">+ lines are only in this version, − lines only in the active one.</p>
            <pre class="diff" id="diff"></pre>
          </div>
        </section>`,
        script: `
        const KEY = ${json(def.key)};
        const KNOWN = new Set(${json(def.placeholders.map((p) => p.name))});
        const VERSIONS = ${json(versions.map((v) => ({ version: v.version, body: v.body, active: v.active })))};
        const ACTIVE = VERSIONS.find((v) => v.active);
        function check() {
          const found = [...$('body').value.matchAll(/\\{\\{\\s*(\\w+)\\s*\\}\\}/g)].map((m) => m[1]);
          const unknown = [...new Set(found.filter((n) => !KNOWN.has(n)))];
          $('warn').textContent = unknown.length ? 'Unknown placeholder' + (unknown.length > 1 ? 's' : '') + ' (left as typed): ' + unknown.map((n) => '{{' + n + '}}').join(', ') : '';
        }
        document.querySelectorAll('[data-ph]').forEach((b) => b.addEventListener('click', () => {
          const ta = $('body'); ta.setRangeText('{{' + b.dataset.ph + '}}', ta.selectionStart, ta.selectionEnd, 'end'); ta.focus(); check();
        }));
        $('body').addEventListener('input', check);
        $('save').addEventListener('click', async () => {
          if (ACTIVE && $('body').value === ACTIVE.body) { say('msg', 'No changes to save.', 'bad'); return; }
          say('msg', 'Saving…');
          try { const r = await api('POST', '/admin/api/prompts/' + KEY, { body: $('body').value, note: $('note').value }); location.reload(); }
          catch (e) { say('msg', e.message, 'bad'); }
        });
        document.querySelectorAll('[data-activate]').forEach((b) => b.addEventListener('click', async () => {
          try { await api('POST', '/admin/api/prompts/' + KEY + '/activate', { version: Number(b.dataset.activate) }); location.reload(); }
          catch (e) { say('msg', e.message, 'bad'); }
        }));
        function lineDiff(a, b) {
          const A = a.split('\\n'), B = b.split('\\n'), n = A.length, m = B.length;
          const L = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
          for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = A[i] === B[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
          const out = []; let i = 0, j = 0;
          while (i < n && j < m) { if (A[i] === B[j]) { out.push(['same', A[i]]); i++; j++; } else if (L[i + 1][j] >= L[i][j + 1]) out.push(['del', A[i++]]); else out.push(['add', B[j++]]); }
          while (i < n) out.push(['del', A[i++]]); while (j < m) out.push(['add', B[j++]]);
          return out;
        }
        document.querySelectorAll('[data-view]').forEach((b) => b.addEventListener('click', () => {
          const v = VERSIONS.find((x) => x.version === Number(b.dataset.view));
          $('view').hidden = false;
          $('view-title').textContent = 'v' + v.version + (v.active ? ' (active)' : ' compared with active v' + (ACTIVE ? ACTIVE.version : '?'));
          const pre = $('diff'); pre.textContent = '';
          const rows = ACTIVE && !v.active ? lineDiff(ACTIVE.body, v.body) : v.body.split('\\n').map((l) => ['same', l]);
          for (const [kind, text] of rows) { const s = document.createElement('span'); s.className = kind; s.textContent = (kind === 'add' ? '+ ' : kind === 'del' ? '− ' : '  ') + text; pre.appendChild(s); }
          $('view').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }));
        $('view-close').addEventListener('click', () => { $('view').hidden = true; });
        check();`,
      };
    },
  },
  {
    path: '/admin/limits',
    nav: 'Limits & quality',
    icon: 'limits',
    group: 'System',
    description:
      'Per-user daily limits, song quality, log retention and the Spotify connection cap.',
    title: 'Limits & quality',
    render: () => {
      const s = serverSettings();
      return {
        body: `<section><div class="row">
          <div class="field"><label for="tasks">Tasks per user per day</label><input id="tasks" type="number" min="1" max="500" value="${s.dailyJobLimit}"></div>
          <div class="field"><label for="music">Music changes per user per day</label><input id="music" type="number" min="0" max="500" value="${s.dailyMusicChangeLimit}"></div>
          <div class="field"><label for="retention">Keep integration logs (days)</label><input id="retention" type="number" min="1" max="365" value="${s.logRetentionDays}"></div>
          <div class="field"><label for="cap">Spotify connections (users)</label><input id="cap" type="number" min="0" max="25" value="${s.spotifyUserCap}"></div>
          <div class="field"><label for="fit">Low song-fit threshold (0–100)</label><input id="fit" type="number" min="0" max="100" value="${s.lowFitThreshold}"></div>
          <button id="save" type="button">Save</button></div><div class="msg" id="msg"></div>
          <p class="muted">Days are UTC. Tasks count POST /jobs and retries; 0 music changes turns "Change the music" off. Spotify dev-mode apps allow only a few users; connected users keep their connection if you lower the cap. When a song from the user's history, playlists or artists fits the photos below the low-fit threshold, the post also offers a better-fitting song from any artist.</p></section>`,
        script: `
        $('save').addEventListener('click', async () => {
          say('msg', 'Saving…');
          try {
            await api('PUT', '/admin/api/settings', { dailyJobLimit: Number($('tasks').value), dailyMusicChangeLimit: Number($('music').value), logRetentionDays: Number($('retention').value), spotifyUserCap: Number($('cap').value), lowFitThreshold: Number($('fit').value) });
            say('msg', 'Saved.', 'good');
          } catch (e) { say('msg', e.message, 'bad'); }
        });`,
      };
    },
  },
  {
    path: '/admin/integrations',
    nav: 'Integrations',
    icon: 'integrations',
    group: 'System',
    description: 'Credentials for OpenRouter and Spotify, stored encrypted.',
    title: 'Integrations',
    render: () => {
      const key = openRouterKey();
      const id = spotifyClientId();
      const secret = spotifyClientSecret();
      return {
        body: `
        <section><h2>OpenRouter</h2>
          <label>API key</label><p class="mono" id="or-hint">${key ? h(keyHint(key)) : 'Not set'}</p>
          <div class="row"><div class="grow"><input id="or-key" type="password" placeholder="sk-or-…" autocomplete="off"></div>
            <button id="or-save" type="button">Replace</button><button class="secondary" id="or-test" type="button">Test</button></div>
          <div class="msg" id="or-msg"></div>
        </section>
        <section><h2>Spotify</h2>
          <div class="row"><div class="grow"><label for="sp-id">Client ID</label><input id="sp-id" class="mono" value="${h(id ?? '')}" autocomplete="off" spellcheck="false"></div></div>
          <label style="margin-top:12px">Client secret</label><p class="mono" id="sp-hint">${secret ? h(secretHint(secret)) : 'Not set'}</p>
          <div class="row"><div class="grow"><input id="sp-secret" type="password" placeholder="New client secret (leave empty to keep)" autocomplete="off"></div>
            <button id="sp-save" type="button">Replace</button><button class="secondary" id="sp-test" type="button">Test</button></div>
          <div class="msg" id="sp-msg"></div>
          <p class="muted">If you ever switch to a different Spotify app, it needs the same redirect address (postitup://spotify-callback) and bundle ID (${config.appBundleId ? h(config.appBundleId) : 'your app’s bundle ID'}) in Spotify's dashboard, and signed-in users need to reconnect Spotify.</p>
        </section>`,
        script: `
        async function test(ids, msgId) {
          say(msgId, 'Testing…');
          try {
            const r = await api('POST', '/admin/api/checks/run', { checks: ids });
            const bad = r.filter((x) => !x.ok);
            say(msgId, bad.length ? bad.map((x) => x.label + ': ' + x.error).join(' · ') : r.map((x) => x.detail).join(' · '), bad.length ? 'bad' : 'good');
          } catch (e) { say(msgId, e.message, 'bad'); }
        }
        $('or-test').addEventListener('click', () => test(['openrouter_key'], 'or-msg'));
        $('sp-test').addEventListener('click', () => test(['spotify_app', 'spotify_search'], 'sp-msg'));
        $('or-save').addEventListener('click', async () => {
          const key = $('or-key').value.trim(); if (!key) { say('or-msg', 'Paste a key first.', 'bad'); return; }
          say('or-msg', 'Checking with OpenRouter…');
          try { const r = await api('PUT', '/admin/api/integrations/openrouter', { key }); $('or-key').value = ''; $('or-hint').textContent = r.openrouter.hint; say('or-msg', 'Key saved.', 'good'); }
          catch (e) { say('or-msg', e.message, 'bad'); }
        });
        $('sp-save').addEventListener('click', async () => {
          const body = {}; const id = $('sp-id').value.trim(); const secret = $('sp-secret').value.trim();
          if (id) body.clientId = id; if (secret) body.clientSecret = secret;
          say('sp-msg', 'Checking with Spotify…');
          try { const r = await api('PUT', '/admin/api/integrations/spotify', body); $('sp-secret').value = ''; $('sp-hint').textContent = r.spotify.secretSet ? r.spotify.secretHint : 'Not set'; say('sp-msg', 'Saved. Spotify accepted the credentials.', 'good'); }
          catch (e) { say('sp-msg', e.message, 'bad'); }
        });`,
      };
    },
  },
  {
    path: '/admin/users',
    nav: 'Users',
    icon: 'users',
    group: 'People',
    description: 'Everyone who has signed in, with their activity and AI spend.',
    title: 'Users',
    render: () => {
      const users = usersList();
      const owner = serverSettings().spotifyOwnerUserId;
      return {
        body: `<section>${table(
          [
            ['User'],
            ['Joined'],
            ['Spotify'],
            ['Tasks today', true],
            ['Tasks total', true],
            ['AI spend', true],
            ['Spotify owner'],
          ],
          users.map((u) => [
            `${u.name ? `${h(u.name)} · ` : ''}${h(u.email)}`,
            h(when(u.createdAt).slice(0, 10)),
            u.spotify
              ? `${pill('ok', 'Connected')} <button class="danger small" type="button" data-disconnect="${h(u.id)}" data-email="${h(u.email)}">Disconnect</button>`
              : '—',
            String(u.postsToday),
            String(u.postsTotal),
            h(usd(u.spendUsd, 4)),
            owner === u.id
              ? '<span class="badge">Owner</span> <button class="ghost small" type="button" data-owner="">Clear</button>'
              : `<button class="ghost small" type="button" data-owner="${h(u.id)}">Make owner</button>`,
          ]),
          'No users yet.',
        )}<p class="muted">Spotify: ${spotifyConnectedCount()} of ${serverSettings().spotifyUserCap} connected (cap set on <a href="/admin/limits">Limits</a>). The Spotify owner is the account that owns the Spotify app and can connect without a request.</p><div class="msg" id="msg"></div></section>`,
        script: `
        document.querySelectorAll('[data-disconnect]').forEach((b) => b.addEventListener('click', async () => {
          if (!confirm('Disconnect Spotify for ' + b.dataset.email + '? They can connect again if a slot is free.')) return;
          try { await api('POST', '/admin/api/users/' + b.dataset.disconnect + '/spotify/disconnect', {}); location.reload(); }
          catch (e) { say('msg', e.message, 'bad'); }
        }));
        document.querySelectorAll('[data-owner]').forEach((b) => b.addEventListener('click', async () => {
          try { await api('PUT', '/admin/api/settings', { spotifyOwnerUserId: b.dataset.owner || null }); location.reload(); }
          catch (e) { say('msg', e.message, 'bad'); }
        }));`,
      };
    },
  },
  {
    path: '/admin/spotify-access',
    nav: 'Spotify access',
    icon: 'music',
    group: 'People',
    description:
      'Requests to use Spotify. Add the email in Spotify’s dashboard, then mark it as added.',
    title: 'Spotify access',
    badge: pendingSpotifyRequests,
    render: () => {
      const items = spotifyAccessList();
      const s = serverSettings();
      const clientId = spotifyClientId();
      const dash = clientId
        ? `https://developer.spotify.com/dashboard/${encodeURIComponent(clientId)}/users`
        : '';
      const isOwner = (i: (typeof items)[number]) => s.spotifyOwnerUserId === i.userId;
      const pending = items.filter(
        (i) => i.access.status === 'requested' && !i.connected && !isOwner(i),
      );
      const approved = items.filter(
        (i) => i.access.status === 'approved' || i.connected || isOwner(i),
      );
      const declined = items.filter((i) => i.access.status === 'declined');
      const who = (i: (typeof items)[number]) =>
        `${i.name ? `${h(i.name)}<br>` : ''}<span class="muted">${h(i.email)}</span>`;
      const spEmail = (i: (typeof items)[number]) =>
        'spotifyEmail' in i.access && i.access.spotifyEmail
          ? `<span class="mono">${h(i.access.spotifyEmail)}</span> <button class="ghost small" type="button" data-copy="${h(i.access.spotifyEmail)}">Copy</button>`
          : '—';
      return {
        body: `
        <p><strong>${spotifySlotsUsed()} of ${s.spotifyUserCap}</strong> slots used (connected, approved or waiting). ${
          dash
            ? `<a href="${h(dash)}" target="_blank" rel="noopener noreferrer">Open User Management in Spotify's dashboard ↗</a>`
            : '<span class="muted">Set the Spotify client ID on <a href="/admin/integrations">Integrations</a> to get the dashboard link.</span>'
        }</p>
        <p class="muted">To approve: copy the Spotify email, add it in Spotify's dashboard (User Management), then press Mark as added. The user gets a push.</p>
        <section><h2>Waiting (${pending.length})</h2>${table(
          [['App user'], ['Spotify email'], ['Requested'], ['']],
          pending.map((i) => [
            who(i),
            spEmail(i),
            `${pill('pending', 'Waiting')} <span class="muted">${h(when('at' in i.access ? i.access.at : 0))}</span>`,
            `<button class="small" type="button" data-approve="${h(i.userId)}">Mark as added</button> <button class="ghost small" type="button" data-decline="${h(i.userId)}">Decline</button>`,
          ]),
          'No requests waiting.',
        )}</section>
        <section><h2>Approved (${approved.length})</h2>${table(
          [['App user'], ['Spotify email'], ['Since'], ['Connected'], ['']],
          approved.map((i) => [
            who(i) + (s.spotifyOwnerUserId === i.userId ? ' <span class="badge">Owner</span>' : ''),
            spEmail(i),
            h(when('at' in i.access ? i.access.at : 0)),
            i.connected ? pill('ok', 'Connected') : pill('pending', 'Not yet'),
            `<button class="danger small" type="button" data-revoke="${h(i.userId)}" data-email="${h(i.email)}">Revoke</button>`,
          ]),
          'Nobody yet.',
        )}<p class="muted">Revoking disconnects their Spotify here. Also remove them in Spotify's dashboard.</p></section>
        ${
          declined.length
            ? `<section><h2>Declined (${declined.length})</h2>${table(
                [['App user'], ['When'], ['Note']],
                declined.map((i) => [
                  who(i),
                  h(when('at' in i.access ? i.access.at : 0)),
                  h(i.access.status === 'declined' ? (i.access.note ?? '—') : '—'),
                ]),
              )}</section>`
            : ''
        }
        <div class="msg" id="msg"></div>`,
        script: `
        document.querySelectorAll('[data-copy]').forEach((b) => b.addEventListener('click', async () => {
          try { await navigator.clipboard.writeText(b.dataset.copy); b.textContent = 'Copied'; setTimeout(() => { b.textContent = 'Copy'; }, 1500); }
          catch { say('msg', 'Copy failed; select the email and copy it by hand.', 'bad'); }
        }));
        const act = (attr, path, body) => document.querySelectorAll('[' + attr + ']').forEach((b) => b.addEventListener('click', async () => {
          const id = b.getAttribute(attr);
          let payload = body;
          if (attr === 'data-decline') { const note = prompt('Optional note for the user (why it was declined):', ''); if (note === null) return; payload = note ? { note } : {}; }
          if (attr === 'data-revoke' && !confirm('Revoke Spotify access for ' + b.dataset.email + '? This disconnects their Spotify here; also remove them in Spotify\'s dashboard.')) return;
          try { await api('POST', '/admin/api/spotify-access/' + id + '/' + path, payload); location.reload(); }
          catch (e) { say('msg', e.message, 'bad'); }
        }));
        act('data-approve', 'approve', {}); act('data-decline', 'decline', {}); act('data-revoke', 'revoke', {});`,
      };
    },
  },
  {
    path: '/admin/logs',
    nav: 'Logs',
    icon: 'logs',
    group: 'System',
    description:
      'Every call to OpenRouter, Spotify, LRCLIB, ntfy and Google. No secrets or content are stored.',
    title: 'Integration logs',
    render: (c) => {
      const q = (n: string) => c.req.query(n) || undefined;
      const qs = (n: string) => c.req.queries(n);
      const filter = logFilterFrom(q, qs);
      const { rows, nextCursor } = queryLogs(filter);
      const selected = new Set(filter.integrations ?? []);
      const params = new URLSearchParams(c.req.url.split('?')[1] ?? '');
      params.delete('cursor');
      const nextUrl = nextCursor
        ? `/admin/logs?${new URLSearchParams([...params, ['cursor', nextCursor]]).toString()}`
        : '';
      const dateVal = (v?: string) => (v && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : '');
      return {
        body: `
        <section><form method="get" action="/admin/logs">
          <div class="row">
            <div class="field"><label>Integration</label><div class="chips">${INTEGRATIONS.map(
              (i) =>
                `<label class="chip"><input type="checkbox" name="integration" value="${i}"${selected.has(i) ? ' checked' : ''}>${i}</label>`,
            ).join('')}</div></div>
          </div>
          <div class="row">
            <div class="field"><label for="f-user">User email</label><input id="f-user" name="user" value="${h(q('user') ?? '')}"></div>
            <div class="field"><label for="f-op">Operation</label><input id="f-op" name="operation" value="${h(q('operation') ?? '')}"></div>
            <div class="field"><label for="f-job">Task id</label><input id="f-job" name="job" class="mono" value="${h(q('job') ?? '')}"></div>
          </div>
          <div class="row" style="margin-top:8px">
            <div class="field"><label for="f-ok">Result</label>
              <select id="f-ok" name="ok">
                ${[
                  ['', 'All'],
                  ['ok', 'OK'],
                  ['failed', 'Failed'],
                ]
                  .map(
                    ([v, l]) =>
                      `<option value="${v}"${(q('ok') ?? '') === v ? ' selected' : ''}>${l}</option>`,
                  )
                  .join('')}
              </select></div>
            <div class="field"><label for="f-from">From</label><input id="f-from" name="from" type="date" value="${h(dateVal(q('from')))}"></div>
            <div class="field"><label for="f-to">To</label><input id="f-to" name="to" type="date" value="${h(dateVal(q('to')))}"></div>
            <button type="submit">Filter</button> <a class="button ghost" href="/admin/logs">Clear</a>
          </div>
        </form></section>
        <section>${table(
          [
            ['Time'],
            ['Integration'],
            ['Operation'],
            ['User'],
            ['Task'],
            ['Status', true],
            ['Result'],
            ['ms', true],
            ['Cost', true],
          ],
          rows.map((r) => [
            `<a href="#" data-row="${h(r.id)}">${h(when(r.at).slice(5, 16))}</a>`,
            h(r.integration),
            `<span class="mono">${h(r.operation)}</span>${r.model ? `<div class="muted">${h(r.model)}</div>` : ''}`,
            h(r.userEmail ?? '—'),
            r.jobId
              ? `<a class="mono" href="/admin/logs?job=${h(r.jobId)}">${h(r.jobId.slice(0, 8))}</a>`
              : '—',
            r.statusCode === null ? '—' : String(r.statusCode),
            r.ok ? pill('ok', 'OK') : pill('bad', 'Failed'),
            String(r.durationMs),
            r.costUsd === null ? '' : h(usd(r.costUsd, 4)),
          ]),
          'No calls match these filters.',
        )}
        <div class="row" style="margin-top:12px;justify-content:space-between">
          <button class="ghost" type="button" id="prev"${params.has('cursor') || c.req.query('cursor') ? '' : ' disabled'}>← Newer</button>
          ${nextUrl ? `<a class="button ghost" href="${h(nextUrl)}">Older →</a>` : '<span class="muted">End of results</span>'}
        </div>
        <div id="detail" hidden><h2 style="margin-top:20px">Call detail</h2><pre class="diff" id="detail-body"></pre></div>
        </section>`,
        script: `
        const ROWS = ${json(rows)};
        document.querySelectorAll('[data-row]').forEach((a) => a.addEventListener('click', (e) => {
          e.preventDefault();
          const r = ROWS.find((x) => x.id === a.dataset.row);
          $('detail').hidden = false;
          $('detail-body').textContent = JSON.stringify({ ...r, at: new Date(r.at).toISOString() }, null, 2);
          $('detail').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }));
        $('prev').addEventListener('click', () => history.back());`,
      };
    },
  },
  {
    path: '/admin/status',
    nav: 'Status',
    icon: 'status',
    group: 'System',
    description: 'Run live checks against each integration.',
    title: 'Status',
    render: () => {
      const results = new Map((lastRun?.results ?? []).map((r) => [r.id, r]));
      const up = Math.round((Date.now() - STARTED) / 1000);
      const uptime =
        up < 3600
          ? `${Math.floor(up / 60)} min`
          : up < 86400
            ? `${(up / 3600).toFixed(1)} h`
            : `${(up / 86400).toFixed(1)} days`;
      return {
        body: `
        <section><h2>Server</h2><p>Version <strong>${h(config.version)}</strong> · up ${h(uptime)} · Node ${h(process.version)}</p></section>
        <section><h2>Checks</h2>
          <div class="row" style="justify-content:space-between;align-items:center"><span class="muted" id="last">${lastRun ? `Last run ${h(when(lastRun.at))}` : 'Not run yet.'}</span><button id="run-all" type="button">Run all checks</button></div>
          ${table(
            [['Check'], ['Result'], ['ms', true], ['']],
            CHECKS.map((ch) => {
              const r = results.get(ch.id);
              return [
                h(ch.label),
                `<span id="r-${ch.id}">${r ? `<span class="dot ${r.ok ? 'ok' : 'bad'}"></span>${h(r.ok ? (r.detail ?? 'OK') : (r.error ?? 'Failed'))}` : '<span class="muted">Not run</span>'}</span>`,
                `<span id="d-${ch.id}">${r ? r.durationMs : ''}</span>`,
                `<button class="ghost small" type="button" data-check="${ch.id}">Run</button>`,
              ];
            }),
          ).replace(/<td>(<span id="r-)/g, '<td class="wrap">$1')}
          <p class="muted">Checks are logged as <span class="mono">check:*</span> operations in <a href="/admin/logs?operation=check%3A">Logs</a>. The ntfy check publishes to a throwaway topic.</p>
        </section>`,
        script: `
        function show(r) {
          const el = $('r-' + r.id); el.textContent = '';
          const dot = document.createElement('span'); dot.className = 'dot ' + (r.ok ? 'ok' : 'bad'); el.appendChild(dot);
          el.appendChild(document.createTextNode(r.ok ? (r.detail || 'OK') : (r.error || 'Failed')));
          $('d-' + r.id).textContent = r.durationMs;
        }
        async function run(ids) {
          ids.forEach((id) => { $('r-' + id).textContent = 'Running…'; });
          try { (await api('POST', '/admin/api/checks/run', ids.length === ${CHECKS.length} ? {} : { checks: ids })).forEach(show); $('last').textContent = 'Last run ' + new Date().toISOString().replace('T', ' ').slice(0, 16) + ' UTC'; }
          catch (e) { ids.forEach((id) => { $('r-' + id).textContent = e.message; }); }
        }
        $('run-all').addEventListener('click', () => run(${json(CHECKS.map((ch) => ch.id))}));
        document.querySelectorAll('[data-check]').forEach((b) => b.addEventListener('click', () => run([b.dataset.check])));`,
      };
    },
  },
  {
    path: '/admin/account',
    nav: 'Admin account',
    icon: 'account',
    bottom: true,
    description: 'Your admin sign-in and password.',
    title: 'Admin account',
    render: (c) => {
      const a = accountView();
      if (!a) return { body: '<p>No admin account.</p>' };
      const ip = (v: string | null) => h(v ?? '—');
      void c;
      return {
        body: `
        <section><h2>Account</h2>
          <p>Username <strong>${h(a.username)}</strong> · password changed ${h(when(a.updatedAt))}</p>
          <p class="muted">This sign-in: ${h(when(a.lastLoginAt))} from ${ip(a.lastLoginIp)}<br>Previous sign-in: ${h(when(a.previousLoginAt))} from ${ip(a.previousLoginIp)}</p>
          ${a.weakPassword ? '<p class="callout">The password is shorter than 12 characters. Please change it.</p>' : ''}
        </section>
        <section><h2>Change password</h2>
          <form id="pw" style="max-width:420px">
            <input type="text" name="username" autocomplete="username" value="${h(a.username)}" hidden>
            <label for="cur">Current password</label><input id="cur" type="password" autocomplete="current-password" required>
            <label for="new" style="margin-top:12px">New password (at least 10 characters)</label><input id="new" type="password" autocomplete="new-password" minlength="10" required>
            <label for="new2" style="margin-top:12px">New password again</label><input id="new2" type="password" autocomplete="new-password" minlength="10" required>
            <p></p><button type="submit">Change password</button>
            <div class="msg" id="msg"></div>
            <p class="muted">Other signed-in admin sessions are signed out.</p>
          </form>
        </section>`,
        script: `
        $('pw').addEventListener('submit', async (e) => {
          e.preventDefault();
          if ($('new').value !== $('new2').value) { say('msg', 'The new passwords don’t match.', 'bad'); return; }
          say('msg', 'Saving…');
          try { await api('POST', '/admin/api/account/password', { currentPassword: $('cur').value, newPassword: $('new').value });
            $('cur').value = $('new').value = $('new2').value = ''; say('msg', 'Password changed.', 'good'); }
          catch (err) { say('msg', err.message, 'bad'); }
        });`,
      };
    },
  },
];

/** Sidebar order (groups: Overview; AI; People; System; Admin account at the bottom). */
const NAV_ORDER = [
  '/admin',
  '/admin/ai-usage',
  '/admin/ai',
  '/admin/prompts',
  '/admin/users',
  '/admin/spotify-access',
  '/admin/integrations',
  '/admin/limits',
  '/admin/status',
  '/admin/logs',
  '/admin/account',
];

export const navItems = (): NavItem[] =>
  PAGES.filter((p) => p.nav)
    .sort((a, b) => NAV_ORDER.indexOf(a.path) - NAV_ORDER.indexOf(b.path))
    .map((p) => ({
      path: p.path,
      label: p.nav!,
      icon: p.icon ?? 'overview',
      ...(p.group ? { group: p.group } : {}),
      ...(p.bottom ? { bottom: true } : {}),
      ...(p.badge ? { badge: p.badge() } : {}),
    }));
