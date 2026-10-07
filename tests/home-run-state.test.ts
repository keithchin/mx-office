// Home's ⏸ / ▶ state (src/client/home/run-state-logic.ts): the one Pause all / Resume all button with
// every project running, every one paused, a mix, and a run going; admins against everyone else; and
// each project card's state icon, the pause's reasons among it.
import test from 'node:test';
import assert from 'node:assert/strict';
import type { PauseInfo, ProjectRunView, RunAgent, RunProgress } from '../src/shared/project-run.js';
import { cardState, pausedTitle, runningTitle, stateWords, toggleState } from '../src/client/home/run-state-logic.js';

const time = (at: number) => `T${at}`;
const pacing = { concurrent: 2, gapSec: 45 };
const floors = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
const pause = (why: PauseInfo['why'] = 'person', waiting: string[] = []): PauseInfo => ({ by: 'Keith', at: 1405, why, waiting });
const run = (kind: RunProgress['kind'], statuses: RunAgent['status'][], status = 'running'): RunProgress => ({
  runId: 'r',
  kind,
  floor: 'a',
  status,
  by: 'Keith',
  startedAt: 1,
  agents: statuses.map((s, i) => ({ name: `A${i}`, action: kind === 'pause' ? 'pause' : 'wake', status: s })),
});
const view = (floor: string, extra: Partial<ProjectRunView> = {}): ProjectRunView => ({ floor, pacing, admin: true, ...extra });
const views = (...vs: ProjectRunView[]) => new Map(vs.map((v) => [v.floor, v]));

test('every project running: one ⏸ Pause all projects, nothing to resume', () => {
  const t = toggleState(floors, views(view('a'), view('b'), view('c')), true)!;
  assert.equal(t.action, 'pause');
  assert.equal(t.label, '⏸ Pause all projects');
  assert.equal(t.resumePaused, undefined);
  assert.equal(stateWords(t, 0, 3), '▶ Every project is running');
});

test('every project paused: one ▶ Resume all projects', () => {
  const t = toggleState(floors, views(view('a', { pause: pause() }), view('b', { pause: pause('budget') }), view('c', { pause: pause('restart') })), true)!;
  assert.equal(t.action, 'resume');
  assert.equal(t.label, '▶ Resume all projects');
  assert.equal(stateWords(t, 3, 3), '⏸ Every project is paused');
});

test('a mix: ⏸ Pause all projects, and ▶ Resume N paused for the paused ones', () => {
  const t = toggleState(floors, views(view('a', { pause: pause() }), view('b'), view('c', { pause: pause('budget') })), true)!;
  assert.equal(t.action, 'pause');
  assert.equal(t.label, '⏸ Pause all projects');
  assert.deepEqual(t.resumePaused, ['a', 'c']);
  assert.match(t.title, /2 of 3 projects are paused/);
  assert.equal(stateWords(t, 2, 3), '⏸ 2 of 3 projects paused');
});

test('a floor whose state has not come yet counts as running; one being cloned is left out', () => {
  assert.equal(toggleState(floors, views(view('a', { pause: pause() }), view('b', { pause: pause() })), true)!.action, 'pause');
  const t = toggleState([...floors.slice(0, 2), { id: 'c', cloning: true }], views(view('a', { pause: pause() }), view('b', { pause: pause() })), true)!;
  assert.equal(t.action, 'resume');
  assert.equal(toggleState([{ id: 'x', cloning: true }], new Map(), true), undefined);
  assert.equal(toggleState([], new Map(), true), undefined);
});

test('a run going: its progress, with no click', () => {
  const t = toggleState(floors, views(view('a', { run: run('pause', ['asleep', 'asleep', 'finishing']) }), view('b', { run: run('pause', ['waiting-on-you', 'pending', 'handoff', 'pending']) }), view('c')), true)!;
  assert.equal(t.action, 'busy');
  assert.equal(t.label, '⏸ Pausing… 3 of 7');
  const r = toggleState(floors, views(view('a', { run: run('resume', ['woken', 'starting']) }), view('b'), view('c')), true)!;
  assert.equal(r.label, '▶ Resuming… 1 of 2');
  assert.equal(stateWords(r, 0, 3), '▶ Resuming… 1 of 2');
  // A finished run is history, not progress.
  assert.equal(toggleState(floors, views(view('a', { run: run('pause', ['asleep'], 'done'), pause: pause() }), view('b'), view('c')), true)!.action, 'pause');
});

test('admins get the button; everyone else the same state, marked not admin', () => {
  const vs = views(view('a', { pause: pause() }), view('b'), view('c'));
  assert.equal(toggleState(floors, vs, true)!.admin, true);
  const t = toggleState(floors, vs, false)!;
  assert.equal(t.admin, false);
  assert.equal(t.action, 'pause');
});

test('a card: paused, with who, when and why', () => {
  const f = { workers: 3, busy: 1, waiting: 0 };
  const p = cardState(f, view('a', { pause: pause() }), time)!;
  assert.equal(p.kind, 'paused');
  assert.equal(p.icon, '⏸');
  assert.equal(p.title, 'Paused by Keith at T1405');
  assert.equal(p.label, p.title);
  assert.equal(cardState(f, view('a', { pause: pause('budget') }), time)!.title, 'Paused at T1405: budget reached');
  assert.equal(cardState(f, view('a', { pause: pause('restart') }), time)!.title, 'Paused by Keith at T1405 for a safe restart');
  assert.equal(pausedTitle(pause('person', ['Anita']), time), 'Paused by Keith at T1405 · 1 waiting on you (Anita)');
});

test('a card: running, with who is working and who is asleep', () => {
  const r = cardState({ workers: 5, busy: 2, waiting: 0 }, view('a'), time)!;
  assert.equal(r.kind, 'running');
  assert.equal(r.icon, '▶');
  assert.equal(r.title, 'Running: 2 agents working, 3 asleep');
  assert.equal(runningTitle({ workers: 4, busy: 1, waiting: 1 }), 'Running: 1 agent working, 2 asleep, 1 waiting on you');
});

test('a card: pausing or resuming wins over the pause, amber; none before its state comes or while cloning', () => {
  const f = { workers: 2, busy: 0, waiting: 0 };
  const p = cardState(f, view('a', { pause: pause(), run: run('pause', ['asleep', 'finishing']) }), time)!;
  assert.equal(p.kind, 'pausing');
  assert.equal(p.label, 'Pausing: 1 of 2 agents');
  assert.equal(cardState(f, view('a', { run: run('resume', ['woken'], 'paused') }), time)!.kind, 'resuming');
  assert.match(cardState(f, view('a', { run: run('resume', ['woken'], 'paused') }), time)!.title, /held/);
  assert.equal(cardState(f, undefined, time), undefined);
  assert.equal(cardState({ ...f, cloning: true }, view('a'), time), undefined);
});
