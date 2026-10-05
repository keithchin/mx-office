// The 👷 Workers tab with its ranking: every worker graded A–F (GET /api/ranking, shared/ranking/),
// the podium and the full ranking, grouped by model or role if you like, and a card per worker: the
// live ones as the 1D view draws them (their terminal, a prompt) with their grade and Details added,
// the ones gone home from their records, dimmed. This floor or every floor; sorted by who needs you
// first, rank, name or most recent. No three.js: the 1D view imports it.

import type { WorkerInfo } from '../../../shared/protocol';
import { modelLabel } from '../../../shared/analysis';
import type { RankedWorker, RankingReport } from '../../../shared/ranking/report';
import { byUrgency } from '../../nextup';
import { waitingOnSomeone } from '../../notify';
import { h } from '../dom';
import { groupCards, howGraded, podium, table } from './board';
import { gradeBadge, rankFooter, recordCard } from './view';
import './ranking.css';

type Scope = 'floor' | 'all';
type Group = 'none' | 'model' | 'role';
type Sort = 'urgent' | 'rank' | 'name' | 'recent';

const KEY = 'agent-office.workers-ranking';
/** A look at the ranking is fetched again after this long, when the tab is drawn. */
const STALE_MS = 20_000;

interface Prefs {
  scope: Scope;
  group: Group;
  sort?: Sort;
  showGone: boolean;
}

function load(): Prefs {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    return { scope: v.scope === 'all' ? 'all' : 'floor', group: ['model', 'role'].includes(v.group) ? v.group : 'none', sort: ['urgent', 'rank', 'name', 'recent'].includes(v.sort) ? v.sort : undefined, showGone: v.showGone !== false };
  } catch {
    return { scope: 'floor', group: 'none', showGone: true };
  }
}

export interface RankingDeps {
  /** The tab's own column (holds the heading and the list). */
  root: HTMLElement;
  list: HTMLElement;
  floor: () => string | undefined;
  /** The 1D view's card for a live worker (lite.ts). */
  card: (w: WorkerInfo) => HTMLElement;
  visible: () => boolean;
  emptyText: () => string;
}

/** One card: a live worker, a worker known from its records, or both. */
interface Item {
  w?: WorkerInfo;
  r?: RankedWorker;
}

