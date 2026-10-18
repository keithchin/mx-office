// The Console's Runtime log (ui/liveapp/console.ts): the Mendix runtime's log as entries, newest at the
// bottom, like Studio Pro's Console. Level filters with their counts (Error, Warning, Info, Debug), a
// search, Pause (news waits, Resume shows it), Auto-scroll, Clear (only this view: the log stays), and per
// entry its stack trace folded under it (▸ / ▾) and Copy. The web client's errors ("Client") stand out.
//
// Rows are made as entries come and kept by id, so news appends instead of redrawing the list; a filter
// change redraws it once.

import { h } from '../dom';
import { logText, type LiveLogEntry, type LiveLogLevel } from '../../../shared/liveapp/console';
import { clock, freshLogFilter, logCounts, logList, logShows } from './console-model';

export interface LogPane {
  readonly el: HTMLElement;
  /** News from the office; `reset` drops what was there. */
  put(list: LiveLogEntry[], reset: boolean): void;
  missing(yes: boolean): void;
  /** Errors since the last Clear (the tab's badge). */
  errors(): number;
  /** Called when the counts change. */
  onCount?: () => void;
}

const LEVELS: { level: LiveLogLevel; label: string }[] = [
  { level: 'error', label: 'Error' },
  { level: 'warning', label: 'Warning' },
  { level: 'info', label: 'Info' },
  { level: 'debug', label: 'Debug' },
];

