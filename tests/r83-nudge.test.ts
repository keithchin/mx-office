// Release 83, P3: the automatic back-to-work nudge re-pasted a Lead's stale original task about ten times while its
// test chain ran, each costing a turn. No nudge (back-to-work or review) while the agent's tests, journeys or app
// instance run in the office's background, and never the old task's words once it was told more since. Pure rules.
import test from 'node:test';
import assert from 'node:assert/strict';
import { BACK_GRACE_MS, backToWorkDue, staleSince, type BackLook } from '../src/server/roster/back-to-work.js';
import { NUDGE_GRACE_MS, nudgeDue } from '../src/server/roster/nudge.js';
import { backToWorkLatestPrompt, backToWorkPrompt } from '../src/server/roster/prompts.js';
import { backgroundWords, noteRun } from '../src/server/agent-app/background.js';

const look = (o: Partial<BackLook> = {}): BackLook => ({ enabled: true, level: 2, phase: 'active', status: 'done', viewers: 0, task: 'Build rows 4 to 6 of the build plan', escalated: false, inStandup: false, studio: false, queued: 0, idleAt: 0, nudges: [], now: BACK_GRACE_MS, ...o });

test('no back-to-work nudge while its tests, journeys or instance run in the background; the nudge again once they end', () => {
  assert.equal(backToWorkDue(look()), 'nudge');
  // Ten stops during a test chain: not one nudge.
  for (let i = 0; i < 10; i++) assert.equal(backToWorkDue(look({ idleAt: i * 60_000, now: i * 60_000 + BACK_GRACE_MS, background: 'its microflow tests at @abc1234 are running' })), 'background');
  assert.equal(backToWorkDue(look({ background: undefined })), 'nudge');
});

test('no review nudge either while its background work runs', () => {
  const base = { enabled: true, hasTeam: true, phase: 'active' as const, status: 'done' as const, idleAt: 0, turnAt: 0, subagentAt: 1, inStandup: false, now: NUDGE_GRACE_MS + 1 };
  assert.equal(nudgeDue(base), 'nudge');
  assert.equal(nudgeDue({ ...base, background: 'its journeys are running' }), 'background');
});

test('what counts as background work: its own test run (not another agent’s), its journeys, a single run, its instance starting', () => {
  assert.equal(backgroundWords('Blake', { tests: { running: true, by: 'Blake', commit: 'abc1234def' } }), 'its microflow tests at @abc1234 are running');
  assert.equal(backgroundWords('Blake', { tests: { running: true, by: 'Casey' } }), undefined, "another agent's run isn't its own");
  assert.equal(backgroundWords('Blake', { journeys: true }), 'its journeys are running');
  assert.equal(backgroundWords('Blake', { single: true }), 'a journey or smoke run of its is under way');
  assert.equal(backgroundWords('Blake', { instance: 'starting' }), 'its app instance is starting');
  assert.equal(backgroundWords('Blake', { instance: 'ready' }), undefined);
  noteRun('p', 'w', true);
  noteRun('p', 'w', false);
});

test('an outdated task is never re-pasted: told more since, the nudge sends the latest instruction', () => {
  assert.equal(staleSince(1_000, undefined), undefined);
  assert.equal(staleSince(1_000, { by: 'Agent Office', at: 9_000 }), undefined, "the office's own nudges don't make it stale");
  assert.equal(staleSince(1_000, { by: 'Pat Morgan', at: 1_500 }), undefined, 'the prompt that gave the task');
  assert.deepEqual(staleSince(1_000, { by: 'Casey', at: 60_000 }), { by: 'Casey', at: 60_000 });
  const old = 'Build rows 1 to 3 of the build plan (original brief)';
  const words = backToWorkLatestPrompt({ by: 'Casey', at: Date.UTC(2026, 10, 2, 9, 30) }, 'tsk_01ABC');
  assert.ok(!words.includes(old));
  assert.match(words, /latest instruction you were given \(from Casey, 2026-11-02 09:30 UTC\)/);
  assert.match(words, /task done` for tsk_01ABC/);
  assert.match(words, /not nudged while they run/);
  assert.match(backToWorkPrompt(old), /You stopped with Build rows 1 to 3/, 'a current task is still named');
});
