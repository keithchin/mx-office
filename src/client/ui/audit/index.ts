// 🧾 The Audit log tab (GET /api/audit, server/audit/): who did what, when, on this floor, the office
// or every floor. A filter bar (time range, actor kinds, action group, search), a timeline of events
// per bucket (click a bar to zoom to it), and a dense table that opens a row to its details and pages
// on as you scroll. New events arrive over the socket ({t:'audit.new'}) behind an "N new" pill rather
// than moving the table, and the badge says whether the hash chain holds. Admins export CSV or JSONL
// and choose whether prompts are logged with their start. The 1D view and the home page both use it;
// no three.js.

import { AUDIT_ACTOR_KINDS, AUDIT_GROUPS, OFFICE_FLOOR, isAuditGroup, type AuditActorKind, type AuditEvent, type AuditGroup, type AuditPage } from '../../../shared/audit';
import type { FloorInfo, ServerMsg } from '../../../shared/protocol';
import { h, toast } from '../dom';
import { ACTOR_META, PRESETS, bucketLabel, fits, queryString, rangeOf, type Filter, type Preset } from './logic';
import { eventItem, headerRow } from './rows';
import { eventActions, incidentsView } from '../incidents';
import './audit.css';

/** 'floor' is the floor you're on (the 1D view); otherwise a floor's id, '_office' or 'all'. */
type Scope = string;

export interface AuditViewOpts {
  /** The floor you're on, for the 1D view's "This floor"; missing on the home page. */
  floor?: () => string | undefined;
  floors: () => readonly FloorInfo[];
  /** The floor column (the home page, and "every floor" anywhere). */
  showFloor?: boolean;
  admin: () => boolean;
  /** Where the filter is remembered in this browser. */
  storeKey: string;
}

const PAGE = 100;

interface Saved {
  scope: Scope;
  preset: Preset;
  since?: number;
  until?: number;
  actors: AuditActorKind[];
  group: AuditGroup | '';
}

function load(key: string, dflt: Scope): Saved {
  try {
    const v = JSON.parse(localStorage.getItem(key) ?? '{}');
    return {
      scope: typeof v.scope === 'string' ? v.scope : dflt,
      preset: PRESETS.some((p) => p.id === v.preset) ? v.preset : '7d',
      since: typeof v.since === 'number' ? v.since : undefined,
      until: typeof v.until === 'number' ? v.until : undefined,
      actors: Array.isArray(v.actors) ? v.actors.filter((k: unknown) => AUDIT_ACTOR_KINDS.includes(k as AuditActorKind)) : [],
      group: isAuditGroup(v.group) ? v.group : '',
    };
  } catch {
    return { scope: dflt, preset: '7d', actors: [], group: '' };
  }
}

/** A datetime-local input's value for a time, and back. */
const toLocal = (t: number) => {
  const d = new Date(t - new Date(t).getTimezoneOffset() * 60_000);
  return d.toISOString().slice(0, 16);
};
const fromLocal = (v: string) => (v ? new Date(v).getTime() : undefined);

