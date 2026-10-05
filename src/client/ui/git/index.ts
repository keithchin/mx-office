// The 🌳 Git tab on the 1D view: the floor's branches as a metro map (draw.ts). The default branch is
// the trunk line, every other branch a line of its own leaving it where it forked, with its worker's
// robot at the tip and its pull request beside it. It asks GET /api/git (server/gitgraph/) when the tab
// shows, a few seconds after the workers or pull requests change, and every minute while it's on
// screen; the workers and pull requests themselves come from the store, so they're never behind.
// No three.js here: the flat views import it.

import { ownerInfo, ownerOf, pullInfo, pullOf, STALE_BEHIND, type GitBranch, type GitGraph } from '../../../shared/gitgraph';
import type { GhPull, WorkerInfo } from '../../../shared/protocol';
import { store } from '../../state';
import { h } from '../dom';
import { commitCard, drawMap, tipCard, type MapActions, type Tip } from './draw';
import { tally } from './layout';
import './git.css';

/** How often the map asks again while it's on screen, and how long it waits after the store changes. */
const EVERY_MS = 60_000;
const SETTLE_MS = 4000;

export interface GitViewDeps {
  openWorker(id: string): void;
  openPull(p: GhPull): void;
}

export interface GitView {
  show(): void;
  hide(): void;
}

/** The branches with the store's workers and pull requests on them (fresher than the server's). */
export function withLive(g: GitGraph, workers: Iterable<WorkerInfo>, pulls: readonly GhPull[]): GitGraph {
  const ws = [...workers];
  const branches = g.branches.map((b): GitBranch => {
    const w = ownerOf(b.name, ws);
    const p = pullOf(b.name, pulls);
    const next = { ...b, worker: w ? ownerInfo(w) : b.worker, pr: p ? pullInfo(p) : b.pr };
    if (next.pr?.state === 'MERGED') next.merged = true;
    return next;
  });
  return { ...g, branches };
}

