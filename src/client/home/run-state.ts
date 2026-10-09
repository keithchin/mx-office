// Home's ⏸ / ▶ state: every floor's pause and run (GET /api/project-run, as the Command Center's bar
// reads it: ui/project-run/), kept up to date for the page. There's no push for it, so it's asked
// again every 15 seconds, every 2 while a run is going, and straight after a click. It draws the one
// "⏸ Pause all / ▶ Resume all projects" button (admins; the state in words for everyone else) and the
// state icon on each project's card; the 2D Overview reads `homeRunState` for its banners.
// The words and which-is-which are pure, in run-state-logic.ts.

import type { ProjectRunView } from '../../shared/project-run';
import { store } from '../state';
import { h, toast } from '../ui/dom';
import { confirmDialog } from '../ui/prompt';
import { allFloors, runPreview, runView, startResume } from '../ui/project-run/api';
import { cardState, goingRun, stateWords, toggleState, type CardState } from './run-state-logic';

const IDLE_MS = 15_000;
const GOING_MS = 2_000;
const time = (at: number) => new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

const views = new Map<string, ProjectRunView>();
const toggles = new Set<HTMLElement>();
const icons = new Map<HTMLElement, string>();
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setTimeout> | undefined;
let started = false;
let fetching = false;

/** A floor's icon state now (the 2D Overview's banners), or undefined before its state comes. */
export function homeRunState(floor: string): CardState | undefined {
  start();
  const f = store.floors.find((x) => x.id === floor);
  return f ? cardState(f, views.get(floor), time) : undefined;
}

/** Hear every change (the Overview redraws its banners). */
export function onHomeRunState(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

async function refresh() {
  clearTimeout(timer);
  if (!document.hidden && !fetching) {
    fetching = true;
    try {
      const floors = store.floors.filter((f) => !f.cloning);
      const got = await Promise.all(floors.map(async (f) => [f.id, await runView(f.id)] as const));
      const ids = new Set(floors.map((f) => f.id));
      for (const id of views.keys()) if (!ids.has(id)) views.delete(id);
      for (const [id, v] of got) if (v) views.set(id, v);
    } finally {
      fetching = false;
    }
    draw();
  }
  const going = [...views.values()].some((v) => goingRun(v));
  timer = setTimeout(() => void refresh(), going ? GOING_MS : IDLE_MS);
}

function start() {
  if (started) return;
  started = true;
  let known = '';
  // A floor added or gone: ask again; the numbers moving (busy, waiting) just redraw the icons' tooltips.
  store.on('floors', () => {
    const now = store.floors.map((f) => `${f.id}${f.cloning ? '…' : ''}`).join(',');
    if (now !== known) ((known = now), void refresh());
    else draw();
  });
  document.addEventListener('visibilitychange', () => !document.hidden && void refresh());
  void refresh();
}

/** Asks for every floor's state again now (the Portal cards' Pause and Resume, home/portal.ts). */
export const refreshHomeRunState = () => void refresh();

/** Ask again soon after a click, so its run shows. */
const soon = () => setTimeout(() => void refresh(), 600);

function confirmResume(floors: { id: string; name: string }[], title: string) {
  return async (btn: HTMLElement) => {
    btn.setAttribute('disabled', '');
    const counts = await Promise.all(floors.map(async (f) => [f.name, (await runPreview(f.id))?.agents.filter((a) => a.action !== 'skip').length ?? 0] as const));
    btn.removeAttribute('disabled');
    const total = counts.reduce((n, [, c]) => n + c, 0);
    const all = floors.length === store.floors.filter((f) => !f.cloning).length;
    confirmDialog(title, `${counts.map(([n, c]) => `${n}: ${c}`).join(', ')}. Wakes ${total} agent${total === 1 ? '' : 's'} with work waiting, a few at a time on each floor.`, all ? '▶ Resume all' : '▶ Resume', () => {
      const go = all ? allFloors('resume').then((r) => !!r) : Promise.all(floors.map((f) => startResume(f.id, { mode: 'work' }))).then((r) => r.some(Boolean));
      void go.then((ok) => ok && (toast(all ? '▶ Resuming every project' : `▶ Resuming ${floors.length} paused project${floors.length === 1 ? '' : 's'}`), soon()));
    });
  };
}

function pauseAll() {
  confirmDialog('⏸ Pause all projects', 'Agents finish their current turn, write a handoff note and sleep; office prompts are held until each is resumed. Your messages still go through.', '⏸ Pause all', () =>
    void allFloors('pause').then((r) => r && (toast('⏸ Pausing every project'), soon())),
  );
}

function drawToggle(host: HTMLElement) {
  const t = toggleState(store.floors, views, store.me.admin);
  if (!t) return host.replaceChildren();
  const live = store.floors.filter((f) => !f.cloning);
  if (!t.admin) {
    const paused = live.filter((f) => views.get(f.id)?.pause).length;
    return host.replaceChildren(h('span.home-run-words', { role: 'status', title: t.title }, stateWords(t, paused, live.length)));
  }
  const main = h('button.btn.home-add.home-run-toggle', { type: 'button', title: t.title, class: t.action === 'busy' ? 'busy' : '', disabled: t.action === 'busy' ? '' : undefined, 'aria-live': 'polite' }, t.label);
  if (t.action === 'pause') main.addEventListener('click', pauseAll);
  else if (t.action === 'resume') main.addEventListener('click', () => void confirmResume(live, '▶ Resume all projects')(main));
  const paused = t.resumePaused ? live.filter((f) => t.resumePaused!.includes(f.id)) : [];
  const more = paused.length
    ? h('button.home-run-more', { type: 'button', title: `Resume only the paused ones: ${paused.map((f) => f.name).join(', ')}` }, `▶ Resume ${paused.length} paused`)
    : null;
  more?.addEventListener('click', () => void confirmResume(paused, `▶ Resume ${paused.length} paused project${paused.length === 1 ? '' : 's'}`)(more));
  host.replaceChildren(main, more ?? '');
}

function drawIcon(el: HTMLElement, floor: string) {
  const s = homeRunState(floor);
  el.className = `home-run-state${s ? ` ${s.kind}` : ' hidden'}`;
  el.textContent = s?.icon ?? '';
  if (s) {
    el.title = s.title;
    el.setAttribute('aria-label', s.label);
  } else {
    el.removeAttribute('title');
    el.removeAttribute('aria-label');
  }
}

function draw() {
  for (const t of toggles) if (!t.isConnected) toggles.delete(t);
  for (const el of icons.keys()) if (!el.isConnected) icons.delete(el);
  toggles.forEach(drawToggle);
  icons.forEach((floor, el) => drawIcon(el, floor));
  listeners.forEach((fn) => fn());
}

/** The Projects tab's button (or, for someone who isn't an admin, the state in words). */
export function homeRunToggle(): HTMLElement | null {
  start();
  if (!store.floors.length) return null;
  const host = h('span.home-run', {});
  toggles.add(host);
  drawToggle(host);
  return host;
}

/** A card's state icon: ⏸ paused, ▶ running, ⏳ (amber) pausing or resuming; Clean draws line icons. */
export function homeRunIcon(floor: string): HTMLElement {
  start();
  const el = h('span', { role: 'img' });
  icons.set(el, floor);
  drawIcon(el, floor);
  return el;
}