export function auditView(root: HTMLElement, opts: AuditViewOpts) {
  const saved = load(opts.storeKey, opts.floor ? 'floor' : 'all');
  let scope: Scope = saved.scope;
  const filter: Omit<Filter, 'floor'> = { preset: saved.preset, since: saved.since, until: saved.until, actors: saved.actors, group: saved.group, q: '' };
  let page: AuditPage | undefined;
  let events: AuditEvent[] = [];
  let cursor: string | undefined;
  let pending: AuditEvent[] = [];
  let loading = false;
  let visible = false;
  let gen = 0;
  const open = new Set<string>();

  const floorName = (id: string) => opts.floors().find((f) => f.id === id)?.name;
  /** The floor the query asks for. */
  const floorOf = (): string => (scope === 'floor' ? (opts.floor?.() ?? OFFICE_FLOOR) : scope);
  const full = (): Filter => ({ ...filter, floor: floorOf() });
  const showFloor = () => !!opts.showFloor || floorOf() === 'all';
  const save = () => {
    try {
      localStorage.setItem(opts.storeKey, JSON.stringify({ scope, preset: filter.preset, since: filter.since, until: filter.until, actors: filter.actors, group: filter.group }));
    } catch {
      // Just for this visit.
    }
  };

  // ---- The parts of the tab, made once ------------------------------------------------------------
  const badge = h('span.au-badge', { role: 'status' });
  const totalEl = h('span.au-total');
  const exports = h('span.au-exports');
  const head = h('div.au-head', {}, h('h2.lite-h', {}, '🧾 Audit log'), badge, totalEl, exports);
  const bar = h('div.au-filters', { role: 'search' });
  const timeline = h('div.au-timeline', { 'aria-label': 'Events over time' });
  const newPill = h('button.btn.au-new.hidden', { type: 'button', onclick: () => showPending() });
  const table = h('div.au-table', { role: 'table', 'aria-label': 'Audit events' });
  const more = h('div.au-more');
  // Two sub-tabs: the events, and the incidents made of them (ui/incidents/).
  const subKey = `${opts.storeKey}.sub`;
  let sub: 'events' | 'incidents' = (() => {
    try {
      return localStorage.getItem(subKey) === 'incidents' ? 'incidents' : 'events';
    } catch {
      return 'events';
    }
  })();
  const evTab = h('button.btn.au-subtab', { type: 'button', role: 'tab', onclick: () => pickSub('events') }, '🧾 Events');
  const incTab = h('button.btn.au-subtab', { type: 'button', role: 'tab', onclick: () => pickSub('incidents') }, '🚨 Incidents', h('span.au-subn', {}));
  const eventsPane = h('section.au', {}, head, bar, timeline, newPill, table, more);
  const incPane = h('div.au-incidents');
  root.replaceChildren(h('div.au-subtabs', { role: 'tablist', 'aria-label': 'Audit log' }, evTab, incTab), eventsPane, incPane);
  const incidents = incidentsView(incPane, {
    floor: opts.floor,
    floors: opts.floors,
    admin: opts.admin,
    storeKey: `${opts.storeKey}.incidents`,
    showEvent: (id) => showEvent(id),
    counted: (n) => {
      const el = incTab.querySelector('.au-subn')!;
      el.textContent = n ? String(n) : '';
      incTab.title = `${n} open incident${n === 1 ? '' : 's'}`;
    },
  });
  function pickSub(s: 'events' | 'incidents', incident?: string) {
    sub = s;
    try {
      localStorage.setItem(subKey, s);
    } catch {
      // Just for this visit.
    }
    renderSub();
    if (!visible) return;
    if (s === 'incidents') incidents.show(incident);
    else {
      incidents.hide();
      renderBar();
      void fetchFirst();
    }
  }
  function renderSub() {
    evTab.setAttribute('aria-selected', String(sub === 'events'));
    incTab.setAttribute('aria-selected', String(sub === 'incidents'));
    eventsPane.classList.toggle('hidden', sub !== 'events');
    incPane.classList.toggle('hidden', sub !== 'incidents');
  }
  /** A linked event from an incident: the Events sub-tab, every floor, the minutes round it, searched for by its id and opened. */
  function showEvent(id: string) {
    const t = parseInt(id.slice(0, 9), 36);
    scope = 'all';
    filter.preset = 'custom';
    filter.since = Number.isFinite(t) ? t - 60_000 : undefined;
    filter.until = Number.isFinite(t) ? t + 60_000 : undefined;
    filter.q = id;
    open.add(id);
    save();
    pickSub('events');
  }
  renderSub();
  const io = typeof IntersectionObserver === 'function' ? new IntersectionObserver((list) => list.some((x) => x.isIntersecting) && loadMore()) : undefined;
  io?.observe(more);

  // ---- The filter bar ----------------------------------------------------------------------------
  let searchTimer: ReturnType<typeof setTimeout> | undefined;
  function renderBar() {
    const scopes: [string, string][] = [
      ...(opts.floor ? ([['floor', 'This floor']] as [string, string][]) : []),
      [OFFICE_FLOOR, 'Office-wide'],
      ['all', 'Every floor'],
      ...(opts.floor ? [] : opts.floors().filter((f) => !f.cloning).map((f) => [f.id, f.name] as [string, string])),
    ];
    const scopeSel = h('select.au-scope', { 'aria-label': 'Which floor', onchange: (e: Event) => ((scope = (e.target as HTMLSelectElement).value), changed()) }, ...scopes.map(([v, l]) => h('option', { value: v, selected: v === scope }, l)));
    const presets = h(
      'div.au-chips',
      { role: 'group', 'aria-label': 'Time range' },
      ...PRESETS.map((p) =>
        h(
          'button.btn.au-chip',
          {
            type: 'button',
            'aria-pressed': String(filter.preset === p.id),
            onclick: () => {
              if (p.id === 'custom' && filter.preset !== 'custom') {
                const r = rangeOf(filter, Date.now());
                filter.since = r.since;
                filter.until = Date.now();
              }
              filter.preset = p.id;
              changed();
            },
          },
          p.label,
        ),
      ),
    );
    const custom =
      filter.preset === 'custom'
        ? h(
            'div.au-custom',
            {},
            h('label', {}, 'From ', h('input', { type: 'datetime-local', value: toLocal(filter.since ?? Date.now() - 86_400_000), onchange: (e: Event) => ((filter.since = fromLocal((e.target as HTMLInputElement).value)), changed()) })),
            h('label', {}, 'to ', h('input', { type: 'datetime-local', value: filter.until ? toLocal(filter.until) : '', onchange: (e: Event) => ((filter.until = fromLocal((e.target as HTMLInputElement).value)), changed()) })),
          )
        : null;
    const actors = h(
      'div.au-chips',
      { role: 'group', 'aria-label': 'Who' },
      ...AUDIT_ACTOR_KINDS.map((k) =>
        h(
          'button.btn.au-chip',
          {
            type: 'button',
            'data-kind': k,
            'aria-pressed': String(filter.actors.includes(k)),
            onclick: () => {
              filter.actors = filter.actors.includes(k) ? filter.actors.filter((x) => x !== k) : [...filter.actors, k];
              changed();
            },
          },
          `${ACTOR_META[k].icon} ${ACTOR_META[k].label}`,
          h('span.au-n', {}),
        ),
      ),
    );
    const group = h(
      'select.au-group',
      { 'aria-label': 'Kind of action', onchange: (e: Event) => ((filter.group = (e.target as HTMLSelectElement).value as AuditGroup | ''), changed()) },
      h('option', { value: '', selected: !filter.group }, 'Every action'),
      ...Object.entries(AUDIT_GROUPS).map(([g, def]) => h('option', { value: g, selected: g === filter.group }, def.label)),
    );
    const search = h('input.au-q', {
      type: 'search',
      placeholder: 'Search summaries, people, targets…',
      'aria-label': 'Search',
      value: filter.q,
      oninput: (e: Event) => {
        filter.q = (e.target as HTMLInputElement).value;
        clearTimeout(searchTimer);
        searchTimer = setTimeout(() => void fetchFirst(), 250);
      },
    });
    bar.replaceChildren(h('div.au-line', {}, scopeSel, presets, custom), h('div.au-line', {}, actors, group, search));
    renderCounts();
  }
  /** How many events each actor kind has in the range, on its chip. */
  function renderCounts() {
    for (const el of bar.querySelectorAll<HTMLElement>('[data-kind]')) el.querySelector('.au-n')!.textContent = String(page?.counts.actors[el.dataset.kind as AuditActorKind] ?? '');
  }

  function renderHead() {
    const chain = page?.chain;
    badge.className = `au-badge ${!chain ? '' : chain.ok ? 'ok' : 'bad'}`;
    badge.textContent = !chain ? '' : chain.ok ? '🔒 Chain verified' : `⚠️ Chain broken at ${chain.brokenAt ? new Date(chain.brokenAt).toLocaleString() : 'an unreadable line'}${chain.brokenFloor ? ` (${floorName(chain.brokenFloor) ?? chain.brokenFloor})` : ''}`;
    badge.title = chain?.ok ? 'Every line of the log points at the one before it: nothing was edited or taken out' : 'A line of the log was edited, taken out or moved since it was written';
    totalEl.textContent = page ? `${page.total} event${page.total === 1 ? '' : 's'}` : '';
    if (!opts.admin()) return exports.replaceChildren();
    const href = (format: string) => `/api/audit/export?${queryString(full(), Date.now(), { format })}`;
    const prompt = h('label.au-prompt', { title: 'Keep the first 80 characters of every prompt a person sends an agent (off: only its length)' }, h('input', { type: 'checkbox', checked: !!page?.promptText, onchange: (e: Event) => void setPromptText((e.target as HTMLInputElement).checked) }), ' Log prompt text');
    exports.replaceChildren(h('a.btn.au-export', { href: href('csv'), download: '' }, '⬇ CSV'), h('a.btn.au-export', { href: href('jsonl'), download: '' }, '⬇ JSONL'), prompt);
  }

  async function setPromptText(on: boolean) {
    const res = await fetch('/api/audit/settings', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ promptText: on }) }).catch(() => undefined);
    if (!res?.ok) toast("Couldn't change that", 'warn');
    void fetchFirst();
  }

  // ---- The timeline ------------------------------------------------------------------------------
  function renderTimeline() {
    const hist = page?.histogram;
    if (!hist || !hist.counts.length) return timeline.replaceChildren();
    const max = Math.max(1, ...hist.counts);
    const bars = hist.counts.map((n, i) => {
      const start = hist.start + i * hist.size;
      const label = `${bucketLabel(start, hist.size)}: ${n} event${n === 1 ? '' : 's'}`;
      return h(
        'button.au-bar',
        {
          type: 'button',
          title: label,
          'aria-label': `${label}. Zoom in`,
          style: `--h:${n ? Math.max(6, Math.round((n / max) * 100)) : 0}%`,
          onclick: () => {
            filter.preset = 'custom';
            filter.since = start;
            filter.until = start + hist.size;
            changed();
          },
        },
        h('span', {}),
      );
    });
    const end = hist.start + hist.counts.length * hist.size;
    timeline.replaceChildren(h('div.au-bars', { style: `--n:${hist.counts.length}` }, ...bars), h('div.au-axis', {}, h('span', {}, bucketLabel(hist.start, hist.size)), h('span', {}, `peak ${max} per ${hist.size >= 86_400_000 ? 'day' : hist.size >= 3_600_000 ? 'hour' : '5 min'}`), h('span', {}, bucketLabel(end - hist.size, hist.size))));
  }

  // ---- The table ---------------------------------------------------------------------------------
  const rowOpts = () => ({ showFloor: showFloor(), floorName, now: Date.now(), extra: (e: AuditEvent) => (opts.admin() ? eventActions(e, opts.floors, (i) => pickSub('incidents', (incidents.opened(i), i.id))) : null) });
  function toggle(id: string) {
    if (open.has(id)) open.delete(id);
    else open.add(id);
    const e = events.find((x) => x.id === id);
    const el = table.querySelector<HTMLElement>(`.au-item[data-id="${CSS.escape(id)}"]`);
    if (e && el) el.replaceWith(eventItem(e, rowOpts(), open.has(id), toggle));
  }
  function renderRows() {
    const o = rowOpts();
    table.classList.toggle('with-floor', o.showFloor);
    table.replaceChildren(headerRow(o), ...events.map((e) => eventItem(e, o, open.has(e.id), toggle)));
    if (!events.length) table.append(h('p.au-empty', {}, loading ? 'Loading…' : 'Nothing in the audit log for this filter yet.'));
    renderMore();
  }
  function renderMore() {
    more.replaceChildren(cursor ? h('button.btn.au-loadmore', { type: 'button', onclick: () => void loadMore() }, loading ? 'Loading…' : 'Load more') : events.length ? h('span.au-end', {}, 'The start of this range') : '');
  }
  function renderPill() {
    newPill.classList.toggle('hidden', !pending.length);
    newPill.textContent = `↑ ${pending.length} new event${pending.length === 1 ? '' : 's'}`;
  }
  function showPending() {
    events = [...pending, ...events];
    pending = [];
    renderPill();
    renderRows();
    table.scrollIntoView({ block: 'start', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  }

  // ---- Fetching ----------------------------------------------------------------------------------
  async function get(extra: Record<string, string | number | undefined>): Promise<AuditPage | undefined> {
    try {
      const res = await fetch(`/api/audit?${queryString(full(), Date.now(), extra)}`, { credentials: 'same-origin' });
      return res.ok ? ((await res.json()) as AuditPage) : undefined;
    } catch {
      return undefined;
    }
  }
  async function fetchFirst() {
    const my = ++gen;
    // "This floor" before the connection has said which floor that is: wait for floorChanged.
    if (scope === 'floor' && !opts.floor?.()) return void table.replaceChildren(h('p.au-empty', {}, 'Loading…'));
    loading = true;
    const r = rangeOf(filter, Date.now());
    const p = await get({ limit: PAGE, bucket: r.bucket });
    if (my !== gen) return;
    loading = false;
    page = p;
    events = p?.events ?? [];
    cursor = p?.nextCursor;
    pending = [];
    renderPill();
    renderHead();
    renderCounts();
    renderTimeline();
    renderRows();
    if (!p) table.append(h('p.au-empty', {}, "Couldn't load the audit log."));
  }
  async function loadMore() {
    if (!cursor || loading || !visible) return;
    const my = gen;
    loading = true;
    renderMore();
    const p = await get({ limit: PAGE, cursor });
    loading = false;
    if (my !== gen || !p) return renderMore();
    const seen = new Set(events.map((e) => e.id));
    events = [...events, ...p.events.filter((e) => !seen.has(e.id))];
    cursor = p.nextCursor;
    const o = rowOpts();
    table.querySelector('.au-empty')?.remove();
    table.append(...p.events.filter((e) => !seen.has(e.id)).map((e) => eventItem(e, o, open.has(e.id), toggle)));
    renderMore();
  }
  function changed() {
    save();
    renderBar();
    void fetchFirst();
  }

  return {
    show() {
      visible = true;
      // A link to an incident (Needs you, from the 2D view: /lite?tab=audit&incident=<id>).
      const asked = new URLSearchParams(location.search).get('incident');
      if (asked) return pickSub('incidents', asked);
      if (sub === 'incidents') return pickSub('incidents');
      incidents.count();
      renderBar();
      void fetchFirst();
    },
    hide() {
      visible = false;
      incidents.hide();
    },
    /** Opens an incident on the Incidents sub-tab (Needs you). */
    openIncident(id: string) {
      visible = true;
      pickSub('incidents', id);
    },
    /** The floor you're on changed (the 1D view): "This floor" follows it. */
    floorChanged() {
      incidents.floorChanged();
      if (visible && sub === 'events' && scope === 'floor') void fetchFirst();
    },
    onMessage(msg: ServerMsg) {
      incidents.onMessage(msg);
      if (msg.t !== 'audit.new' || !visible || !page) return;
      if (!fits(msg.event, msg.floor, full(), Date.now())) return;
      if (pending.some((e) => e.id === msg.event.id) || events.some((e) => e.id === msg.event.id)) return;
      pending = [msg.event, ...pending];
      page.total++;
      totalEl.textContent = `${page.total} events`;
      renderPill();
    },
  };
}

export type AuditView = ReturnType<typeof auditView>;
