import test from 'node:test';
import assert from 'node:assert/strict';
import type { RunRecord } from '../src/shared/analysis.js';
import { combine, criterion, gradeOf, relDiff, relRatio, type WorkerFacts } from '../src/shared/ranking/model.js';
import { autonomy, baselineOf, benchmark, delivery, efficiency, STANDARD_WEIGHTS } from '../src/shared/ranking/standard.js';
import { SPECIALIST, SPECIALIST_SHARE, specialistOf } from '../src/shared/ranking/specialist.js';
import { buildRanking, overallOf, ranksWithin, ruleHighlights } from '../src/shared/ranking/report.js';
import { gatherFacts, roleResolver } from '../src/server/ranking/facts.js';
import { ROLES } from '../src/shared/roster/roles.js';
import type { Escalation } from '../src/shared/roster/escalation.js';
import type { RosterData } from '../src/server/roster/store.js';

function run(over: Partial<RunRecord> = {}): RunRecord {
  const workerId = over.workerId ?? 'w1';
  return {
    id: `f1:${workerId}`,
    floor: 'f1',
    worker: 'Byte',
    workerId,
    provider: 'claude',
    model: 'claude-sonnet-5-5',
    modelLabel: 'Sonnet 5.5',
    title: 'A task',
    prompt: '',
    startedAt: 1_000,
    endedAt: 1_000 + 30 * 60_000,
    durationMs: 30 * 60_000,
    activeMs: 10 * 60_000,
    apiCalls: 40,
    toolCalls: 40,
    tokens: { input: 1000, output: 2000, cacheWrite: 1000, cacheRead: 8000 },
    cost: 1,
    humanPrompts: 0,
    needsInput: 0,
    needsInputMs: 0,
    outcome: 'merged',
    pr: { number: 7, url: '', title: 'Pages', state: 'MERGED', additions: 10, deletions: 1, checks: 'pass' },
    types: ['ui-pages'],
    typesBy: 'keywords',
    updatedAt: 1,
    ...over,
  };
}

function facts(over: Partial<WorkerFacts> = {}): WorkerFacts {
  return { key: 'f1:w1', floor: 'f1', floorName: 'Floor 1', workerIds: ['w1'], name: 'Byte', role: 'worker', model: 'claude-sonnet-5-5', modelLabel: 'Sonnet 5.5', gone: true, lastSeen: 1, runs: [run()], liveInputs: 0, escalations: [], proposals: [], ...over };
}

function esc(over: Partial<Escalation> = {}): Escalation {
  return { id: 'e1', at: 0, workerId: 'w1', by: 'Byte', urgency: 'important', fyi: false, level: 2, title: 'x', details: '', options: [], status: 'resolved', resolution: { verdict: 'approve', text: '', by: 'PM', at: 10 * 60_000, delivered: true }, ...over } as Escalation;
}

test('grade boundaries are A ≥ 90, B ≥ 80, C ≥ 70, D ≥ 60, else F (no E)', () => {
  assert.equal(gradeOf(100), 'A');
  assert.equal(gradeOf(90), 'A');
  assert.equal(gradeOf(89.9), 'B');
  assert.equal(gradeOf(80), 'B');
  assert.equal(gradeOf(70), 'C');
  assert.equal(gradeOf(60), 'D');
  assert.equal(gradeOf(59.9), 'F');
  assert.equal(gradeOf(0), 'F');
});

test('peer curves: on par is 75, double is 100, half is 50', () => {
  assert.equal(relRatio(1), 75);
  assert.equal(relRatio(2), 100);
  assert.equal(relRatio(0.5), 50);
  assert.equal(relRatio(0), 0);
  assert.equal(relDiff(0), 75);
  assert.equal(relDiff(20), 100);
  assert.equal(relDiff(-20), 50);
  assert.equal(relDiff(-100), 0);
});

test('the standard weights add up to one, and so does every role table', () => {
  assert.equal(Math.round(Object.values(STANDARD_WEIGHTS).reduce((a, b) => a + b, 0) * 1000), 1000);
  for (const r of ROLES) assert.equal(Math.round(SPECIALIST[r.id].reduce((a, c) => a + c.weight, 0) * 1000), 1000, r.id);
});

test('a criterion with no data is left out of the average, and the others scaled up', () => {
  const none = criterion('x', 'X', 0.5, [], 'low', 'nothing');
  assert.equal(none.score, undefined);
  assert.equal(none.missing, 'nothing');
  const a = { ...criterion('a', 'A', 0.25, [{ value: 0.8, weight: 1, line: '' }], 'high', ''), weight: 0.25 };
  const b = { ...criterion('b', 'B', 0.25, [{ value: 0.4, weight: 1, line: '' }], 'high', ''), weight: 0.25 };
  assert.equal(combine([a, none]), 80);
  assert.equal(combine([a, b, none]), 60);
  assert.equal(combine([none]), undefined);
});

