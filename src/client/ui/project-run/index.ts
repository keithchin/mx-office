// ▶ Resume project and ⏸ Pause project on the page (server/project-run/): a small bar in the Command
// Center's heading and at the top of the team pages, with the floor's pause ("⏸ Paused by Keith at
// 14:05 · 2 waiting on you"), a progress chip while a run is going, and the two buttons (admins); and
// "Resume all / Pause all projects" on Home. No three.js here: the flat views and Home load it.

import { PAUSED_HIRES, pauseLine, type ProjectRunView } from '../../../shared/project-run';
import { store } from '../../state';
import { h, toast } from '../dom';
import { confirmDialog } from '../prompt';
import { allFloors, runPreview, runView } from './api';
import { openPause, openProgress, openResume } from './modal';
import './project-run.css';

export { pacingSection, restartSetting } from './settings';
export { confirmHireAnyway } from './modal';

let view: ProjectRunView | undefined;
let viewFor: string | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;
const bars = new Set<HTMLElement>();
const GOING = new Set(['pending', 'running', 'waiting', 'paused', 'interrupted', 'needs-attention']);
const time = (at: number) => new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

function draw() {
  const floor = store.floor;
  const v = viewFor === floor ? view : undefined;
  for (const bar of bars) {
    if (!floor || !v) {
      bar.replaceChildren();
      continue;
    }
    const going = v.run && GOING.has(v.run.status) ? v.run : undefined;
    const name = store.project?.name ?? 'this project';
    const awake = [...store.workers.values()].filter((w) => w.kind === 'agent' && w.status !== 'exited' && w.status !== 'offline').map((w) => w.name);
    const resume = h('button.btn.small.pr-btn', { type: 'button', class: v.pause ? 'primary' : '', title: 'Wake the agents that have work waiting, a few at a time, each with a short brief', onclick: () => void openResume(floor, refresh) }, '▶ Resume project');
    const pause = h('button.btn.small.pr-btn', { type: 'button', title: 'Let every agent finish its turn, write a handoff note and sleep; hold the office’s prompts', onclick: () => openPause(floor, name, awake, refresh) }, '⏸ Pause project');
    bar.replaceChildren(
      v.pause ? h('span.pr-paused', { title: `${PAUSED_HIRES}. Office prompts to this floor are held.${v.pause.waiting.length ? ` Waiting on you: ${v.pause.waiting.join(', ')}` : ''}` }, pauseLine(v.pause, time)) : '',
      going
        ? h('button.btn.small.pr-chip', { type: 'button', title: 'The run’s progress', onclick: () => openProgress(floor, going.kind === 'resume' ? '▶ Resuming' : '⏸ Pausing') }, progressText(going))
        : '',
      v.admin ? resume : '',
      v.admin && !v.pause && !going ? pause : '',
    );
  }
}

function progressText(r: NonNullable<ProjectRunView['run']>): string {
  const n = (s: string) => r.agents.filter((a) => a.status === s).length;
  return r.kind === 'resume' ? `▶ Resuming ${n('woken')}/${r.agents.length}${r.status === 'paused' ? ' · held' : ''}` : `⏸ Pausing ${n('asleep')}/${r.agents.length}${r.status === 'paused' ? ' · held' : ''}`;
}

async function refresh() {
  clearTimeout(timer);
  const floor = store.floor;
  if (floor) {
    const v = await runView(floor);
    if (store.floor === floor && v) ((view = v), (viewFor = floor));
    draw();
  }
  const going = view?.run && GOING.has(view.run.status);
  timer = setTimeout(() => void refresh(), going ? 2_000 : 15_000);
}

let watching = false;

/** The bar, appended into `host` (the Command Center's heading, a team page's head); the same one each time for that host. */
export function mountProjectRun(host: Element | null, key = 'summary') {
  if (!host) return;
  let bar = [...bars].find((b) => b.dataset.key === key);
  if (!bar) {
    bar = h('span.pr-bar', { 'data-key': key });
    bars.add(bar);
  }
  if (bar.parentElement !== host) host.append(bar);
  if (!watching) {
    watching = true;
    store.on('floor', () => ((view = undefined), draw(), void refresh()));
    void refresh();
  }
  draw();
}

/** Home's "▶ Resume all projects" and "⏸ Pause all projects" (admins). */
export function homeRunButtons(): HTMLElement | null {
  if (!store.me.admin || !store.floors.length) return null;
  const resume = h('button.btn.home-add', { type: 'button', title: 'Wake, on every floor, the agents that have work waiting (each floor’s preview defaults)' }, '▶ Resume all projects');
  const pause = h('button.btn.home-add', { type: 'button', title: 'Every floor’s agents finish their turn, hand off and sleep' }, '⏸ Pause all projects');
  resume.addEventListener('click', async () => {
    resume.setAttribute('disabled', '');
    const counts = await Promise.all(store.floors.map(async (f) => [f.name, (await runPreview(f.id))?.agents.filter((a) => a.action !== 'skip').length ?? 0] as const));
    resume.removeAttribute('disabled');
    const total = counts.reduce((n, [, c]) => n + c, 0);
    confirmDialog('▶ Resume all projects', `${counts.map(([n, c]) => `${n}: ${c}`).join(', ')}. Wakes ${total} agent${total === 1 ? '' : 's'} with work waiting, a few at a time on each floor.`, '▶ Resume all', () => void allFloors('resume').then((r) => r && toast('▶ Resuming every project')));
  });
  pause.addEventListener('click', () => {
    confirmDialog('⏸ Pause all projects', 'Agents finish their current turn, write a handoff note and sleep; office prompts are held until each is resumed. Your messages still go through.', '⏸ Pause all', () => void allFloors('pause').then((r) => r && toast('⏸ Pausing every project')));
  });
  return h('span.seg.pr-home', {}, resume, pause);
}
