// Phased delivery, the pure rules (shared/phases/): the team's drafts checked, edits applied with done phases
// locked, their words for the history, exit criteria from recorded checks, the office moving a phase on, the
// soft budget badge, the timeline's dates and overlaps, and spend shared out to the phases. Neutral example data.
import test from 'node:test';
import assert from 'node:assert/strict';
import { applyOps, checkDrafts, cleanPlan, kindOf, opsWords, phasesOfDrafts, readOps } from '../src/shared/phases/plan.js';
import { advance, budgetBadge, exitOf, spans, DAY_MS } from '../src/shared/phases/derive.js';
import { phaseSpend } from '../src/shared/phases/spend.js';
import { bands, rangeOf, ticks } from '../src/shared/phases/timeline.js';
import { buildHeadline, buildView } from '../src/shared/phases/view.js';
import type { Phase, PhaseDraft } from '../src/shared/phases/types.js';
import { emptyPlan } from '../src/shared/phases/types.js';

const NOW = Date.UTC(2026, 9, 30, 12);
const drafts: PhaseDraft[] = [
  { name: 'Look and feel', goal: 'Tokens and page layouts', foundation: true, rows: [1, 2, 3], journeys: ['J-00'], estimate: { min: 25, max: 40 } },
  { name: 'Data and access', goal: 'Entities, roles, sign-in', foundation: true, rows: [4, 5], journeys: ['J-01'], estimate: { min: 35, max: 50 } },
  { name: 'Bookings', goal: 'People book a room and see it', rows: [6, 7, 8, 9], journeys: ['J-02', 'J-03'], estimate: { min: 90, max: 130 } },
  { name: 'Reports', goal: 'Managers see usage', rows: [10, 11], journeys: ['J-04'], estimate: { min: 40, max: 70 } },
];

test('drafts: a row and a journey belong to one phase; a name is needed', () => {
  assert.equal((checkDrafts(drafts) as PhaseDraft[]).length, 4);
  assert.match(checkDrafts([drafts[0], { ...drafts[1], rows: [3] }]) as string, /Row 3 is in two phases/);
  assert.match(checkDrafts([drafts[0], { ...drafts[1], journeys: ['J-00'] }]) as string, /Journey J-00 is in two phases.*regression/);
  assert.match(checkDrafts([{ ...drafts[0], name: '' }]) as string, /needs a name/);
  assert.match(checkDrafts([]) as string, /Give the phases/);
});

test('edits: move rows, split, merge, reorder, toggles; done phases locked', () => {
  const ps = phasesOfDrafts(drafts);
  ps[0].status = 'done';
  ps[1].status = 'active';
  const moved = applyOps(ps, [{ op: 'move-rows', rows: [9], to: 'ph-4' }], NOW) as Phase[];
  assert.deepEqual(moved[2].rows, [6, 7, 8]);
  assert.deepEqual(moved[3].rows, [9, 10, 11]);
  assert.match(applyOps(ps, [{ op: 'move-rows', rows: [1], to: 'ph-3' }], NOW) as string, /done phases are locked/);
  assert.match(applyOps(ps, [{ op: 'rename', phase: 'ph-1', name: 'X' }], NOW) as string, /locked/);
  assert.match(applyOps(ps, [{ op: 'reorder', order: ['ph-2', 'ph-1', 'ph-3', 'ph-4'] }], NOW) as string, /keep their place/);
  const split = applyOps(ps, [{ op: 'split', phase: 'ph-3', rows: [8, 9], name: 'Waitlist' }], NOW) as Phase[];
  assert.equal(split.length, 5);
  assert.deepEqual(split[3].rows, [8, 9]);
  assert.equal(split[3].id, 'ph-5');
  assert.equal(split[2].estimate.min + split[3].estimate.min, 90, 'the estimate is shared out');
  const merged = applyOps(ps, [{ op: 'merge', phases: ['ph-3', 'ph-4'] }], NOW) as Phase[];
  assert.equal(merged.length, 3);
  assert.deepEqual(merged[2].rows, [6, 7, 8, 9, 10, 11]);
  assert.deepEqual(merged[2].estimate, { min: 130, max: 200 });
  const off = applyOps(ps, [{ op: 'toggle', phase: 'ph-3', checkpoint: false }, { op: 'toggle', phase: 'ph-4', checkpoint: false }], NOW) as Phase[];
  assert.equal(off[2].checkpoint, false);
  assert.equal(opsWords([{ op: 'toggle', phase: 'ph-3', checkpoint: false }, { op: 'toggle', phase: 'ph-4', checkpoint: false }], ps), 'Checkpoint turned off for 3 Bookings and 4 Reports');
  assert.equal(opsWords([{ op: 'move-rows', rows: [9], to: 'ph-4' }], ps), 'Moved row 9 from 3 Bookings to 4 Reports');
  assert.equal(kindOf([{ op: 'move-rows', rows: [9], to: 'ph-4' }]), 'move-rows');
  assert.equal(kindOf([{ op: 'move-rows', rows: [9], to: 'ph-4' }, { op: 'rename', phase: 'ph-3', name: 'B' }]), 'edit');
});