test('delivery: merged with green CI is full marks; a closed PR is rework', () => {
  assert.equal(delivery(facts()).score, 100);
  const closed = delivery(facts({ runs: [run({ outcome: 'closed', pr: { number: 3, url: '', title: '', state: 'CLOSED', additions: 0, deletions: 0, checks: 'fail' } })] }));
  assert.ok(closed.score! < 20, String(closed.score));
  assert.ok(closed.evidence.some((e) => /rework/.test(e)));
});

test('delivery: a Lead without PRs of its own is not enough data, an ordinary worker without one scores zero', () => {
  const nopr = run({ outcome: 'no-pr', pr: undefined });
  assert.equal(delivery(facts({ role: 'lead-designer', runs: [nopr] })).score, undefined);
  assert.equal(delivery(facts({ runs: [nopr] })).score, 0);
  // A false start (excluded) doesn't count either way.
  assert.equal(delivery(facts({ runs: [run({ outcome: 'no-pr', pr: undefined, excluded: 'trivial' })] })).score, undefined);
});

test('autonomy: each person stepping in halves, thirds… the main part; warranted escalations help a worker', () => {
  assert.equal(autonomy(facts()).score, 100);
  assert.equal(autonomy(facts({ runs: [run({ humanPrompts: 1 })] })).score, 50);
  const dismissed = autonomy(facts({ escalations: [esc({ resolution: { verdict: 'dismiss', text: '', by: 'PM', at: 1, delivered: true } })] }));
  assert.equal(dismissed.score, 75);
  // A Lead's escalations count in its specialist ranking instead.
  assert.equal(autonomy(facts({ role: 'lead-developer', escalations: [esc({ resolution: { verdict: 'dismiss', text: '', by: 'PM', at: 1, delivered: true } })] })).score, 100);
});

test('benchmark: above its model average scores above 75; no peers is not enough data', () => {
  const me = facts({ runs: [run()] });
  assert.equal(benchmark(me, baselineOf(me.runs, [me])).score, undefined);
  const weak = run({ id: 'f1:w2', workerId: 'w2', outcome: 'open', humanPrompts: 3, cost: 4, activeMs: 40 * 60_000 });
  const b = benchmark(me, baselineOf([...me.runs, weak], [me]));
  assert.ok(b.score! > 75, String(b.score));
  assert.equal(b.confidence, 'low');
});

test('efficiency: churn without anything delivered scores near zero; delivering at the median is a C', () => {
  const churn = facts({ runs: [run({ outcome: 'no-pr', pr: undefined, tokens: { input: 1, output: 1, cacheWrite: 0, cacheRead: 0 } })] });
  const other = facts({ key: 'f1:w2', runs: [run({ workerId: 'w2', id: 'f1:w2' })] });
  const base = baselineOf([...churn.runs, ...other.runs], [churn, other]);
  assert.ok(efficiency(churn, base).score! < 20);
  // The only one delivering is the median itself: 75 on both ratios, plus its cache hits.
  const e = efficiency(other, base);
  assert.ok(e.score! >= 70 && e.score! <= 80, String(e.score));
});

