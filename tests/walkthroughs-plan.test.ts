// The start state of a test journey (shared/walkthroughs/start-state.ts) and the plan of a walkthrough batch
// (shared/walkthroughs/plan.ts): the structured `startState` field and the toolkit's prose in `$comment`
// (fresh database, run directly after, run before, not re-runnable, leaves data behind, time windows), ids
// that name no journey, templates; then the planner's groups (one fresh database each), chains, "run before"
// order, a single journey whose prerequisite is played first unfilmed, cycles and contradictions. Neutral
// sample journeys only (a request/approval app). A failure caused by a missing start state that the planner
// should have handled is a planner bug: the cases at the bottom keep those from coming back.
import test from 'node:test';
import assert from 'node:assert/strict';
import { chainAbove, planBatch, type PlanInput, type WalkPlan } from '../src/shared/walkthroughs/plan.js';
import { scriptOf } from '../src/shared/walkthroughs/script.js';
import { readStartState, resolveStartStates, windowNow, windowsIn } from '../src/shared/walkthroughs/start-state.js';

const STEPS = [{ name: 'Open the request list', actions: [{ do: 'nav', item: 'Requests' }] }];
/** A journey file as the toolkit writes it, run through scriptOf as the office does. */
function journey(id: string, comment: string[] | undefined, extra: Record<string, unknown> = {}, file = `tests/e2e/${id}.journey.json`): PlanInput {
  const s = scriptOf(file, JSON.stringify({ id, title: `Title ${id}`, ...(comment ? { $comment: comment } : {}), steps: STEPS, ...extra }));
  assert.equal(typeof s, 'object', String(s));
  return s as PlanInput;
}
const shape = (p: WalkPlan) => p.groups.map((g) => g.steps.map((s) => (s.setup ? `(${s.id})` : s.id)).join(' > '));
const skips = (p: WalkPlan) => p.skipped.map((k) => `${k.id}:${k.kind}`);

test('prose: fresh database, run directly after, run before, not re-runnable, leaves data behind', () => {
  const st = (c: string[]) => readStartState('x', 'tests/e2e/x.journey.json', { $comment: c });
  assert.deepEqual(st(['START STATE: fresh DB with the demo seed only (step 1 asserts it). NOT re-runnable: a second run finds the request already Submitted.']), { freshDb: true, notRerunnable: true, from: 'comment', notes: [] });
  assert.equal(st(['START STATE: run directly after submit-request (its Submitted request is the precondition).']).after, 'submit-request');
  assert.equal(st(['START STATE: run after `submit-request.journey.json`.']).after, 'submit-request');
  const c = st(['START STATE: fresh DB with the demo seed only; this journey leaves one Draft behind, so reset the DB before submit-request (or run submit-request first and skip this one).']);
  assert.deepEqual([c.freshDb, c.leavesData, c.after, c.before], [true, true, undefined, undefined], '“reset the DB before X” and “run X first” are no order');
  const d = st(['START STATE: fresh DB with the demo seed: exactly one Rejected request. Run BEFORE reject-request (which would create a second one).']);
  assert.deepEqual([d.freshDb, d.before], [true, ['reject-request']]);
  const e = st(['START STATE: any DB with at least one Submitted request. Run BEFORE approve-request on a fresh DB if you want both.']);
  assert.deepEqual([e.freshDb, e.before], [false, ['approve-request']], '“any DB” first: a fresh DB said later in the line is a condition, not a need');
  assert.deepEqual(st(['Environment: the app must be running on a fresh DB.', 'START STATE: any DB with at least one Submitted request.']).freshDb, false, 'the START STATE line decides over boilerplate elsewhere');
  const g = st(['Environment: the app must be running on a fresh DB.', 'The last step restores the language, so the run leaves no state behind.']);
  assert.deepEqual([g.freshDb, g.leavesData], [true, undefined], 'no START STATE line: the rest of the comment; “leaves no state behind” leaves nothing');
  assert.match(g.notes.join(), /no START STATE line/);
  const none = st(['Approve the first request.']);
  assert.deepEqual([none.freshDb, none.from], [false, 'none']);
  assert.match(none.notes[0], /shares a database/);
});