test('overlap: a planned phase starts early while one runs; journeys stay with one phase', () => {
  const ps = phasesOfDrafts(drafts);
  assert.match(applyOps(ps, [{ op: 'overlap', phase: 'ph-4', teams: ['design'], what: 'design' }], NOW) as string, /No phase is in progress/);
  ps[2].status = 'active';
  const o = applyOps(ps, [{ op: 'overlap', phase: 'ph-4', teams: ['design'], what: 'design' }], NOW) as Phase[];
  assert.deepEqual(o[3].early, { since: NOW, teams: ['design'], what: 'design' });
  assert.deepEqual(o[2].overlapsWith, ['ph-4']);
  const j = applyOps(ps, [{ op: 'journeys', phase: 'ph-4', journeys: ['J-03', 'J-04'] }], NOW) as Phase[];
  assert.deepEqual(j[2].journeys, ['J-02']);
});

test('ops from a request are cleaned; unknown ones dropped', () => {
  assert.deepEqual(readOps([{ op: 'move-rows', rows: ['9', 9, -1], to: 'ph-4' }, { op: 'explode' }]), [{ op: 'move-rows', rows: [9], to: 'ph-4' }]);
  assert.match(readOps([{ op: 'explode' }]) as string, /None of the ops/);
});

test('a stored plan reads back safely', () => {
  const p = cleanPlan({ state: 'approved', delivery: 'phases', phases: [{ id: 'ph-1', name: 'A', rows: [3, 1, 'x'], estimate: { min: 50, max: 10 }, status: 'weird' }], changes: [], proposals: [] });
  assert.equal(p.phases[0].status, 'planned');
  assert.deepEqual(p.phases[0].rows, [1, 3]);
  assert.deepEqual(p.phases[0].estimate, { min: 50, max: 50 });
  assert.equal(cleanPlan('nonsense').state, 'none');
});

test('exit criteria from recorded checks only; the office moves a met phase on', () => {
  const ps = phasesOfDrafts(drafts);
  const x = { commit: 'abc1234', journeyResults: { 'J-02': 'passed', 'J-03': 'passed' } as Record<string, 'passed' | 'failed'>, modelCheck: { status: 'pass' as const, errors: 0, commit: 'abc1234' }, openDataImpacts: 0 };
  assert.equal(exitOf(ps[2], x, NOW).met, true);
  assert.equal(exitOf(ps[2], { ...x, openDataImpacts: 1 }, NOW).met, false);
  assert.equal(exitOf(ps[2], { ...x, modelCheck: undefined as never }, NOW).modelCheck.status, 'none');
  assert.deepEqual(exitOf(ps[3], x, NOW).journeys, { 'J-04': 'owed' });
  ps[2].status = 'active';
  ps[2].startedAt = NOW - 3 * DAY_MS;
  ps[2].checkpoint = false;
  const moved = advance(ps, new Map([['ph-3', exitOf(ps[2], x, NOW)]]), NOW);
  assert.deepEqual(moved.map((m) => [m.phase, m.to, m.started]), [['ph-3', 'done', 'ph-1']]);
  assert.equal(ps[0].status, 'active', 'the first planned phase starts');
  const ps2 = phasesOfDrafts(drafts);
  ps2[0].status = 'active';
  const cp = advance(ps2, new Map([['ph-1', exitOf(ps2[0], { ...x, journeyResults: { 'J-00': 'passed' } }, NOW)]]), NOW);
  assert.equal(cp[0].to, 'checkpoint');
  assert.equal(ps2[1].status, 'planned', 'nothing starts while a checkpoint waits');
});

test('the soft budget badge: in range, pace, over, upper half', () => {
  const p = { status: 'active' as const, estimate: { min: 90, max: 130 } };
  assert.deepEqual(budgetBadge(p, 30, 0.5), { kind: 'ok', text: 'In range' });
  assert.deepEqual(budgetBadge(p, 65, 0.5), { kind: 'pace', text: 'Pace $130', projected: 130 });
  assert.equal(budgetBadge({ status: 'done', estimate: { min: 35, max: 50 } }, 55, 1).text, 'Over by $5');
  assert.equal(budgetBadge({ status: 'checkpoint', estimate: { min: 90, max: 130 } }, 120, 1).text, 'Upper half');
  assert.equal(budgetBadge({ status: 'planned', estimate: { min: 1, max: 2 } }, 0, 0).kind, 'none');
  assert.equal(budgetBadge(p, 65, 0.1).kind, 'ok', 'too early to project');
});