test('specialist: criteria the office does not record are marked, data-driven per role', () => {
  const lead = facts({ role: 'lead-developer', escalations: [esc(), esc({ id: 'e2', resolution: { verdict: 'dismiss', text: '', by: 'PM', at: 1, delivered: true } })], team: { standups: [], leadEscalations: [], floorRuns: [], teamPrs: { merged: 3, closed: 1, open: 0, checksPass: 3, checksFail: 1 } } });
  const sp = specialistOf(lead)!;
  assert.equal(sp.criteria.length, SPECIALIST['lead-developer'].length);
  assert.match(sp.criteria.find((c) => c.key === 'review-turnaround')!.missing!, /doesn't record/);
  assert.equal(sp.criteria.find((c) => c.key === 'escalation-precision')!.score, 50);
  assert.equal(sp.criteria.find((c) => c.key === 'throughput')!.score, 75);
  assert.equal(sp.criteria.find((c) => c.key === 'build')!.score, 75);
  assert.equal(specialistOf(facts()), undefined);
  const pm = specialistOf(facts({ role: 'pm', team: { standups: [{ startedAt: 0, compiledAt: 10 * 60_000, status: 'compiled' }, { startedAt: 0, status: 'collecting' }], leadEscalations: [esc({ role: 'lead-tester' })], floorRuns: [] } }))!;
  assert.equal(pm.criteria.find((c) => c.key === 'standups')!.score, 50);
  assert.equal(pm.criteria.find((c) => c.key === 'unblock')!.score, 100);
});

test('overall: the specialist ranking counts its share for team roles', () => {
  const std = [{ key: 'a', label: 'A', weight: 1, score: 80, evidence: [] }];
  assert.equal(overallOf(std), 80);
  assert.equal(overallOf(std, { label: '', score: 60, criteria: [] }), 80 * (1 - SPECIALIST_SHARE) + 60 * SPECIALIST_SHARE);
  assert.equal(overallOf([], { label: '', score: 60, criteria: [] }), 60);
});

test('ranks within groups: by model and floor, ungraded left out', () => {
  const ws = [
    { key: 'a', name: 'A', score: 90, tasks: 1, m: 'Opus' },
    { key: 'b', name: 'B', score: 70, tasks: 1, m: 'Sonnet' },
    { key: 'c', name: 'C', score: 80, tasks: 1, m: 'Sonnet' },
    { key: 'd', name: 'D', score: undefined, tasks: 0, m: 'Sonnet' },
  ];
  const all = ranksWithin(ws, () => 'all');
  assert.deepEqual([...all.rank], [['a', 1], ['c', 2], ['b', 3]]);
  const byModel = ranksWithin(ws, (w) => w.m);
  assert.equal(byModel.rank.get('c'), 1);
  assert.equal(byModel.rank.get('b'), 2);
  assert.equal(byModel.of.get('Sonnet'), 2);
  assert.equal(byModel.rank.get('d'), undefined);
});

test('buildRanking: everyone ranked, floor scope filtered, groups averaged, trend from history', () => {
  const runs = [run(), run({ id: 'f1:w2', workerId: 'w2', worker: 'Ada', outcome: 'open', humanPrompts: 2 }), run({ id: 'f2:w3', floor: 'f2', workerId: 'w3', worker: 'Max', model: 'claude-opus-5-5', modelLabel: 'Opus 5.5' })];
  const fs = gatherFacts([], runs);
  const r = buildRanking(fs, runs, { floors: [], previous: (k) => (k === 'f1:w1' ? 50 : undefined), floor: 'f1' });
  assert.equal(r.workers.length, 2);
  assert.equal(r.workers[0].name, 'Byte');
  assert.equal(r.workers[0].rank.floor, 1);
  assert.equal(r.workers[0].rank.of.global, 3);
  assert.ok(r.workers[0].trend! > 0);
  assert.equal(r.byModel.length, 1);
  assert.equal(r.byModel[0].count, 2);
  assert.ok(r.workers[0].highlights.some((h) => /Merged PR #7/.test(h.text)));
});

test('facts: a team role is one entry across its hires, and roles come from the roster', () => {
  const roster = { members: Object.fromEntries(ROLES.map((r) => [r.id, { name: r.id === 'lead-developer' ? 'Hedy' : `N-${r.id}`, model: 'sonnet', phase: 'active', workerId: r.id === 'lead-developer' ? 'w9' : undefined }])), escalations: [esc({ workerId: 'w8', role: 'lead-developer' })], proposals: [], standups: [], settings: { autonomy: 2 } } as unknown as RosterData;
  const resolve = roleResolver(roster);
  assert.equal(resolve('w9', 'x'), 'lead-developer');
  assert.equal(resolve('w8', 'x'), 'lead-developer');
  assert.equal(resolve('w7', 'Hedy'), 'lead-developer');
  assert.equal(resolve('w6', 'Bob'), 'worker');
  const runs = [run({ id: 'f1:w8', workerId: 'w8', worker: 'Hedy' }), run({ id: 'f1:w9', workerId: 'w9', worker: 'Hedy' })];
  const fs = gatherFacts([{ id: 'f1', name: 'F1', workers: [], pulls: [], roster }], runs);
  assert.equal(fs.length, 1);
  assert.equal(fs[0].key, 'f1:role:lead-developer');
  assert.equal(fs[0].runs.length, 2);
  assert.equal(fs[0].escalations.length, 1);
});

test('rule highlights come from the evidence only', () => {
  const f = facts();
  const hs = ruleHighlights(f, []);
  assert.ok(hs.length >= 1 && hs.length <= 4);
  assert.ok(hs.every((h) => h.by === 'rules'));
  assert.deepEqual(ruleHighlights(facts({ runs: [] }), []), []);
});

test('a false start or a task still going is not graded; a coordinator is not benchmarked on PRs it never opens', () => {
  const trivial = facts({ runs: [run({ outcome: 'no-pr', pr: undefined, excluded: 'trivial' })] });
  const going = facts({ key: 'f1:w2', workerIds: ['w2'], runs: [run({ id: 'f1:w2', workerId: 'w2', outcome: 'running', excluded: 'still working', pr: undefined })] });
  const pm = facts({ key: 'f1:role:pm', role: 'pm', runs: [run({ id: 'f1:w3', workerId: 'w3', outcome: 'no-pr', pr: undefined })] });
  const r = buildRanking([trivial, going, pm, facts({ key: 'f1:w4', runs: [run({ id: 'f1:w4', workerId: 'w4' })] })], [...trivial.runs, ...going.runs, ...pm.runs, run({ id: 'f1:w4', workerId: 'w4' })], { floors: [] });
  const by = (k: string) => r.workers.find((w) => w.key === k)!;
  assert.equal(by('f1:w1').grade, undefined);
  assert.equal(by('f1:w2').grade, undefined);
  assert.equal(by('f1:role:pm').standard.find((c) => c.key === 'benchmark')!.score, undefined);
  assert.equal(by('f1:role:pm').standard.find((c) => c.key === 'efficiency')!.evidence.some((e) => /churn/.test(e)), false);
  // The coordinator's no-PR session isn't in the model's baseline either.
  assert.equal(baselineOf(r.workers.length ? [...pm.runs, run({ id: 'f1:w4', workerId: 'w4' })] : [], [pm]).runs.length, 1);
});