export function logPane(): LogPane {
  const list = logList();
  const filter = freshLogFilter();
  const open = new Set<number>();
  const rows = new Map<number, HTMLElement>();
  let paused: LiveLogEntry[] | null = null;
  let follow = true;

  const levelBtns = LEVELS.map(({ level, label }) => {
    const b = h('button.btn.lc-seg', { type: 'button', 'aria-pressed': String(filter.levels[level]), title: `Show ${label.toLowerCase()} entries` }) as HTMLButtonElement;
    b.dataset.level = level;
    b.addEventListener('click', () => {
      filter.levels[level] = !filter.levels[level];
      redraw();
    });
    return b;
  });
  const search = h('input.lc-search', { type: 'search', placeholder: 'Search the log', 'aria-label': 'Search the runtime log', spellcheck: 'false' }) as HTMLInputElement;
  let typing: ReturnType<typeof setTimeout> | undefined;
  search.addEventListener('input', () => {
    clearTimeout(typing);
    typing = setTimeout(() => {
      filter.text = search.value.trim();
      redraw();
    }, 150);
  });
  const pauseBtn = h('button.btn.lc-btn', { type: 'button', 'aria-pressed': 'false', title: 'Hold new entries back while you read; Resume shows them' }, '⏸ Pause') as HTMLButtonElement;
  pauseBtn.addEventListener('click', () => (paused ? resume() : pause()));
  const followBtn = h('button.btn.lc-btn', { type: 'button', 'aria-pressed': 'true', title: 'Keep the newest entry in view' }, '⤓ Auto-scroll') as HTMLButtonElement;
  followBtn.addEventListener('click', () => {
    follow = !follow;
    paint();
    if (follow) toBottom();
  });
  const clearBtn = h('button.btn.lc-btn', { type: 'button', title: 'Clear this view (the runtime log itself is kept)' }, '⌫ Clear') as HTMLButtonElement;
  clearBtn.addEventListener('click', () => {
    filter.clearedTo = list.items[list.items.length - 1]?.id ?? filter.clearedTo;
    redraw();
  });
  const bar = h('div.lc-bar', { role: 'toolbar', 'aria-label': 'Runtime log' }, h('span.lc-group', { role: 'group', 'aria-label': 'Levels' }, ...levelBtns), search, pauseBtn, followBtn, clearBtn);
  const body = h('div.lc-list', { role: 'log', 'aria-live': 'off', tabindex: '0', 'aria-label': 'Runtime log entries' });
  const empty = h('p.lc-empty', {}, 'Nothing in the runtime log yet.');
  const el = h('div.lc-pane.lc-log', {}, bar, body, empty);
  body.addEventListener('scroll', () => {
    const atEnd = body.scrollHeight - body.scrollTop - body.clientHeight < 24;
    if (follow !== atEnd && !scrolling) {
      follow = atEnd;
      paint();
    }
  });
  let scrolling = false;
  let missingLog = false;

  function row(e: LiveLogEntry): HTMLElement {
    const isOpen = open.has(e.id);
    const caret = e.detail ? (h('button.lc-caret', { type: 'button', 'aria-expanded': String(isOpen), 'aria-label': isOpen ? 'Fold the details' : 'Show the details', title: isOpen ? 'Fold' : 'Show the stack trace' }, isOpen ? '▾' : '▸') as HTMLButtonElement) : h('span.lc-caret.lc-none', {});
    const copy = h('button.lc-copy', { type: 'button', title: 'Copy this entry', 'aria-label': 'Copy this entry' }, '⧉') as HTMLButtonElement;
    const r = h(
      `div.lc-row.lc-${e.level}${e.client ? '.lc-client' : ''}${e.mark ? '.lc-mark' : ''}`,
      { 'data-id': String(e.id) },
      h('div.lc-line', {}, caret, h('span.lc-time', { title: e.time }, e.time ? clock(e.time) : ''), h('span.lc-level', {}, e.level === 'warning' ? 'WARN' : e.level.toUpperCase()), h('span.lc-node', { title: e.client ? "The app's web client (a page or widget in the browser)" : '' }, e.node), h('span.lc-msg', {}, e.message), copy),
      isOpen && e.detail ? h('pre.lc-detail', {}, e.detail) : null,
    );
    if (caret instanceof HTMLButtonElement)
      caret.addEventListener('click', () => {
        if (open.has(e.id)) open.delete(e.id);
        else open.add(e.id);
        const now = list.items[list.find(e.id)] ?? e;
        const next = row(now);
        rows.get(e.id)?.replaceWith(next);
        rows.set(e.id, next);
        (next.querySelector('.lc-caret') as HTMLElement | null)?.focus();
      });
    copy.addEventListener('click', () => {
      void navigator.clipboard?.writeText(logText(e)).then(
        () => (copy.textContent = '✓'),
        () => (copy.textContent = '✕'),
      );
      setTimeout(() => (copy.textContent = '⧉'), 1200);
    });
    return r;
  }

  function apply(news: LiveLogEntry[]) {
    const atEnd = body.scrollHeight - body.scrollTop - body.clientHeight < 24;
    const maxBefore = list.items[list.items.length - 1]?.id ?? 0;
    const got = list.put(news);
    for (const e of got.dropped) {
      rows.get(e.id)?.remove();
      rows.delete(e.id);
      open.delete(e.id);
    }
    for (const e of got.replaced) {
      const old = rows.get(e.id);
      if (!old) continue;
      if (!logShows(e, filter)) {
        old.remove();
        rows.delete(e.id);
        continue;
      }
      const next = row(e);
      old.replaceWith(next);
      rows.set(e.id, next);
    }
    const frag = document.createDocumentFragment();
    for (const e of got.added) {
      if (!logShows(e, filter)) continue;
      const r = row(e);
      rows.set(e.id, r);
      frag.append(r);
    }
    body.append(frag);
    // An entry arriving out of order (rare) goes where it belongs.
    if (got.added.some((e) => e.id < maxBefore)) redraw();
    paint();
    if (follow || atEnd) toBottom();
  }

  function redraw() {
    rows.clear();
    const frag = document.createDocumentFragment();
    for (const e of list.items) {
      if (!logShows(e, filter)) continue;
      const r = row(e);
      rows.set(e.id, r);
      frag.append(r);
    }
    body.replaceChildren(frag);
    paint();
    if (follow) toBottom();
  }

  function toBottom() {
    scrolling = true;
    body.scrollTop = body.scrollHeight;
    requestAnimationFrame(() => (scrolling = false));
  }

  function pause() {
    paused = [];
    paint();
  }
  function resume() {
    const held = paused ?? [];
    paused = null;
    apply(held);
  }

  function paint() {
    const n = logCounts(list.items, filter.clearedTo);
    for (const b of levelBtns) {
      const lv = b.dataset.level as LiveLogLevel;
      const label = LEVELS.find((l) => l.level === lv)!.label;
      b.setAttribute('aria-pressed', String(filter.levels[lv]));
      b.textContent = lv === 'error' || lv === 'warning' ? `${label} ${n[lv]}` : label;
      b.classList.toggle('lc-has', (lv === 'error' || lv === 'warning') && n[lv] > 0);
    }
    pauseBtn.setAttribute('aria-pressed', String(!!paused));
    pauseBtn.textContent = paused ? `▶ Resume${paused.length ? ` (${paused.length} new)` : ''}` : '⏸ Pause';
    followBtn.setAttribute('aria-pressed', String(follow));
    const none = rows.size === 0;
    empty.hidden = !none;
    empty.textContent = missingLog ? 'No runtime log yet: it appears once the app has started (.mxcli/runtime.log in the live checkout).' : list.items.length ? 'Nothing matches the filters.' : 'Nothing in the runtime log yet.';
    pane.onCount?.();
  }

  const pane: LogPane = {
    el,
    put(news, reset) {
      if (reset) {
        list.clear();
        open.clear();
        if (paused) paused = [];
        rows.clear();
        body.replaceChildren();
      }
      if (paused && !reset) {
        paused.push(...news);
        paint();
        return;
      }
      apply(news);
    },
    missing(yes) {
      missingLog = yes;
      paint();
    },
    errors: () => logCounts(list.items, filter.clearedTo).error,
  };
  paint();
  return pane;
}