test('prose: time windows, with the zone they name', () => {
  assert.deepEqual(windowsIn('Time dependent: the open period is Day 07:30-20:00, Night 19:30-08:00 in Europe/Amsterdam. Do not run between 07:30-08:00 or 19:30-20:00 (both are open then).'), [
    { from: '07:30', to: '08:00', zone: 'Europe/Amsterdam' },
    { from: '19:30', to: '20:00', zone: 'Europe/Amsterdam' },
  ]);
  assert.deepEqual(windowsIn('Opens 07:30-20:00.'), [], 'times without a “do not run” are no window');
  const w = [{ from: '07:30', to: '08:00', zone: 'UTC' }];
  assert.equal(windowNow(w, new Date('2026-10-19T07:42:00Z'))?.clock, '07:42');
  assert.equal(windowNow(w, new Date('2026-10-19T07:27:00Z'))?.clock, '07:27', 'about to start: a recording takes a while');
  assert.equal(windowNow(w, new Date('2026-10-19T08:00:00Z')), undefined);
  assert.ok(windowNow([{ from: '23:00', to: '01:00', zone: 'UTC' }], new Date('2026-10-19T00:30:00Z')), 'across midnight');
  assert.equal(windowNow([{ from: '07:30', to: '08:00', zone: 'Mars/Base' }], new Date())?.zoneUnknown ?? true, true);
});

test('the structured startState field wins over the prose', () => {
  const s = readStartState('x', 'tests/e2e/x.journey.json', { startState: { freshDb: false, after: 'submit-request', before: ['approve-request'], rerunnable: false, leavesData: true, notRunBetween: ['22:00-23:00'], timeZone: 'Europe/Amsterdam' }, $comment: ['START STATE: fresh DB with the demo seed only.'] });
  assert.deepEqual(s, { freshDb: false, after: 'submit-request', before: ['approve-request'], notRerunnable: true, leavesData: true, windows: [{ from: '22:00', to: '23:00', zone: 'Europe/Amsterdam' }], from: 'field', notes: [] });
  assert.equal(readStartState('x', 'f', { startState: { freshDb: true } }).freshDb, true);
});

test('ids: by journey id or file stem, any case; one that names no journey is ignored with a note', () => {
  const list = [journey('submit-request', ['START STATE: fresh DB.'], {}, 'tests/e2e/01-submit.journey.json'), journey('a', ['START STATE: run directly after 01-SUBMIT.']), journey('b', ['START STATE: run directly after no-such-journey. Run BEFORE b.'])];
  const st = resolveStartStates(list);
  assert.equal(st.get('a')!.after, 'submit-request', 'the file stem names it too');
  assert.equal(st.get('b')!.after, undefined);
  assert.equal(st.get('b')!.before, undefined);
  assert.match(st.get('b')!.notes.join('\n'), /“no-such-journey”, but no journey of this commit is called that: ignored/);
  assert.match(st.get('b')!.notes.join('\n'), /itself: ignored/);
});

test('templates: example, skeleton*, broken controls and "template": true are listed, never planned', () => {
  const all = [journey('example', undefined, { steps: [] }), journey('skeleton', ['Walking skeleton.']), journey('skeleton-broken', ['Must fail.']), journey('starter', undefined, { template: true }), journey('submit-request', undefined)];
  const p = planBatch(all);
  assert.deepEqual(shape(p), ['submit-request']);
  assert.deepEqual(skips(p), ['example:template', 'skeleton:template', 'skeleton-broken:template', 'starter:template']);
  assert.match(p.skipped.find((k) => k.id === 'skeleton-broken')!.why, /broken control/);
  const q = planBatch([journey('submit-request', ['START STATE: run after skeleton.']), ...all.slice(1, 2)]);
  assert.deepEqual(shape(q), ['submit-request'], 'a template is never a prerequisite');
});

/** The sample app's journeys, shaped like a real project's: two chains, a fresh one, shared ones, templates. */
const SAMPLE = [
  journey('example', undefined, { steps: [] }),
  journey('duplicate-refused', ['START STATE: run directly after submit-request (its Submitted request is the precondition).', 'Do not run between 07:30-08:00 in Europe/Amsterdam.']),
  journey('submit-request', ['START STATE: fresh DB with the demo seed only. NOT re-runnable: a second run finds it Submitted.']),
  journey('photo-refused', ['START STATE: fresh DB with the demo seed only; this journey leaves one Draft behind, so reset the DB before submit-request.']),
  journey('resubmit', ['START STATE: fresh DB with the demo seed: exactly one Rejected request. Run BEFORE reject-request (which would create a second one).']),
  journey('language', ['Environment: the app must be running on a fresh DB.']),
  journey('skeleton', ['Walking skeleton.']),
  journey('skeleton-broken', ['Must fail.']),
  journey('approve-request', ['START STATE: any DB with at least one Submitted request.']),
  journey('reject-request', ['START STATE: any DB with at least one Submitted request. Run BEFORE approve-request on a fresh DB if you want both.']),
];