export function gitView(root: HTMLElement, deps: GitViewDeps): GitView {
  root.classList.add('gp');
  let visible = false;
  let graph: GitGraph | null = null;
  let error: string | null = null;
  let loading = false;
  let asked = 0;
  let timer: ReturnType<typeof setInterval> | undefined;
  let settle: ReturnType<typeof setTimeout> | undefined;
  /** Scrolled to the newest commits once per floor; after that, where you left it. */
  let scrolledFor: string | null = null;

  const tipEl = h('div.gp-tip.hidden', { role: 'tooltip' });
  const place = (at: MouseEvent | HTMLElement) => {
    const box = root.getBoundingClientRect();
    const r = at instanceof MouseEvent ? { x: at.clientX, y: at.clientY } : (({ left, bottom }) => ({ x: left, y: bottom }))(at.getBoundingClientRect());
    const w = Math.min(300, box.width - 16);
    const x = Math.max(8, Math.min(r.x - box.left + 14, box.width - w - 8));
    tipEl.style.left = `${x}px`;
    tipEl.style.top = `${r.y - box.top + 16}px`;
    tipEl.style.width = `${w}px`;
  };
  const tip: Tip = {
    branch(b, at) {
      if (tipEl.dataset.key !== b.name) tipEl.replaceChildren(tipCard(b));
      tipEl.dataset.key = b.name;
      tipEl.classList.remove('hidden');
      place(at);
    },
    commit(c, at) {
      if (tipEl.dataset.key !== c.sha) tipEl.replaceChildren(commitCard(c));
      tipEl.dataset.key = c.sha;
      tipEl.classList.remove('hidden');
      place(at);
    },
    hide() {
      tipEl.classList.add('hidden');
      tipEl.dataset.key = '';
    },
  };

  const actions: MapActions = {
    opens: (b) => !!(b.worker && store.workers.has(b.worker.id)) || !!(b.pr && store.pulls.items.some((p) => p.number === b.pr!.number)),
    open(b) {
      tip.hide();
      if (b.worker && store.workers.has(b.worker.id)) return deps.openWorker(b.worker.id);
      const p = b.pr && store.pulls.items.find((x) => x.number === b.pr!.number);
      if (p) deps.openPull(p);
    },
  };

  async function refresh() {
    const floor = store.floor;
    if (!visible) return;
    if (!floor) {
      graph = null;
      error = null;
      return render();
    }
    const mine = ++asked;
    loading = true;
    if (!graph || graph.floor !== floor) render();
    try {
      const res = await fetch(`/api/git?floor=${encodeURIComponent(floor)}`, { credentials: 'same-origin' });
      const body = (await res.json().catch(() => null)) as (GitGraph & { error?: string }) | null;
      if (!res.ok || !body) throw new Error(body?.error ?? `HTTP ${res.status}`);
      if (mine !== asked) return;
      graph = body;
      error = null;
    } catch (err) {
      if (mine !== asked) return;
      error = (err as Error).message;
    } finally {
      if (mine === asked) loading = false;
    }
    render();
  }

  function render() {
    if (!visible) return;
    tip.hide();
    const floor = store.floor;
    if (!floor) return root.replaceChildren(empty('🗺️', 'No floor picked', 'Pick a floor up top and its branches grow here.'));
    if (error && (!graph || graph.floor !== floor)) {
      return root.replaceChildren(empty('🚧', 'The tracks are blocked', `Couldn't read this floor's branches: ${error}`, h('button.btn', { type: 'button', onclick: () => void refresh() }, '🔄 Try again')));
    }
    if (!graph || graph.floor !== floor) return root.replaceChildren(empty('🚂', 'Laying the tracks…', 'Asking git about the branches.'));
    const g = withLive(graph, store.workers.values(), store.pulls.items);
    const old = root.querySelector<HTMLElement>('.gp-scroll');
    const keep = old ? { left: old.scrollLeft, top: old.scrollTop } : null;
    const scroll = h('div.gp-scroll', { tabindex: 0, 'aria-label': 'Branch map: scroll sideways for more' }, drawMap(g, actions, tip));
    scroll.addEventListener('scroll', () => tip.hide(), { passive: true });
    root.replaceChildren(strip(g), scroll, legend(), foot(g), tipEl);
    if (scrolledFor !== floor) {
      // The newest commits are on the right: start there.
      scrolledFor = floor;
      requestAnimationFrame(() => (scroll.scrollLeft = scroll.scrollWidth));
    } else if (keep) {
      scroll.scrollLeft = keep.left;
      scroll.scrollTop = keep.top;
    }
  }

  function strip(g: GitGraph): HTMLElement {
    const t = tally(g.branches, STALE_BEHIND);
    return h(
      'div.gp-strip',
      {},
      h('span.gp-stat', {}, h('b', {}, String(t.branches)), t.branches === 1 ? ' branch' : ' branches'),
      h('span.gp-stat', {}, h('b', {}, String(t.withPr)), ' with open PRs'),
      h('span.gp-stat', { class: t.stale ? 'warn' : undefined, title: `More than ${STALE_BEHIND} commits behind ${g.defaultBranch}` }, h('b', {}, String(t.stale)), ' stale'),
      h('span.gp-stat.main', {}, 'default: ', h('code', {}, g.defaultBranch)),
      h('button.btn.gp-refresh', { type: 'button', title: 'Ask git again', 'aria-label': 'Refresh', class: loading ? 'busy' : undefined, onclick: () => void refresh() }, '🔄'),
    );
  }

  function foot(g: GitGraph): HTMLElement {
    const bits: string[] = [];
    if (!g.branches.length) bits.push(`🌱 Only ${g.defaultBranch} here so far. Hire a worker and its branch sprouts off the trunk.`);
    if (g.hidden.merged) bits.push(`🧹 ${g.hidden.merged} old merged ${g.hidden.merged === 1 ? 'branch' : 'branches'} tucked away`);
    if (g.hidden.more) bits.push(`➕ ${g.hidden.more} more not shown`);
    if (g.fetchError) bits.push(`📡 Couldn't fetch origin (${g.fetchError}): showing what's here`);
    return h('p.gp-foot', {}, bits.join(' · '));
  }

  let redraw: ReturnType<typeof setTimeout> | undefined;
  const kick = () => {
    if (!visible) return;
    // The robots and pills follow the store straight away; git is asked again once things settle.
    clearTimeout(redraw);
    redraw = setTimeout(render, 250);
    clearTimeout(settle);
    settle = setTimeout(() => void refresh(), SETTLE_MS);
  };
  store.on('workers', kick);
  store.on('pulls', kick);
  store.on('floor', () => {
    graph = null;
    error = null;
    void refresh();
  });

  return {
    show() {
      if (visible) return;
      visible = true;
      void refresh();
      timer = setInterval(() => void refresh(), EVERY_MS);
    },
    hide() {
      visible = false;
      clearInterval(timer);
      clearTimeout(settle);
      clearTimeout(redraw);
      tip.hide();
    },
  };
}

function legend(): HTMLElement {
  const item = (sym: HTMLElement | string, text: string) => h('span.gp-key', {}, sym, text);
  return h(
    'div.gp-legend',
    { 'aria-label': 'Legend' },
    item(h('i.gp-k-trunk'), 'default branch'),
    item(h('i.gp-k-st'), 'commit'),
    item(h('i.gp-k-merge'), 'merge'),
    item(h('i.gp-k-lane'), 'branch'),
    item('✅', 'merged'),
    item('🕸️', 'stale'),
    item(h('span.gp-pr.pass'), 'checks pass'),
    item(h('span.gp-pr.fail'), 'fail'),
    item(h('span.gp-pr.pending'), 'pending'),
    item(h('span.gp-pr.draft'), 'draft'),
    item('✨', 'working'),
    item('🙋', 'needs you'),
    item('🎉', 'done'),
  );
}

function empty(icon: string, title: string, text: string, ...more: HTMLElement[]): HTMLElement {
  return h('div.gp-empty', {}, h('div.gp-empty-ico', {}, icon), h('b', {}, title), h('p', {}, text), ...more);
}
