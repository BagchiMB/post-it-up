/**
 * Shared layout for the admin site: design tokens + components (one inline stylesheet), the
 * grouped sidebar built from the page registry, inline SVG icons, and a tiny JS helper.
 */

export const h = (v: string | number | bigint | boolean | null | undefined) =>
  String(v ?? '').replace(
    /[&<>"']/g,
    (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!,
  );

export const usd = (n: number | null | undefined, digits = 2) =>
  typeof n === 'number' ? `$${n < 0.01 && n > 0 ? n.toFixed(4) : n.toFixed(digits)}` : '—';

export const when = (ms: number | null | undefined) =>
  ms ? new Date(ms).toISOString().replace('T', ' ').slice(0, 16) + ' UTC' : '—';

/** Status pill: ok / warn / bad / pending / neutral. */
export const pill = (kind: 'ok' | 'warn' | 'bad' | 'pending' | 'neutral', text: string) =>
  `<span class="pill ${kind}">${h(text)}</span>`;

// ---------------------------------------------------------------------------
// Icons: 16px line icons, stroke = currentColor.

const ICON_PATHS: Record<string, string> = {
  overview:
    '<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>',
  usage: '<path d="M4 20V10"/><path d="M10 20V4"/><path d="M16 20v-7"/><path d="M22 20H2"/>',
  ai: '<path d="M4 6h10"/><path d="M18 6h2"/><circle cx="16" cy="6" r="2"/><path d="M4 12h4"/><path d="M12 12h8"/><circle cx="10" cy="12" r="2"/><path d="M4 18h12"/><path d="M20 18h0"/><circle cx="18" cy="18" r="2"/>',
  prompts:
    '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M9 13h6"/><path d="M9 17h4"/>',
  users:
    '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7"/><path d="M18.5 14.5a6.5 6.5 0 0 1 3 5.5"/>',
  music: '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>',
  integrations:
    '<path d="M9 7V3"/><path d="M15 7V3"/><path d="M6 7h12v4a6 6 0 0 1-12 0z"/><path d="M12 17v4"/>',
  limits: '<circle cx="12" cy="13" r="8"/><path d="M12 13l3.5-3.5"/><path d="M9 2h6"/>',
  status: '<path d="M3 12h4l3-8 4 16 3-8h4"/>',
  logs: '<path d="M8 6h13"/><path d="M8 12h13"/><path d="M8 18h13"/><circle cx="3.5" cy="6" r="1"/><circle cx="3.5" cy="12" r="1"/><circle cx="3.5" cy="18" r="1"/>',
  account: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  signout:
    '<path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3"/><path d="M10 17l-5-5 5-5"/><path d="M5 12h12"/>',
  menu: '<path d="M4 6h16"/><path d="M4 12h16"/><path d="M4 18h16"/>',
  close: '<path d="M6 6l12 12"/><path d="M18 6L6 18"/>',
};

export const icon = (name: string, size = 16) =>
  `<svg class="icon" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${ICON_PATHS[name] ?? ''}</svg>`;

// ---------------------------------------------------------------------------

const CSS = `
:root {
  --bg:#F6F7FB; --surface:#FFFFFF; --surface-2:#F1F3F9; --border:#E4E7EF; --text:#0F172A; --muted:#5B6A80;
  --accent:#4F46E5; --accent-hover:#4338CA; --accent-soft:#EEF0FF; --on-accent:#FFFFFF;
  --success:#047857; --success-icon:#059669; --success-soft:#E7F7F1; --warning:#B45309; --warning-icon:#D97706; --warning-soft:#FEF5E7; --danger:#BE123C; --danger-icon:#E11D48; --danger-soft:#FDECF0;
  --shadow: 0 1px 2px rgba(15,23,42,.04), 0 4px 16px rgba(15,23,42,.04);
  --radius:14px; --radius-sm:10px;
  color-scheme: light dark;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg:#0B0D14; --surface:#12151F; --surface-2:#181C28; --border:#262B3A; --text:#E7E9F2; --muted:#8A93A8;
    --accent:#818CF8; --accent-hover:#A5B4FC; --accent-soft:rgba(129,140,248,.14); --on-accent:#0B0D14;
    --success:#34D399; --success-icon:#34D399; --success-soft:rgba(52,211,153,.14); --warning:#FBBF24; --warning-icon:#FBBF24; --warning-soft:rgba(251,191,36,.14);
    --danger:#FB7185; --danger-icon:#FB7185; --danger-soft:rgba(251,113,133,.14);
    --shadow: 0 1px 2px rgba(0,0,0,.3), 0 4px 16px rgba(0,0,0,.2);
  }
}
* { box-sizing: border-box; }
html, body { margin: 0; background: var(--bg); color: var(--text); }
body { font: 14px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; -webkit-font-smoothing: antialiased; }
a { color: var(--accent); text-decoration: none; }
a:hover { color: var(--accent-hover); text-decoration: underline; }
:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; border-radius: 6px; }
.icon { flex: none; display: block; }

/* Shell */
.shell { display: grid; grid-template-columns: 240px minmax(0, 1fr); min-height: 100vh; }
.sidebar { position: sticky; top: 0; height: 100vh; overflow-y: auto; background: var(--surface); border-right: 1px solid var(--border);
  display: flex; flex-direction: column; padding: 18px 12px; gap: 4px; }
.brand { display: flex; align-items: baseline; gap: 8px; padding: 4px 10px 14px; }
.brand strong { font-size: 16px; letter-spacing: -0.01em; }
.brand span { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: .08em; color: var(--muted);
  border: 1px solid var(--border); border-radius: 999px; padding: 1px 7px; }
.nav-group { margin-top: 14px; padding: 0 10px 6px; font-size: 11px; font-weight: 600; letter-spacing: .08em; text-transform: uppercase; color: var(--muted); }
.nav a, .nav button { display: flex; align-items: center; gap: 10px; width: 100%; height: 36px; padding: 0 10px; border-radius: var(--radius-sm);
  color: var(--text); font: inherit; font-weight: 500; background: none; border: 0; cursor: pointer; text-decoration: none; text-align: left; justify-content: flex-start; }
.nav a .icon, .nav button .icon { color: var(--muted); }
.nav a:hover, .nav button:hover { background: var(--surface-2); text-decoration: none; color: var(--text); }
.nav a[aria-current="page"] { background: var(--accent-soft); color: var(--accent); font-weight: 600; }
.nav a[aria-current="page"] .icon { color: var(--accent); }
.nav .count { margin-left: auto; min-width: 20px; height: 20px; padding: 0 6px; border-radius: 999px; background: var(--accent); color: var(--on-accent);
  font-size: 11px; font-weight: 700; display: inline-flex; align-items: center; justify-content: center; }
.nav-bottom { margin-top: auto; padding-top: 12px; border-top: 1px solid var(--border); }
.topbar { display: none; }
.overlay { display: none; }
.content { min-width: 0; padding: 32px 40px 72px; }
.content-inner { max-width: 1100px; margin: 0 auto; }
.page-head { margin-bottom: 24px; }
.page-head h1 { font-size: 24px; line-height: 1.25; margin: 0; letter-spacing: -0.02em; }
.page-head p { margin: 6px 0 0; color: var(--muted); }

@media (max-width: 899px) {
  .shell { grid-template-columns: minmax(0, 1fr); }
  .sidebar { position: fixed; z-index: 30; left: 0; top: 0; bottom: 0; width: 260px; height: auto; transform: translateX(-100%);
    transition: transform .2s ease; box-shadow: 0 10px 40px rgba(0,0,0,.25); visibility: hidden; }
  body.drawer-open .sidebar { transform: none; visibility: visible; }
  body.drawer-open .overlay { display: block; position: fixed; inset: 0; z-index: 20; background: rgba(15,23,42,.45); }
  .topbar { display: flex; align-items: center; gap: 10px; position: sticky; top: 0; z-index: 10; height: 52px; padding: 0 12px;
    background: var(--surface); border-bottom: 1px solid var(--border); }
  .topbar strong { font-size: 15px; }
  .content { padding: 20px 16px 56px; }
  .page-head h1 { font-size: 21px; }
}
@media (prefers-reduced-motion: reduce) { .sidebar { transition: none; } }

/* Sections & cards */
section, .card { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); box-shadow: var(--shadow); }
section { padding: 20px 22px; margin: 0 0 18px; }
@media (max-width: 899px) { section { padding: 16px; } }
section > h2, .section-title { font-size: 13px; font-weight: 600; margin: 0 0 14px; color: var(--text); letter-spacing: 0; }
section > p:last-child { margin-bottom: 0; }
.cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 14px; margin: 0 0 18px; }
.cards .card { padding: 16px 18px; }
section .cards { margin-bottom: 0; }
section .card { box-shadow: none; background: var(--surface); }
.card .label { font-size: 12px; font-weight: 500; color: var(--muted); }
.big { font-size: 28px; font-weight: 700; letter-spacing: -0.02em; line-height: 1.2; margin-top: 6px; font-variant-numeric: tabular-nums; }
.card .muted { margin-top: 4px; }
.muted { color: var(--muted); font-size: 13px; }
.mono { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12.5px; }
.stack > * + * { margin-top: 10px; }

/* Forms */
label { display: block; font-size: 13px; font-weight: 500; color: var(--text); margin: 0 0 6px; }
input, select, textarea { font: inherit; color: var(--text); background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-sm);
  padding: 0 12px; width: 100%; height: 40px; transition: border-color .15s, box-shadow .15s; }
textarea { height: auto; padding: 10px 12px; font: 13px/1.55 ui-monospace, SFMono-Regular, Menlo, monospace; resize: vertical; }
input[type="checkbox"] { width: 16px; height: 16px; padding: 0; accent-color: var(--accent); }
input:focus, select:focus, textarea:focus { outline: none; border-color: var(--accent); box-shadow: 0 0 0 4px var(--accent-soft); }
input:disabled, textarea:disabled { opacity: .6; }
.row { display: flex; gap: 12px; align-items: flex-end; flex-wrap: wrap; }
.row + .row { margin-top: 12px; }
.row > .grow { flex: 1 1 240px; }
.field { flex: 1 1 180px; }

/* Buttons */
button, .button { font: inherit; font-weight: 600; height: 36px; padding: 0 14px; border-radius: var(--radius-sm); cursor: pointer; white-space: nowrap;
  display: inline-flex; align-items: center; justify-content: center; gap: 8px; text-decoration: none;
  color: var(--on-accent); background: var(--accent); border: 1px solid var(--accent); transition: background .15s, border-color .15s; }
button:hover, .button:hover { background: var(--accent-hover); border-color: var(--accent-hover); color: var(--on-accent); text-decoration: none; }
button.secondary, .button.secondary { color: var(--text); background: var(--surface-2); border-color: var(--border); }
button.secondary:hover, .button.secondary:hover { background: var(--border); border-color: var(--border); color: var(--text); }
button.ghost, .button.ghost { color: var(--text); background: transparent; border-color: var(--border); }
button.ghost:hover, .button.ghost:hover { background: var(--surface-2); color: var(--text); }
button.danger, .button.danger { color: var(--danger); background: var(--danger-soft); border-color: transparent; }
button.danger:hover { background: var(--danger); color: #fff; }
button.small, .button.small { height: 28px; padding: 0 10px; font-size: 12.5px; border-radius: 8px; }
button:disabled { opacity: .5; cursor: default; }
.icon-btn { width: 36px; padding: 0; color: var(--text); background: transparent; border-color: transparent; }
.icon-btn:hover { background: var(--surface-2); color: var(--text); border-color: transparent; }

/* Pills, dots, chips */
.pill { display: inline-flex; align-items: center; gap: 6px; height: 22px; padding: 0 9px; border-radius: 999px; font-size: 12px; font-weight: 600; white-space: nowrap; }
.pill::before { content: ""; width: 6px; height: 6px; border-radius: 50%; background: currentColor; }
.pill.ok { color: var(--success); background: var(--success-soft); }
.pill.warn { color: var(--warning); background: var(--warning-soft); }
.pill.bad { color: var(--danger); background: var(--danger-soft); }
.pill.pending { color: var(--accent); background: var(--accent-soft); }
.pill.neutral { color: var(--muted); background: var(--surface-2); }
.pill.neutral::before { display: none; }
.badge { display: inline-flex; align-items: center; height: 20px; padding: 0 8px; border-radius: 999px; font-size: 11px; font-weight: 700;
  color: var(--accent); background: var(--accent-soft); letter-spacing: .02em; }
.dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: var(--muted); margin-right: 8px; vertical-align: 1px; }
.dot.ok { background: var(--success-icon); } .dot.bad { background: var(--danger-icon); } .dot.warn { background: var(--warning-icon); }
.chips { display: flex; gap: 6px; flex-wrap: wrap; margin: 4px 0 12px; }
.chip { display: inline-flex; align-items: center; gap: 6px; height: 28px; padding: 0 10px; border-radius: 999px; font: 500 12.5px/1 ui-monospace, SFMono-Regular, Menlo, monospace;
  color: var(--text); background: var(--surface-2); border: 1px solid var(--border); cursor: pointer; }
.chip:hover { background: var(--accent-soft); color: var(--accent); border-color: transparent; }
label.chip { margin: 0; font-family: inherit; font-size: 13px; }

/* Messages */
.msg { font-size: 13px; min-height: 1.4em; margin-top: 10px; color: var(--muted); }
.msg.bad { color: var(--danger); } .msg.good { color: var(--success); }
.callout { padding: 12px 14px; border-radius: var(--radius-sm); background: var(--warning-soft); color: var(--warning); font-size: 13px; }
.empty { padding: 28px 12px; text-align: center; color: var(--muted); font-size: 13px; }

/* Tables */
.table-wrap { overflow: auto; max-height: 72vh; margin: 0 -22px; padding: 0 22px; }
@media (max-width: 899px) { .table-wrap { margin: 0 -16px; padding: 0 16px; } }
table { border-collapse: separate; border-spacing: 0; width: 100%; font-size: 13.5px; }
th, td { text-align: left; padding: 10px 12px; border-bottom: 1px solid var(--border); white-space: nowrap; vertical-align: middle; }
th { position: sticky; top: 0; z-index: 1; background: var(--surface); font-size: 12px; font-weight: 600; color: var(--muted); }
tbody tr:hover td { background: var(--surface-2); }
tbody tr:last-child td { border-bottom: 0; }
td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
td.wrap { white-space: normal; min-width: 160px; }
td .actions, .actions { display: flex; gap: 6px; justify-content: flex-end; flex-wrap: wrap; }

/* Lists (model picker) */
.list { list-style: none; margin: 10px 0 0; padding: 4px; border: 1px solid var(--border); border-radius: var(--radius-sm); max-height: 380px; overflow-y: auto; background: var(--surface); }
.list li { padding: 9px 10px; border-radius: 8px; display: flex; justify-content: space-between; gap: 12px; }
.list li.pick { cursor: pointer; }
.list li.pick:hover, .list li.pick:focus-visible { background: var(--surface-2); outline: none; }
.list li.sel { background: var(--accent-soft); color: var(--accent); }
.list li.sel .muted { color: var(--accent); opacity: .8; }
.list .name { min-width: 0; overflow-wrap: anywhere; font-weight: 500; }

/* Diff, detail */
pre.diff { font: 12px/1.6 ui-monospace, SFMono-Regular, Menlo, monospace; background: var(--surface-2); border: 1px solid var(--border);
  border-radius: var(--radius-sm); padding: 12px; margin: 10px 0 0; white-space: pre-wrap; overflow-wrap: anywhere; }
pre.diff .add { background: var(--success-soft); color: var(--success); display: block; }
pre.diff .del { background: var(--danger-soft); color: var(--danger); display: block; text-decoration: line-through; }
pre.diff .same { display: block; }

/* Chart */
.chart { width: 100%; height: auto; display: block; }
.chart rect.bar { fill: var(--accent); }
.chart rect.bar:hover { fill: var(--accent-hover); }
.chart text { fill: var(--muted); font-size: 10.5px; font-family: inherit; }
.chart line { stroke: var(--border); }

/* Toasts */
.toasts { position: fixed; z-index: 50; right: 20px; bottom: 20px; display: flex; flex-direction: column; gap: 8px; max-width: min(380px, calc(100vw - 32px)); }
.toast { display: flex; gap: 10px; align-items: flex-start; padding: 12px 14px; border-radius: 12px; background: var(--surface); color: var(--text);
  border: 1px solid var(--border); box-shadow: 0 8px 30px rgba(15,23,42,.16); font-size: 13.5px; animation: toast-in .18s ease-out; }
.toast::before { content: ""; flex: none; width: 8px; height: 8px; margin-top: 6px; border-radius: 50%; background: var(--success); }
.toast.bad::before { background: var(--danger); }
@keyframes toast-in { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
@media (max-width: 899px) { .toasts { left: 16px; right: 16px; bottom: 16px; max-width: none; } }

/* Login */
.login-wrap { min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 24px 16px; }
.login { width: 100%; max-width: 380px; background: var(--surface); border: 1px solid var(--border); border-radius: 18px; box-shadow: var(--shadow); padding: 28px; }
.login .brand { padding: 0 0 6px; }
.login h1 { font-size: 20px; margin: 0 0 4px; letter-spacing: -0.01em; }
.login p.sub { margin: 0 0 20px; color: var(--muted); }
.login label { margin-top: 14px; }
.login button { width: 100%; height: 40px; margin-top: 20px; }
/* Right-side drawer (model picker) */
.drawer-overlay { position: fixed; inset: 0; z-index: 40; background: rgba(15,23,42,.45); }
.drawer { position: fixed; z-index: 41; top: 0; right: 0; bottom: 0; width: min(460px, 100vw); background: var(--surface);
  border-left: 1px solid var(--border); box-shadow: -10px 0 40px rgba(15,23,42,.18); display: flex; flex-direction: column; padding: 18px; gap: 12px; }
.drawer-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; }
.drawer-head h2 { font-size: 17px; }
.drawer-list { flex: 1; max-height: none; margin: 0; }
.sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
[hidden] { display: none !important; }
`;

/** Shared by every page: $(), toast(), say() (inline message + toast for results), api() (401 → sign-in page). */
const HELPERS = `
const $ = (id) => document.getElementById(id);
function toast(text, kind) {
  let box = document.querySelector('.toasts');
  if (!box) { box = document.createElement('div'); box.className = 'toasts'; box.setAttribute('role', 'status'); box.setAttribute('aria-live', 'polite'); document.body.appendChild(box); }
  const t = document.createElement('div'); t.className = 'toast' + (kind === 'bad' ? ' bad' : ''); t.textContent = text;
  box.appendChild(t); setTimeout(() => t.remove(), kind === 'bad' ? 6000 : 3500);
}
function say(id, text, kind) {
  const el = $(id); if (el) { el.textContent = text || ''; el.className = 'msg' + (kind ? ' ' + kind : ''); }
  if (text && (kind === 'good' || kind === 'bad')) toast(text, kind);
}
async function api(method, path, body) {
  const res = await fetch(path, { method, credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body) });
  if (res.status === 401 && path !== '/admin/login') { location.href = '/admin/login'; throw new Error('Please sign in.'); }
  const data = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) throw new Error((data && data.error) || 'Request failed (' + res.status + ')');
  return data;
}
`;

const SHELL_JS = `
(() => {
  const body = document.body, open = $('menu-open'), close = $('menu-close'), overlay = document.querySelector('.overlay');
  const setOpen = (on) => { body.classList.toggle('drawer-open', on); open.setAttribute('aria-expanded', String(on)); if (on) close.focus(); else open.focus(); };
  open.addEventListener('click', () => setOpen(true));
  close.addEventListener('click', () => setOpen(false));
  overlay.addEventListener('click', () => setOpen(false));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && body.classList.contains('drawer-open')) setOpen(false); });
  $('signout').addEventListener('click', async () => { await api('POST', '/admin/logout', {}).catch(() => {}); location.href = '/admin/login'; });
})();
`;

export type NavItem = {
  path: string;
  label: string;
  icon: string;
  group?: string;
  badge?: number;
  bottom?: boolean;
};

function navLink(n: NavItem, current?: string) {
  const active = n.path === current;
  return `<a href="${h(n.path)}"${active ? ' aria-current="page"' : ''}>${icon(n.icon)}<span>${h(n.label)}</span>${
    n.badge ? `<span class="count" aria-label="${n.badge} pending">${n.badge}</span>` : ''
  }</a>`;
}

function sidebar(nav: NavItem[], current?: string) {
  const main = nav.filter((n) => !n.bottom);
  const groups: string[] = [];
  let lastGroup: string | undefined = '\u0000';
  for (const n of main) {
    if (n.group !== lastGroup && n.group) groups.push(`<div class="nav-group">${h(n.group)}</div>`);
    lastGroup = n.group;
    groups.push(navLink(n, current));
  }
  const bottom = nav
    .filter((n) => n.bottom)
    .map((n) => navLink(n, current))
    .join('');
  return `<aside class="sidebar" id="sidebar" aria-label="Admin navigation">
    <div class="brand"><strong>Post It Up</strong><span>Admin</span>
      <button class="icon-btn" id="menu-close" type="button" aria-label="Close menu" style="margin-left:auto">${icon('close', 18)}</button></div>
    <nav class="nav" aria-label="Sections">${groups.join('')}</nav>
    <div class="nav nav-bottom">${bottom}<button type="button" id="signout">${icon('signout')}<span>Sign out</span></button></div>
  </aside>`;
}

export function layout(opts: {
  title: string;
  description?: string;
  body: string;
  script?: string;
  /** Omit for the sign-in page (no shell). */
  nav?: NavItem[];
  current?: string;
}) {
  const head = `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex">
<meta name="color-scheme" content="light dark">
<title>${h(opts.title)} · Post It Up admin</title>
<style>${CSS}
@media (min-width: 900px) { #menu-close { display: none; } }</style>
</head>`;
  if (!opts.nav) {
    return `${head}<body>${opts.body}<script>${HELPERS}(() => {${opts.script ?? ''}
})();</script></body></html>`;
  }
  return `${head}<body>
<div class="shell">
  ${sidebar(opts.nav, opts.current)}
  <div class="overlay" aria-hidden="true"></div>
  <div>
    <header class="topbar">
      <button class="icon-btn" id="menu-open" type="button" aria-label="Open menu" aria-controls="sidebar" aria-expanded="false">${icon('menu', 20)}</button>
      <strong>Post It Up</strong><span class="badge">Admin</span>
    </header>
    <main class="content"><div class="content-inner">
      <div class="page-head"><h1>${h(opts.title)}</h1>${opts.description ? `<p>${h(opts.description)}</p>` : ''}</div>
      ${opts.body}
    </div></main>
  </div>
</div>
<script>${HELPERS}${SHELL_JS}
(() => {${opts.script ?? ''}
})();
</script>
</body></html>`;
}