export function workersRanking(d: RankingDeps) {
  const prefs = load();
  const save = () => {
    try {
      localStorage.setItem(KEY, JSON.stringify(prefs));
    } catch {
      // just for this visit
    }
  };
  const reports = new Map<string, { at: number; report?: RankingReport; error?: string }>();
  const open = new Set<string>();
  let live: WorkerInfo[] = [];
  let loading = false;
  const top = h('div.rk-top');
  d.list.before(top);
  d.list.classList.add('rk-list');

  const scopeKey = () => (prefs.scope === 'all' || !d.floor() ? 'all' : d.floor()!);
  const current = () => reports.get(scopeKey());

  async function fetchReport() {
    const key = scopeKey();
    if (loading) return;
    loading = true;
    try {
      const res = await fetch(`/api/ranking?floor=${encodeURIComponent(key)}`, { credentials: 'same-origin' });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? `HTTP ${res.status}`);
      reports.set(key, { at: Date.now(), report: (await res.json()) as RankingReport });
    } catch (err) {
      reports.set(key, { at: Date.now(), report: reports.get(key)?.report, error: (err as Error).message });
    } finally {
      loading = false;
    }
    draw();
  }

  function render(workers: WorkerInfo[]) {
    live = workers;
    const c = current();
    if (d.visible() && (!c || Date.now() - c.at > STALE_MS)) void fetchReport();
    draw();
  }

  function items(r: RankingReport | undefined): Item[] {
    const here = d.floor();
    const out: Item[] = [];
    const used = new Set<string>();
    for (const w of live) {
      const match = r?.workers.find((x) => x.floor === here && x.workerIds.includes(w.id));
      if (match) used.add(match.key);
      out.push({ w, r: match });
    }
    for (const x of r?.workers ?? []) if (!used.has(x.key) && (prefs.showGone || !x.gone)) out.push({ r: x });
    return out;
  }

  function sorted(list: Item[], waiting: boolean): Item[] {
    const sort = prefs.sort ?? (waiting ? 'urgent' : 'rank');
    const name = (i: Item) => i.w?.name ?? i.r?.name ?? '';
    const score = (i: Item) => i.r?.score ?? -1;
    if (sort === 'urgent') {
      const order = new Map(byUrgency(live).map((w, n) => [w.id, n]));
      return [...list].sort((a, b) => (a.w ? order.get(a.w.id)! : 1e6) - (b.w ? order.get(b.w.id)! : 1e6) || score(b) - score(a));
    }
    if (sort === 'name') return [...list].sort((a, b) => name(a).localeCompare(name(b)));
    if (sort === 'recent') return [...list].sort((a, b) => (b.w ? Date.now() : (b.r?.lastSeen ?? 0)) - (a.w ? Date.now() : (a.r?.lastSeen ?? 0)) || (b.w?.createdAt ?? 0) - (a.w?.createdAt ?? 0));
    return [...list].sort((a, b) => score(b) - score(a) || name(a).localeCompare(name(b)));
  }

  function groupOf(i: Item): string {
    if (prefs.group === 'model') return i.r?.modelLabel ?? (i.w?.kind === 'agent' ? modelLabel(i.w.usage?.model ?? i.w.model ?? 'unknown') : 'Shells');
    return i.r?.roleLabel ?? (i.w?.kind === 'agent' ? 'Worker' : 'Shells');
  }

  function cardOf(i: Item, r: RankingReport | undefined): HTMLElement {
    const share = r?.specialistShare ?? 0.3;
    const scope = r?.scope ?? 'floor';
    const x = i.r;
    const toggle = () => {
      if (!x) return;
      if (open.has(x.key)) open.delete(x.key);
      else open.add(x.key);
      draw();
    };
    if (i.w) {
      const li = d.card(i.w);
      li.classList.add('rk-item');
      if (i.w.kind === 'agent') li.prepend(gradeBadge(x?.grade, x?.score));
      if (x) li.append(...rankFooter(x, scope, share, open.has(x.key), toggle));
      if (x) li.dataset.key = x.key;
      return li;
    }
    return h('li.lite-worker.rk-item', { class: x!.gone ? 'rk-gone' : '', 'data-key': x!.key }, gradeBadge(x!.grade, x!.score), recordCard(x!, scope), ...rankFooter(x!, scope, share, open.has(x!.key), toggle));
  }

  /** The podium or a table row picked: its card, opened and in view. */
  function pick(key: string) {
    open.add(key);
    if (!prefs.showGone) {
      prefs.showGone = true;
      save();
    }
    draw();
    const el = d.list.querySelector<HTMLElement>(`[data-key="${CSS.escape(key)}"]`);
    if (!el) return;
    el.scrollIntoView({ block: 'nearest', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    el.classList.remove('rk-flash');
    void el.offsetWidth;
    el.classList.add('rk-flash');
  }

  function toolbar(r: RankingReport | undefined, waiting: boolean): HTMLElement {
    const seg = <T extends string>(label: string, cur: T, opts: [T, string][], set: (v: T) => void) =>
      h('div.rk-seg', { role: 'group', 'aria-label': label }, ...opts.map(([v, t]) => h(`button.btn${v === cur ? '.on' : ''}`, { type: 'button', 'aria-pressed': String(v === cur), onclick: () => (set(v), save(), render(live)) }, t)));
    const sort = prefs.sort ?? (waiting ? 'urgent' : 'rank');
    const select = h(
      'select.rk-sort',
      { 'aria-label': 'Sort', onchange: (e: Event) => ((prefs.sort = (e.target as HTMLSelectElement).value as Sort), save(), draw()) },
      ...([['urgent', 'Needs you first'], ['rank', 'Rank'], ['name', 'Name'], ['recent', 'Recent']] as [Sort, string][]).map(([v, t]) => h('option', { value: v, selected: v === sort }, t)),
    );
    const gone = h('input', { type: 'checkbox', checked: prefs.showGone, onchange: (e: Event) => ((prefs.showGone = (e.target as HTMLInputElement).checked), save(), draw()) });
    const c = current();
    return h(
      'div.rk-bar',
      {},
      d.floor() ? seg('Scope', prefs.scope, [['floor', 'This floor'], ['all', 'All floors']], (v) => (prefs.scope = v)) : null,
      seg('Group by', prefs.group, [['none', 'No groups'], ['model', 'By model'], ['role', 'By role']], (v) => (prefs.group = v)),
      h('label.rk-label', {}, 'Sort ', select),
      h('label.rk-label.rk-check', {}, gone, ' Gone home'),
      c?.error ? h('span.rk-err', { title: c.error }, '⚠️ ranking unavailable') : !r ? h('span.rk-err', {}, 'Grading…') : null,
    );
  }

  function draw() {
    if (!d.visible()) return;
    const r = current()?.report;
    const waiting = live.some(waitingOnSomeone);
    const names = new Map((r?.workers ?? []).map((w) => [w.key, w.name]));
    top.replaceChildren(
      toolbar(r, waiting),
      ...(r
        ? [
            h('div.rk-board', {}, podium(r, pick) ?? h('p.rk-empty', {}, '🏁 No grades yet: a worker is graded once it finishes a task.'), table(r, pick)),
            ...(prefs.group !== 'none' ? [groupCards(prefs.group === 'model' ? r.byModel : r.byRole, names, prefs.group)] : []),
          ]
        : []),
    );
    const list = sorted(items(r), waiting);
    if (!list.length) return d.list.replaceChildren(h('li.lite-empty', {}, d.emptyText()));
    if (prefs.group === 'none') {
      d.list.replaceChildren(...list.map((i) => cardOf(i, r)));
    } else {
      const groups = new Map<string, Item[]>();
      for (const i of list) groups.set(groupOf(i), [...(groups.get(groupOf(i)) ?? []), i]);
      const stats = new Map((prefs.group === 'model' ? r?.byModel : r?.byRole)?.map((g) => [g.label, g]) ?? []);
      // Best average first, as the group cards are; groups without grades after.
      const keys = [...groups.keys()].sort((a, b) => (stats.get(b)?.avgScore ?? -1) - (stats.get(a)?.avgScore ?? -1) || a.localeCompare(b));
      d.list.replaceChildren(...keys.flatMap((k) => [h('li.rk-group-h', {}, h('span', {}, k), stats.get(k)?.avgGrade ? gradeBadge(stats.get(k)!.avgGrade, stats.get(k)!.avgScore, false) : null, h('small', {}, `${groups.get(k)!.length}`)), ...groups.get(k)!.map((i) => cardOf(i, r))]));
    }
    if (r) d.list.append(h('li.rk-how-li', {}, howGraded(r)));
  }

  // Every minute while it's showing: grades move as tasks finish.
  setInterval(() => d.visible() && void fetchReport(), 60_000);
  return { render };
}
