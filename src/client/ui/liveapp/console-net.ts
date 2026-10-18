// The Console's Network (ui/liveapp/console.ts): the requests the app made through the office's recording
// proxy, newest at the bottom, like a browser's network panel. All, XHR (the app's own calls: xas/, fetch,
// WebSockets) or Errors; a search; Pause and Clear (only this view). A row opens to its details: the
// address, status and timing, the headers (cookies and credentials redacted by the office), and the
// bodies' first 8 KB (JSON laid out; binary and static files only noted). Mendix xas/ calls are named by
// their action.

import { h } from '../dom';
import { bytes, netFailed, netName, type LiveNetEntry } from '../../../shared/liveapp/console';
import { freshNetFilter, netFailures, netList, netShows, pretty, type NetView } from './console-model';

export interface NetPane {
  readonly el: HTMLElement;
  put(list: LiveNetEntry[], reset: boolean): void;
  /** Whether requests are recorded (the proxy is up), and the address they go through. */
  setRecording(url: string | null): void;
  failures(): number;
  onCount?: () => void;
}

const VIEWS: { view: NetView; label: string; title: string }[] = [
  { view: 'all', label: 'All', title: 'Every request' },
  { view: 'xhr', label: 'XHR', title: "The app's own calls: xas/, fetch and XHR, WebSockets" },
  { view: 'errors', label: 'Errors', title: 'No answer, or a 4xx/5xx status' },
];

const time = (at: number) => new Date(at).toLocaleTimeString(undefined, { hour12: false });

