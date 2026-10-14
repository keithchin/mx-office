// The version banner on every page (flatSession installs it): the office's build against the page's,
// a restart under way with whom it waits on and its countdown, a newer build ready, and "Restarted: now
// running …" once the new office answers (logic.ts decides which). It asks GET /api/office/version when
// the page opens, when the socket comes back, when the tab is shown again, and then every minute (every
// two seconds while a restart is under way). It also puts a page newer than its server into words where
// a request fails ("Unknown action" becomes why, and what to do), by wrapping fetch for /api/ calls.

import { newerBuild, parseBuildInfo, staleServerError, type BuildInfo, type OfficeVersionView } from '../../../shared/build-info';
import { settingsHref } from '../../../shared/settings-sections';
import { h } from '../dom';
import { restartAction } from '../project-run/api';
import { bannerFor, nextLookMs, type Banner, type ServerKnown } from './logic';
import './version.css';

declare const __BUILD_INFO__: BuildInfo | undefined;

/** The build this page is from (vite.config.ts compiles it in; undefined where it doesn't, as in tests). */
export const PAGE_BUILD: BuildInfo | undefined = typeof __BUILD_INFO__ === 'undefined' ? undefined : parseBuildInfo(__BUILD_INFO__);

const SEEN_KEY = 'ao.version.startedAt';
const CLOSED_KEY = 'ao.version.closed';

const session = {
  get: (k: string) => {
    try {
      return sessionStorage.getItem(k) ?? undefined;
    } catch {
      return undefined;
    }
  },
  set: (k: string, v: string) => {
    try {
      sessionStorage.setItem(k, v);
    } catch {
      // a private window: the banner just comes back
    }
  },
};

let known: ServerKnown | undefined;
let skew = 0;
let restartedFrom: number | undefined;
let el: HTMLElement | undefined;
let timer: ReturnType<typeof setTimeout> | undefined;
let tick: ReturnType<typeof setInterval> | undefined;

/** The page is from a newer build than the server answering it. */
export function pageAhead(): boolean {
  if (!PAGE_BUILD || !known) return false;
  return 'missing' in known ? true : newerBuild(PAGE_BUILD, known.view.running);
}

async function look() {
  try {
    const res = await fetch('/api/office/version', { credentials: 'same-origin', cache: 'no-store' });
    const data = (await res.json().catch(() => null)) as OfficeVersionView | null;
    if (res.ok && data?.running) {
      known = { view: data };
      skew = data.now - Date.now();
      const seen = Number(session.get(SEEN_KEY));
      if (seen && seen !== data.running.startedAt) restartedFrom = seen;
      session.set(SEEN_KEY, String(data.running.startedAt));
    } else if (res.status === 404 || (res.ok && !data)) {
      // An office from before this route: older than this page for sure.
      known = { missing: true };
    }
  } catch {
    // The office is away: office-down says so; look again later.
  }
  draw();
  clearTimeout(timer);
  timer = setTimeout(() => void look(), nextLookMs(known));
}

function draw() {
  const b = known && bannerFor(known, PAGE_BUILD, { clockSkew: skew, restartedFrom });
  if (!b || session.get(CLOSED_KEY) === b.key) return void (el?.remove(), (el = undefined), clearInterval(tick));
  const box = render(b);
  if (el) el.replaceWith(box);
  else document.body.append(box);
  el = box;
  // The countdown moves every second between looks.
  clearInterval(tick);
  if (b.kind === 'restart') tick = setInterval(() => draw(), 1000);
  if (b.kind === 'restarted') setTimeout(() => ((restartedFrom = undefined), draw()), 20_000);
}

function render(b: Banner): HTMLElement {
  const close = h('button.ao-ver-x', { type: 'button', title: 'Hide this', 'aria-label': 'Hide this' }, '✕');
  close.addEventListener('click', () => (session.set(CLOSED_KEY, b.key), draw()));
  const acts = b.actions.map((a) =>
    a === 'reload'
      ? h('button.btn.small', { type: 'button', onclick: () => location.reload() }, 'Reload')
      : a === 'settings'
        ? h('a.btn.small', { href: `${settingsHref('workers')}#settings-restart` }, '🔁 Restart safely')
        : h('button.btn.small.danger', { type: 'button', onclick: () => void restartAction('anyway').then((v) => (v ? void look() : undefined)) }, 'Restart anyway'),
  );
  return h('div.ao-ver', { id: 'ao-version', role: b.tone === 'warn' ? 'alert' : 'status', 'data-kind': b.kind, 'data-tone': b.tone }, h('span.ao-ver-text', {}, b.text), ...acts, close);
}

/** Failed /api/ calls from a page newer than its server say why, instead of "Unknown action". */
function guardFetch() {
  const plain = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const res = await plain(input, init);
    if ((res.status !== 400 && res.status !== 404) || !PAGE_BUILD || !pageAhead()) return res;
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (!new URL(url, location.href).pathname.startsWith('/api/') || url.includes('/api/office/version')) return res;
    const body = (await res.clone().json().catch(() => null)) as { error?: unknown } | null;
    if (!body || typeof body.error !== 'string') return res;
    const server = known && 'view' in known ? known.view.running : undefined;
    return new Response(JSON.stringify({ ...body, error: staleServerError(PAGE_BUILD, server, body.error) }), { status: res.status, statusText: res.statusText, headers: res.headers });
  };
}

let installed = false;

/** Starts the banner and the fetch guard; `onReconnect` hears when the socket is back (a restart). */
export function installVersionWatch(onReconnect?: (fn: () => void) => void) {
  if (installed) return;
  installed = true;
  guardFetch();
  onReconnect?.(() => void look());
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && void look());
  void look();
}
