// The floor's run state on the page (server/project-run/): ONE control beside the budget chip on the
// flat views' top row (the 1D view's every tab, team pages included, and the 2D view's bar). It shows
// the state (▶ running, a green dot; ⏸ paused, who, when and why; ⏳ amber while a pause or resume
// run is going, with its progress) and, for admins, does the one thing that state allows: running →
// ⏸ Pause project (its confirm), paused → ▶ Resume (its preview), a run going → its progress window.
// The state's words are Home's (home/run-state-logic.ts: floorToggle). Home's one "Pause all / Resume
// all projects" button is home/run-state.ts. No three.js here.

import type { ProjectRunView } from '../../../shared/project-run';
import { floorToggle, goingRun } from '../../home/run-state-logic';
import { store } from '../../state';
import { runView } from './api';
import { openPause, openProgress, openResume } from './modal';
import { drawToggle, toggleEl } from './toggle';
import './project-run.css';

export { pacingSection, restartSetting } from './settings';
export { confirmHireAnyway } from './modal';

let view: ProjectRunView | undefined;
let viewFor: string | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;
let el: HTMLElement | undefined;
const time = (at: number) => new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

function draw() {
  if (!el) return;
  const floor = store.floor;
  const f = store.currentFloor();
  const t = floor && f && viewFor === floor ? floorToggle(f, view, time) : undefined;
  el = drawToggle(el, t, () => click(t?.action));
}

function click(action: 'pause' | 'resume' | 'progress' | undefined) {
  const floor = store.floor;
  if (!floor || !action) return;
  if (action === 'pause') {
    const name = store.project?.name ?? 'this project';
    const awake = [...store.workers.values()].filter((w) => w.kind === 'agent' && w.status !== 'exited' && w.status !== 'offline').map((w) => w.name);
    return openPause(floor, name, awake, refresh);
  }
  if (action === 'resume') return void openResume(floor, refresh);
  const run = goingRun(view);
  openProgress(floor, run?.kind === 'resume' ? '▶ Resuming' : '⏸ Pausing');
}

/** What the floor's run is now, asked again every 15 seconds (every 2 while a run is going) and after a click. */
async function refresh() {
  clearTimeout(timer);
  const floor = store.floor;
  if (floor && !document.hidden) {
    const v = await runView(floor);
    if (store.floor === floor && v) ((view = v), (viewFor = floor));
    draw();
  }
  timer = setTimeout(() => void refresh(), goingRun(view) ? 2_000 : 15_000);
}

/**
 * Puts the one control on the page, once: right after the project's budget chip (#budget-chip, in the
 * row ui/budget/chips.ts makes of the floor's line), or after the floor's line (#floor-meta) without one.
 */
export function mountRunToggle() {
  if (el) return;
  const after = document.getElementById('budget-chip') ?? document.getElementById('floor-meta');
  if (!after) return;
  el = toggleEl();
  after.after(el);
  store.on('floor', () => ((view = undefined), (viewFor = null), draw(), void refresh()));
  store.on('floors', draw);
  store.on('workers', draw);
  document.addEventListener('visibilitychange', () => !document.hidden && void refresh());
  void refresh();
  draw();
}