test('timeline: actual dates for started phases, forecast after; overlap band and weekly ticks', () => {
  const ps = phasesOfDrafts(drafts);
  ps[0] = { ...ps[0], status: 'done', startedAt: NOW - 10 * DAY_MS, endedAt: NOW - 7 * DAY_MS };
  ps[1] = { ...ps[1], status: 'done', startedAt: NOW - 7 * DAY_MS, endedAt: NOW - 3 * DAY_MS };
  ps[2] = { ...ps[2], status: 'active', startedAt: NOW - 3 * DAY_MS, overlapsWith: ['ph-4'] };
  ps[3] = { ...ps[3], early: { since: NOW, teams: ['design'], what: 'design' }, overlapsWith: ['ph-3'] };
  const sp = spans(ps, (p) => (p.id === 'ph-3' ? 2 : 0), NOW, ps[0].startedAt);
  assert.equal(sp.get('ph-1')!.actual, true);
  assert.ok(sp.get('ph-3')!.end > NOW, 'the active phase ends after today');
  assert.ok(sp.get('ph-4')!.start >= sp.get('ph-3')!.end);
  assert.ok(sp.get('ph-4')!.earlyFrom! < sp.get('ph-4')!.start);
  const view = buildView({ floor: 'f', admin: true, now: NOW, plan: { ...emptyPlan(), state: 'approved', delivery: 'phases', phases: ps }, planRows: [], planPhases: [], done: new Set([6, 7]), journeys: [], exit: { journeyResults: {}, openDataImpacts: 0 }, spend: { rows: [], days: {}, agents: {}, teamOf: () => undefined, dayOf: (t) => new Date(t).toISOString().slice(0, 10) }, merges: [{ pr: 41, sha: 'a1', title: 'Rows 6-7: booking list', at: NOW, rows: [6, 7] }], stage: '5' });
  const b = bands(view.phases);
  assert.equal(b.length, 1);
  assert.match(b[0].label, /^Overlap 3 ↔ 4 · /);
  assert.equal(view.phases[2].merges[0].pr, 41);
  assert.equal(buildHeadline(view).text, 'Build · Bookings (3 of 4)');
  const r = rangeOf(view);
  assert.ok(r.from < NOW && r.to > NOW);
  assert.ok(ticks(r).every((t) => new Date(t.at).getDay() === 1));
});

test('spend: Discovery and Cutover by stage, a running phase by day, early teams to the early phase, coordination not tied', () => {
  const day = (t: number) => new Date(t).toISOString().slice(0, 10);
  const ps = phasesOfDrafts(drafts);
  ps[0] = { ...ps[0], status: 'done', startedAt: Date.UTC(2026, 9, 20), endedAt: Date.UTC(2026, 9, 22) };
  ps[1] = { ...ps[1], status: 'active', startedAt: Date.UTC(2026, 9, 23) };
  ps[2] = { ...ps[2], early: { since: Date.UTC(2026, 9, 25), teams: ['design'], what: 'design' } };
  const agents = { dev: { role: 'Lead Developer', kind: 'worker' }, des: { role: 'Lead Designer', kind: 'worker' }, pm: { role: 'Project Coordinator', kind: 'worker' }, sub: { role: 'developer', kind: 'subagent', lead: 'dev' }, bg: { role: 'Office background', kind: 'background' } };
  const team: Record<string, string> = { 'Lead Developer': 'development', 'Lead Designer': 'design', 'Project Coordinator': 'management' };
  const s = phaseSpend({
    rows: [
      { day: '2026-10-10', agent: 'dev', stage: '2', cost: 10 },
      { day: '2026-10-18', agent: 'dev', stage: '4', cost: 5 },
      { day: '2026-10-21', agent: 'dev', stage: '5', cost: 20 },
      { day: '2026-10-24', agent: 'sub', stage: '5', cost: 7 },
      { day: '2026-10-26', agent: 'des', stage: '5', cost: 4 },
      { day: '2026-10-26', agent: 'pm', stage: '5', cost: 3 },
      { day: '2026-10-26', agent: 'bg', stage: '5', cost: 1 },
      { day: '2026-10-29', agent: 'dev', stage: '6', cost: 2 },
    ],
    days: { '2026-09-01': { stage: { '1': 6 } } },
    agents,
    phases: ps,
    teamOf: (r) => team[r],
    dayOf: day,
  });
  assert.deepEqual(s.byPhase, { 'ph-1': 20, 'ph-2': 7, 'ph-3': 4, 'ph-4': 0 });
  assert.equal(s.discovery, 21, 'stages P–3, Stage 4 before the first phase, and the old rollup');
  assert.equal(s.cutover, 2);
  assert.equal(s.unassigned, 4, 'coordination and background');
  assert.equal(s.total, 58);
});
