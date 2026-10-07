// Home's ⏸ / ▶ state (home/run-state.ts), as pure functions: which one button "Pause all / Resume all
// projects" is, and the state icon on each project's card and over each floor in the 2D Overview, from
// every floor's GET /api/project-run. No DOM, so tests/home-run-state.test.ts can check every case.

import type { PauseInfo, ProjectRunView, RunAgent, RunProgress } from '../../shared/project-run';
import type { FloorInfo } from '../../shared/protocol';

/** A run's statuses while it's still going (the flow engine's, and a held one). */
export const GOING = new Set(['pending', 'running', 'waiting', 'paused', 'interrupted', 'needs-attention']);
/** An agent's line that's still to finish in a run. */
const UNDONE = new Set<RunAgent['status']>(['pending', 'starting', 'finishing', 'handoff']);

/** The floor's run, if one is going. */
export const goingRun = (v: ProjectRunView | undefined): RunProgress | undefined => (v?.run && GOING.has(v.run.status) ? v.run : undefined);

/** How far a run is: its agents done, of all of them. */
export function runCount(r: RunProgress): { done: number; total: number } {
  return { done: r.agents.filter((a) => !UNDONE.has(a.status)).length, total: r.agents.length };
}

export type CardStateKind = 'paused' | 'running' | 'pausing' | 'resuming';

/** A card's icon: which, its words (the aria-label) and its tooltip. */
export interface CardState {
  kind: CardStateKind;
  /** The emoji other themes show (Clean draws its line icon instead: ui/clean/). */
  icon: string;
  label: string;
  title: string;
}

/** "Paused by Keith at 14:05", with why: the budget, a safe restart, or a person. */
export function pausedTitle(p: PauseInfo, time: (at: number) => string): string {
  const head = p.why === 'budget' ? `Paused at ${time(p.at)}: budget reached` : p.why === 'restart' ? `Paused by ${p.by} at ${time(p.at)} for a safe restart` : `Paused by ${p.by} at ${time(p.at)}`;
  return `${head}${p.waiting.length ? ` · ${p.waiting.length} waiting on you (${p.waiting.join(', ')})` : ''}`;
}

const agents = (n: number) => `${n} agent${n === 1 ? '' : 's'}`;

/** "2 agents working, 3 asleep" (and who waits on you), from the floor's numbers. */
export function runningTitle(f: Pick<FloorInfo, 'workers' | 'busy' | 'waiting'>): string {
  const asleep = Math.max(0, f.workers - f.busy - f.waiting);
  return `Running: ${agents(f.busy)} working, ${asleep} asleep${f.waiting ? `, ${f.waiting} waiting on you` : ''}`;
}

/**
 * A floor's state icon: a run going wins (amber, "Pausing 2 of 4"), then a pause (who, when, why),
 * else running. None for a floor still being cloned, or whose state hasn't come yet.
 */
export function cardState(f: Pick<FloorInfo, 'workers' | 'busy' | 'waiting' | 'cloning'>, v: ProjectRunView | undefined, time: (at: number) => string): CardState | undefined {
  if (f.cloning || !v) return undefined;
  const run = goingRun(v);
  if (run) {
    const { done, total } = runCount(run);
    const pausing = run.kind === 'pause';
    const what = pausing ? 'Pausing' : 'Resuming';
    return { kind: pausing ? 'pausing' : 'resuming', icon: '⏳', label: `${what}: ${done} of ${agents(total)}`, title: `${what}${run.by ? ` (${run.by})` : ''}: ${done} of ${agents(total)} done${run.status === 'paused' ? ' · held' : ''}` };
  }
  if (v.pause) {
    const title = pausedTitle(v.pause, time);
    return { kind: 'paused', icon: '⏸', label: title, title };
  }
  const title = runningTitle(f);
  return { kind: 'running', icon: '▶', label: title, title };
}

/** Home's one button: what it says and does, and the "▶ Resume N paused" beside it when it's mixed. */
export interface ToggleState {
  /** What a click does (none while a run's going: the button shows its progress, disabled). */
  action: 'pause' | 'resume' | 'busy';
  label: string;
  title: string;
  /** Mixed: the paused floors, to resume in one click. */
  resumePaused?: string[];
  /** For someone who isn't an admin: the state in words, and no button. */
  admin: boolean;
}

/**
 * Pause all when any project isn't paused, Resume all when every one is, and while a run is going
 * its progress ("Pausing… 3 of 7"), with no click. Undefined with no projects to pause.
 */
export function toggleState(floors: Pick<FloorInfo, 'id' | 'cloning'>[], views: ReadonlyMap<string, ProjectRunView>, admin: boolean): ToggleState | undefined {
  const live = floors.filter((f) => !f.cloning);
  if (!live.length) return undefined;
  const runs = live.map((f) => goingRun(views.get(f.id))).filter((r): r is RunProgress => !!r);
  if (runs.length) {
    const pausing = runs.some((r) => r.kind === 'pause');
    const mine = runs.filter((r) => (r.kind === 'pause') === pausing);
    const { done, total } = mine.map(runCount).reduce((a, b) => ({ done: a.done + b.done, total: a.total + b.total }), { done: 0, total: 0 });
    const what = pausing ? 'Pausing' : 'Resuming';
    return { action: 'busy', label: `${pausing ? '⏸' : '▶'} ${what}… ${done} of ${total}`, title: `${what} ${mine.length} project${mine.length === 1 ? '' : 's'}: ${done} of ${agents(total)} done`, admin };
  }
  const paused = live.filter((f) => views.get(f.id)?.pause).map((f) => f.id);
  if (paused.length === live.length) {
    return { action: 'resume', label: '▶ Resume all projects', title: 'Every project is paused. Wake, on every floor, the agents that have work waiting (each floor’s preview defaults)', admin };
  }
  return {
    action: 'pause',
    label: '⏸ Pause all projects',
    title: paused.length ? `${paused.length} of ${live.length} projects are paused. Every other floor’s agents finish their turn, hand off and sleep` : 'Every floor’s agents finish their turn, hand off and sleep',
    resumePaused: paused.length ? paused : undefined,
    admin,
  };
}

/** For someone who isn't an admin: the building's state in words. */
export function stateWords(t: ToggleState, paused: number, total: number): string {
  if (t.action === 'busy') return t.label;
  if (t.action === 'resume') return '⏸ Every project is paused';
  return paused ? `⏸ ${paused} of ${total} projects paused` : '▶ Every project is running';
}