test('the planner: a full batch gives one group per fresh start, chains in order, shared journeys together, templates skipped', () => {
  const p = planBatch(SAMPLE);
  assert.deepEqual(shape(p), ['submit-request > duplicate-refused', 'photo-refused', 'resubmit > reject-request > approve-request', 'language']);
  assert.deepEqual(skips(p), ['example:template', 'skeleton:template', 'skeleton-broken:template']);
  assert.match(p.groups[2].why, /needs a fresh database and runs before/);
  assert.deepEqual(p.groups[0].steps[1].windows, [{ from: '07:30', to: '08:00', zone: 'Europe/Amsterdam' }]);
  assert.deepEqual(chainAbove(p.groups[0], 'duplicate-refused'), ['submit-request']);
  // Every journey in at most one place, never twice on one database (one is not re-runnable).
  const ids = p.groups.flatMap((g) => g.steps.map((s) => s.id));
  assert.equal(new Set(ids).size, ids.length);
});

test('the planner: one journey whose prerequisite isn’t selected plays that prerequisite first, unfilmed', () => {
  const p = planBatch(SAMPLE, ['duplicate-refused']);
  assert.deepEqual(shape(p), ['(submit-request) > duplicate-refused']);
  assert.deepEqual(skips(p), [], 'templates only listed when they were asked for (or for Re-record all)');
  const both = planBatch(SAMPLE, ['duplicate-refused', 'submit-request']);
  assert.deepEqual(shape(both), ['submit-request > duplicate-refused'], 'selected: filmed, not setup');
  // A longer chain: every journey above comes along.
  const chain = planBatch([journey('a', ['START STATE: fresh DB.']), journey('b', ['START STATE: run after a.']), journey('c', ['START STATE: run directly after b.'])], ['c']);
  assert.deepEqual(shape(chain), ['(a) > (b) > c']);
  assert.deepEqual(planBatch(SAMPLE, ['reject-request']).groups.map((g) => g.why), ['journeys that need no particular start state']);
});

test('the planner: run-before orders a shared group; one that leaves data behind goes last', () => {
  const p = planBatch([journey('z', ['START STATE: leaves a draft behind.']), journey('y', undefined), journey('x', ['START STATE: any DB. Run before y.'])]);
  assert.deepEqual(shape(p), ['x > y > z']);
  const kids = planBatch([journey('root', ['START STATE: fresh DB.']), journey('k2', ['START STATE: run after root.']), journey('k1', ['START STATE: run after root. Run before k2.'])]);
  assert.deepEqual(shape(kids), ['root > k1 > k2'], 'two journeys after the same one: by their run-before');
});

test('the planner: cycles and contradictions aren’t recorded, with the reason', () => {
  const loop = planBatch([journey('a', ['START STATE: run after b.']), journey('b', ['START STATE: run after a.']), journey('c', undefined)]);
  assert.deepEqual(shape(loop), ['c']);
  assert.deepEqual(skips(loop), ['a:conflict', 'b:conflict']);
  assert.match(loop.skipped[0].why, /circle/);
  const both = planBatch([journey('a', ['START STATE: any DB. Run before b.']), journey('b', ['START STATE: any DB. Run before a.']), journey('c', undefined)]);
  assert.deepEqual(shape(both), ['c']);
  assert.deepEqual(skips(both).sort(), ['a:conflict', 'b:conflict']);
  assert.match(both.skipped[0].why, /conflicting order/);
  const back = planBatch([journey('a', ['START STATE: fresh DB.']), journey('b', ['START STATE: run after a. Run before a.'])]);
  assert.deepEqual(shape(back), []);
  assert.match(back.skipped.map((k) => k.why).join(), /runs after it/);
});

// Planner bugs that once made a recording fail honestly at step 2: they must not come back.
test('regression: a journey that runs after another is never played first on a fresh database', () => {
  for (const sel of [undefined, ['duplicate-refused'], ['duplicate-refused', 'photo-refused']]) {
    const p = planBatch(SAMPLE, sel);
    const g = p.groups.find((x) => x.steps.some((s) => s.id === 'duplicate-refused'))!;
    const at = g.steps.findIndex((s) => s.id === 'duplicate-refused');
    assert.equal(g.steps[at - 1]?.id, 'submit-request', `played directly after its prerequisite (${sel ?? 'all'})`);
    assert.equal(g.steps[0].id, 'submit-request', 'and the prerequisite starts the fresh database');
  }
  const order = planBatch(SAMPLE).groups.flatMap((g) => g.steps.map((s) => s.id));
  assert.ok(order.indexOf('submit-request') < order.indexOf('duplicate-refused'), 'never alphabetical/file order');
});