export function netPane(): NetPane {
  const list = netList();
  const filter = freshNetFilter();
  const open = new Set<number>();
  const rows = new Map<number, HTMLElement>();
  let paused: LiveNetEntry[] | null = null;
  let recording: string | null = null;

  const viewBtns = VIEWS.map(({ view, label, title }) => {
    const b = h('button.btn.lc-seg', { type: 'button', 'aria-pressed': String(view === filter.view), title }, label) as HTMLButtonElement;
    b.addEventListener('click', () => {
      filter.view = view;
      redraw();
    });
    b.dataset.view = view;
    return b;
  });
  const search = h('input.lc-search', { type: 'search', placeholder: 'Filter by address or status', 'aria-label': 'Filter the requests', spellcheck: 'false' }) as HTMLInputElement;
  let typing: ReturnType<typeof setTimeout> | undefined;
  search.addEventListener('input', () => {
    clearTimeout(typing);
    typing = setTimeout(() => {
      filter.text = search.value.trim();
      redraw();
    }, 150);
  });
  const pauseBtn = h('button.btn.lc-btn', { type: 'button', 'aria-pressed': 'false', title: 'Hold new requests back while you read; Resume shows them' }, '⏸ Pause') as HTMLButtonElement;
  pauseBtn.addEventListener('click', () => {
    if (paused) {
      const held = paused;
      paused = null;
      apply(held);
    } else {
      paused = [];
      paint();
    }
  });
  const clearBtn = h('button.btn.lc-btn', { type: 'button', title: 'Clear this view (new requests still show)' }, '⌫ Clear') as HTMLButtonElement;
  clearBtn.addEventListener('click', () => {
    filter.clearedTo = list.items[list.items.length - 1]?.id ?? filter.clearedTo;
    redraw();
  });
  const count = h('span.lc-count', { 'aria-live': 'polite' });
  const bar = h('div.lc-bar', { role: 'toolbar', 'aria-label': 'Network' }, h('span.lc-group', { role: 'group', 'aria-label': 'Which requests' }, ...viewBtns), search, pauseBtn, clearBtn, count);
  const head = h('div.ln-row.ln-head', { 'aria-hidden': 'true' }, h('span.ln-caret', {}), h('span.ln-method', {}, 'Method'), h('span.ln-status', {}, 'Status'), h('span.ln-name', {}, 'Name'), h('span.ln-kind', {}, 'Type'), h('span.ln-size', {}, 'Size'), h('span.ln-ms', {}, 'Time'));
  const body = h('div.lc-list.ln-list', { role: 'list', 'aria-label': 'Requests' });
  const empty = h('p.lc-empty', {});
  const el = h('div.lc-pane.lc-net', {}, bar, head, body, empty);

  function headers(title: string, pairs: [string, string][] | undefined) {
    if (!pairs?.length) return null;
    return h('details.ln-sec', { open: true }, h('summary', {}, `${title} (${pairs.length})`), h('dl.ln-headers', {}, ...pairs.flatMap(([k, v]) => [h('dt', {}, k), h('dd', {}, v)])));
  }
  function bodyOf(title: string, text: string | undefined, note: string | undefined) {
    if (text === undefined && !note) return null;
    return h('details.ln-sec', { open: true }, h('summary', {}, title), note ? h('p.ln-note', {}, note) : null, text !== undefined ? h('pre.ln-body', {}, pretty(text)) : null);
  }
  function detail(e: LiveNetEntry): HTMLElement {
    const general: [string, string][] = [
      ['Address', `${recording ? recording.replace(/\/$/, '') : ''}${e.path}`],
      ['Method', e.method],
      ['Status', e.pending ? (e.kind === 'ws' && e.status === 101 ? '101 (open)' : 'waiting…') : e.status ? String(e.status) : 'no answer'],
      ['Started', time(e.at)],
      ...(e.ms !== undefined ? ([['Took', `${e.ms} ms`]] as [string, string][]) : []),
      ...(e.size !== undefined ? ([['Size', bytes(e.size)]] as [string, string][]) : []),
      ...(e.action ? ([['xas action', e.action]] as [string, string][]) : []),
      ...(e.error ? ([['Error', e.error]] as [string, string][]) : []),
    ];
    return h(
      'div.ln-detail',
      {},
      h('details.ln-sec', { open: true }, h('summary', {}, 'General'), h('dl.ln-headers', {}, ...general.flatMap(([k, v]) => [h('dt', {}, k), h('dd', {}, v)]))),
      headers('Request headers', e.reqHeaders),
      bodyOf('Request body', e.reqBody, e.reqNote),
      headers('Response headers', e.resHeaders),
      bodyOf('Response body', e.resBody, e.resNote),
    );
  }

  function row(e: LiveNetEntry): HTMLElement {
    const isOpen = open.has(e.id);
    const failed = netFailed(e);
    const name = netName(e);
    const path = e.path.split('?')[0];
    const status = e.pending ? (e.kind === 'ws' && e.status === 101 ? '101' : '…') : e.status ? String(e.status) : '✕';
    const line = h(
      'button.ln-row.ln-line',
      { type: 'button', 'aria-expanded': String(isOpen), title: `${e.method} ${e.path}${e.error ? ` · ${e.error}` : ''}` },
      h('span.ln-caret', { 'aria-hidden': 'true' }, isOpen ? '▾' : '▸'),
      h('span.ln-method', {}, e.method),
      h('span.ln-status', {}, status),
      h('span.ln-name', {}, name, e.action || path === name ? null : h('small.ln-path', {}, ` ${path}`)),
      h('span.ln-kind', {}, e.kind === 'xas' ? 'xas' : e.kind === 'ws' ? 'ws' : (e.type?.split('/').pop() ?? e.kind)),
      h('span.ln-size', {}, bytes(e.size)),
      h('span.ln-ms', {}, e.ms !== undefined ? `${e.ms} ms` : ''),
    ) as HTMLButtonElement;
    const r = h(`div.ln-item${failed ? '.ln-failed' : ''}${e.pending ? '.ln-pending' : ''}`, { role: 'listitem', 'data-id': String(e.id) }, line, isOpen ? detail(e) : null);
    line.addEventListener('click', () => {
      if (open.has(e.id)) open.delete(e.id);
      else open.add(e.id);
      const next = row(list.items[list.find(e.id)] ?? e);
      rows.get(e.id)?.replaceWith(next);
      rows.set(e.id, next);
      (next.querySelector('.ln-line') as HTMLElement | null)?.focus();
    });
    return r;
  }

  function apply(news: LiveNetEntry[]) {
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
      if (old && netShows(e, filter)) {
        const next = row(e);
        old.replaceWith(next);
        rows.set(e.id, next);
      } else if (old) {
        old.remove();
        rows.delete(e.id);
      } else if (netShows(e, filter)) got.added.push(e);
    }
    const frag = document.createDocumentFragment();
    for (const e of got.added) {
      if (!netShows(e, filter)) continue;
      const r = row(e);
      rows.set(e.id, r);
      frag.append(r);
    }
    body.append(frag);
    if (got.added.some((e) => e.id < maxBefore)) return redraw();
    paint();
    if (atEnd && !open.size) body.scrollTop = body.scrollHeight;
  }

  function redraw() {
    rows.clear();
    const frag = document.createDocumentFragment();
    for (const e of list.items) {
      if (!netShows(e, filter)) continue;
      const r = row(e);
      rows.set(e.id, r);
      frag.append(r);
    }
    body.replaceChildren(frag);
    paint();
    body.scrollTop = body.scrollHeight;
  }

  function paint() {
    const failures = netFailures(list.items, filter.clearedTo);
    for (const b of viewBtns) {
      b.setAttribute('aria-pressed', String(b.dataset.view === filter.view));
      if (b.dataset.view === 'errors') {
        b.textContent = failures ? `Errors ${failures}` : 'Errors';
        b.classList.toggle('lc-has', failures > 0);
      }
    }
    pauseBtn.setAttribute('aria-pressed', String(!!paused));
    pauseBtn.textContent = paused ? `▶ Resume${paused.length ? ` (${paused.length} new)` : ''}` : '⏸ Pause';
    const shown = rows.size;
    const all = list.items.filter((e) => e.id > filter.clearedTo).length;
    count.textContent = all ? `${shown === all ? all : `${shown} of ${all}`} request${all === 1 ? '' : 's'}` : '';
    empty.hidden = shown > 0;
    empty.textContent = !recording
      ? 'Requests are recorded while the app runs: open it with Open live app (the office passes its requests on and lists them here).'
      : all
        ? 'Nothing matches the filter.'
        : 'No requests yet. Open live app, and what it asks the runtime shows up here.';
    pane.onCount?.();
  }

  const pane: NetPane = {
    el,
    put(news, reset) {
      if (reset) {
        list.clear();
        open.clear();
        rows.clear();
        body.replaceChildren();
        if (paused) paused = [];
      }
      if (paused && !reset) {
        paused.push(...news);
        return paint();
      }
      apply(news);
    },
    setRecording(url) {
      if (url === recording) return;
      recording = url;
      paint();
    },
    failures: () => netFailures(list.items, filter.clearedTo),
  };
  paint();
  return pane;
}
