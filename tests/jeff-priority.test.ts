// Jeff's priority (server/roster/jeff-priority.ts, shared/roster/jeff-rank.ts): which escalation the
// Project Manager should resolve first. The score, the re-rank on raise and resolve, at most one ask an
// hour per escalation, the order the lists fall back to, the setting, and the Needs-you strip in his
// order. A fake judge: no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { WorkerInfo } from '../src/shared/protocol.js';
import type { JudgeMade } from '../src/shared/judge.js';
import { escalationOrder, type Escalation, type EscalationAsk } from '../src/shared/roster/escalation.js';
import { jeffOrder, priorityScore, rankChip, rankSig, rankTip, rerank, sortedByJeff, type JeffRank } from '../src/shared/roster/jeff-rank.js';
import type { RosterView } from '../src/shared/roster/types.js';
import { collectNeeds } from '../src/client/ui/needsyou/logic.js';
import { Roster } from '../src/server/roster/index.js';
import { PRIORITY_QUESTIONS, priorityState, RERATE_MS } from '../src/server/roster/jeff-priority.js';
import type { TeamFloor } from '../src/server/roster/types.js';

const HOUR = 3_600_000;

// ---- The score and the order ----------------------------------------------------------------------

test('the score: level, blocking and risk weighted 45/35/20, plus up to 20 for a day open, as far as it blocks', () => {
  assert.equal(priorityScore({ priority: 1, blocking: 1, risk: 1 }, 0), 100);
  assert.equal(priorityScore({ priority: 0, blocking: 0, risk: 0 }, 10 * 24 * HOUR), 0);
  assert.equal(priorityScore({ priority: 0.5, blocking: 0.5, risk: 0.5 }, 0), 50);
  // A day open adds 20 × blocking, and no more after that.
  assert.equal(priorityScore({ priority: 1, blocking: 1, risk: 1 }, 24 * HOUR), 120);
  assert.equal(priorityScore({ priority: 1, blocking: 1, risk: 1 }, 72 * HOUR), 120);
  assert.equal(priorityScore({ priority: 0.5, blocking: 0.5, risk: 0 }, 12 * HOUR), 45);
  // An old nice-to-have doesn't climb; an old blocker passes a fresh one of the same weight.
  assert.equal(priorityScore({ priority: 0.25, blocking: 0, risk: 0 }, 48 * HOUR), priorityScore({ priority: 0.25, blocking: 0, risk: 0 }, 0));
  assert.ok(priorityScore({ priority: 0.75, blocking: 0.9, risk: 0.2 }, 20 * HOUR) > priorityScore({ priority: 0.75, blocking: 0.9, risk: 0.2 }, HOUR));
  // Out-of-range answers are clamped.
  assert.equal(priorityScore({ priority: 2, blocking: -1, risk: 5 }, -5), 65);
});

const esc = (id: string, o: Partial<Escalation> = {}): Escalation => ({ id, at: 0, workerId: 'w', by: 'Lead', urgency: 'important', fyi: false, level: 2, title: `esc ${id}`, details: '', options: [], status: 'open', ...o }) as Escalation;
const rated = (o: Partial<JeffRank>): JeffRank => ({ score: 0, by: 'jev', at: 0, blocking: 0, risk: 0, level: 'Soon', priority: 0, sig: '', ...o });

test('rerank numbers the open, non-FYI rated ones by score (older first on a tie), and strips the rest', () => {
  const list = [
    esc('a', { at: 10, jeffRank: rated({ priority: 0.5 }) }),
    esc('b', { at: 5, jeffRank: rated({ priority: 1, blocking: 1 }) }),
    esc('c', { at: 1, jeffRank: rated({ priority: 0.5 }) }),
    esc('d'),
    esc('fyi', { fyi: true, jeffRank: rated({ priority: 1, rank: 1 }) }),
    esc('done', { status: 'resolved', jeffRank: rated({ priority: 1, rank: 2 }) }),
  ];
  assert.equal(rerank(list, 10), true);
  assert.deepEqual(list.map((e) => e.jeffRank?.rank), [3, 1, 2, undefined, undefined, undefined]);
  assert.equal(rerank(list, 10), false);
});

test('without ranks (or with the sort off) the lists keep their own order; ranked ones lead, the rest follow in it', () => {
  const byUrgency = (a: Escalation, b: Escalation) => ['critical', 'urgent', 'important', 'info'].indexOf(a.urgency) - ['critical', 'urgent', 'important', 'info'].indexOf(b.urgency) || a.at - b.at;
  const plain = [esc('old', { at: 1 }), esc('crit', { urgency: 'critical', at: 9 }), esc('urg', { urgency: 'urgent', at: 3 })];
  assert.deepEqual(jeffOrder(plain, true, byUrgency).map((e) => e.id), ['crit', 'urg', 'old']);
  assert.equal(sortedByJeff(plain, 'on'), false);
  const some = [esc('old', { at: 1, jeffRank: rated({ rank: 1 }) }), esc('crit', { urgency: 'critical', at: 9 }), esc('urg', { urgency: 'urgent', at: 3, jeffRank: rated({ rank: 2 }) }), esc('crit2', { urgency: 'critical', at: 2 })];
  assert.deepEqual(jeffOrder(some, true, byUrgency).map((e) => e.id), ['old', 'urg', 'crit2', 'crit']);
  assert.deepEqual(jeffOrder(some, false, byUrgency).map((e) => e.id), ['crit2', 'crit', 'urg', 'old']);
  assert.equal(sortedByJeff(some, 'on'), true);
  assert.equal(sortedByJeff(some, 'off'), false);
  // The list itself is left alone.
  assert.deepEqual(some.map((e) => e.id), ['old', 'crit', 'urg', 'crit2']);
});

test('the chip and its tooltip', () => {
  assert.equal(rankChip(1), '🧑‍⚖️ #1 · resolve first');
  assert.equal(rankChip(3), '🧑‍⚖️ #3');
  assert.match(rankTip(rated({ blocking: 0.92, risk: 0.4 }), 1), /^Jeff \(Jev\) ranks this #1: blocking 92%, risk 40%/);
  assert.match(rankTip(rated({ by: 'haiku', blocking: 0.1, risk: 0 }), 2), /^Jeff \(on Haiku\) ranks this #2: blocking 10%, risk 0%/);
});

// ---- On a floor ---------------------------------------------------------------------------------------

class FakeFloor implements TeamFloor {
  id = `f${Math.random().toString(36).slice(2, 8)}`;
  name = 'test';
  dir = mkdtempSync(path.join(os.tmpdir(), 'jeffpri-floor-'));
  map = new Map<string, WorkerInfo>();
  made: JudgeMade[] = [];
  workers = () => [...this.map.values()];
  worker = (id: string) => this.map.get(id);
  hire = async () => 'no';
  stop = async () => {};
  prompt = () => undefined;
  wake = () => undefined;
  rename = () => {};
  cwdOf = () => this.dir;
  openPulls = () => [];
  toast = () => {};
  changed = () => {};
  activity = () => {};
  judged = (m: JudgeMade) => void this.made.push(m);
}

/** A floor whose Jeff answers from `rate`: the priority level index, blocking and risk per escalation title. */
function setup(rate: (state: string) => { level: number; blocking: number; risk: number } | undefined) {
  const floor = new FakeFloor();
  let now = Date.UTC(2026, 9, 5, 9);
  const asked: string[] = [];
  const roster = new Roster(
    {
      dataDir: mkdtempSync(path.join(os.tmpdir(), 'jeffpri-data-')),
      floors: () => [floor],
      makeIssue: async () => ({ dryRun: true }),
      analysis: () => '',
      now: () => now,
      judge: async (text, questions) => {
        if (!('blocking' in questions)) return undefined;
        asked.push(text);
        const r = rate(text);
        if (!r) return undefined;
        return { by: 'jev', model: 'jev-1.13.0', ms: 30, answers: { priority: { type: 'score', score: r.level, level: PRIORITY_QUESTIONS.priority.type === 'score' ? PRIORITY_QUESTIONS.priority.criteria[r.level] : '' }, blocking: { type: 'noul', noul: r.blocking }, risk: { type: 'noul', noul: r.risk } } };
      },
    },
    0,
  );
  const w = { id: 'w1', kind: 'agent', name: 'Ada', status: 'idle', viewers: [] } as unknown as WorkerInfo;
  floor.map.set(w.id, w);
  const ask = (title: string, o: Partial<EscalationAsk> = {}): EscalationAsk => ({ urgency: 'important', title, details: `About ${title}.`, options: [], ...o });
  return {
    floor,
    roster,
    asked,
    raise: (title: string, o: Partial<EscalationAsk> = {}) => roster.escalations.raise(floor, w, ask(title, o)),
    list: () => roster.data(floor.id).escalations,
    ranks: () => Object.fromEntries(roster.data(floor.id).escalations.filter((e) => e.jeffRank?.rank).map((e) => [e.title, e.jeffRank!.rank])),
    rows: () => roster.jeff.log.read(floor.id),
    tick: (ms: number) => (now += ms),
    settle: () => new Promise((r) => setTimeout(r, 20)),
  };
}

const BY_TITLE: Record<string, { level: number; blocking: number; risk: number }> = {
  'Pick a colour': { level: 0, blocking: 0.05, risk: 0 },
  'Deploy is stuck': { level: 4, blocking: 0.95, risk: 0.6 },
  'Budget question': { level: 2, blocking: 0.3, risk: 0.9 },
};
const byTitle = (state: string) => BY_TITLE[Object.keys(BY_TITLE).find((t) => state.includes(`Title: ${t}`))!];

test('raising one asks Jeff once with the facts, ranks every open one, logs it as priority and broadcasts "→ #n"', async () => {
  const t = setup(byTitle);
  t.raise('Pick a colour');
  await t.settle();
  assert.equal(t.asked.length, 1);
  assert.match(t.asked[0], /raised by Ada, open for 0 minutes/);
  assert.match(t.asked[0], /Urgency the agent gave it: important/);
  assert.match(t.asked[0], /Details:\nAbout Pick a colour\./);
  t.raise('Deploy is stuck', { urgency: 'urgent', trigger: 'blocked' });
  await t.settle();
  t.raise('Budget question');
  await t.settle();
  assert.equal(t.asked.length, 3);
  assert.deepEqual(t.ranks(), { 'Deploy is stuck': 1, 'Budget question': 2, 'Pick a colour': 3 });
  const deploy = t.list().find((e) => e.title === 'Deploy is stuck')!.jeffRank!;
  assert.equal(deploy.by, 'jev');
  assert.equal(deploy.blocking, 0.95);
  assert.equal(deploy.priority, 1);
  assert.equal(deploy.score, priorityScore(deploy, 0));
  assert.match(deploy.level, /^Blocking work right now/);
  const rows = t.rows();
  assert.deepEqual(rows.map((r) => r.kind), ['priority', 'priority', 'priority']);
  assert.equal(rows[1].jeff, '#1');
  assert.equal(t.floor.made[1].kind, 'priority');
  assert.equal(t.floor.made[1].verdict, '→ #1');
});

test('resolving one re-ranks the rest without asking again', async () => {
  const t = setup(byTitle);
  t.raise('Pick a colour');
  await t.settle();
  const stuck = t.raise('Deploy is stuck');
  await t.settle();
  t.raise('Budget question');
  await t.settle();
  assert.equal(t.asked.length, 3);
  t.tick(5 * 60_000);
  assert.equal(t.roster.escalations.resolve(t.floor, stuck.id, 'reply', 'Restart it', 'You'), undefined);
  await t.settle();
  assert.equal(t.asked.length, 3);
  assert.deepEqual(t.ranks(), { 'Budget question': 1, 'Pick a colour': 2 });
  assert.equal(stuck.jeffRank?.rank, undefined);
});

test('Jeff is asked about an escalation at most once an hour (failures count too), and again when its text changes', async () => {
  let up = false;
  const t = setup((s) => (up ? byTitle(s) : undefined));
  const first = t.raise('Pick a colour');
  await t.settle();
  assert.equal(t.asked.length, 1);
  assert.equal(first.jeffRank, undefined);
  // Down: the next raise doesn't ask about the first again within the hour.
  up = true;
  t.raise('Budget question');
  await t.settle();
  assert.equal(t.asked.length, 2);
  assert.equal(first.jeffRank, undefined);
  // An hour later the next event asks about both again, and about the new one.
  t.tick(RERATE_MS);
  t.raise('Deploy is stuck');
  await t.settle();
  assert.equal(t.asked.length, 5);
  assert.deepEqual(t.ranks(), { 'Deploy is stuck': 1, 'Budget question': 2, 'Pick a colour': 3 });
  // Within the hour: raising and resolving ask only about the new one.
  t.tick(10 * 60_000);
  const extra = t.raise('Pick a colour');
  await t.settle();
  assert.equal(t.asked.length, 6);
  t.roster.escalations.resolve(t.floor, extra.id, 'approve', '', 'You');
  await t.settle();
  assert.equal(t.asked.length, 6);
  // Its text changed: asked again straight away.
  first.details = 'Now the client is waiting on it.';
  assert.notEqual(first.jeffRank?.sig, rankSig(first));
  await t.roster.jeff.priority.rerank(t.floor);
  assert.equal(t.asked.length, 7);
  assert.equal(first.jeffRank?.sig, rankSig(first));
});

test('age lifts an old blocker over a fresh one of the same weight on the next re-rank', async () => {
  const same = { level: 3, blocking: 0.9, risk: 0.2 };
  const t = setup(() => same);
  t.raise('Older');
  await t.settle();
  t.tick(20 * HOUR);
  t.raise('Newer');
  await t.settle();
  assert.deepEqual(t.ranks(), { Older: 1, Newer: 2 });
  assert.ok(t.list()[0].jeffRank!.score > t.list()[1].jeffRank!.score);
});

test('FYIs are never rated; priority off: Jeff is never asked until it is back on', async () => {
  const t = setup(byTitle);
  t.roster.escalations.raiseFyi(t.floor, t.floor.map.get('w1')!, { urgency: 'info', title: 'Pick a colour', details: '', options: [] });
  await t.settle();
  assert.equal(t.asked.length, 0);
  t.roster.data(t.floor.id).settings.jeff.priority = 'off';
  t.raise('Deploy is stuck');
  await t.settle();
  assert.equal(t.asked.length, 0);
  // Back on through the settings: the open ones are ranked.
  assert.equal(t.roster.members.settings(t.floor, { jeff: { priority: 'on' } }), undefined);
  await t.settle();
  assert.equal(t.asked.length, 1);
  assert.deepEqual(t.ranks(), { 'Deploy is stuck': 1 });
});

test('the first look at a floor ranks the open escalations already there, once', async () => {
  const t = setup(byTitle);
  t.roster.data(t.floor.id).escalations.push(esc('x1', { title: 'Deploy is stuck', at: Date.UTC(2026, 9, 5, 7) }), esc('x2', { title: 'Pick a colour', at: Date.UTC(2026, 9, 5, 8) }));
  t.roster.view(t.floor, true);
  await t.settle();
  assert.equal(t.asked.length, 2);
  assert.match(t.asked.find((s) => s.includes('Deploy is stuck'))!, /open for 2 hours/);
  assert.deepEqual(t.ranks(), { 'Deploy is stuck': 1, 'Pick a colour': 2 });
  t.roster.view(t.floor, true);
  await t.settle();
  assert.equal(t.asked.length, 2);
});

test('what Jeff reads: the short facts first, the details last (the judge redacts and clips it)', () => {
  const s = priorityState(esc('s', { title: 'Rotate the key', details: 'token: ghp_abcdefghijklmnopqrstuvwxyz123456', options: ['now', 'later'], recommendation: 'now', trigger: 'security' }), 3 * HOUR);
  assert.match(s, /^An escalation to the Project Manager/);
  assert.match(s, /Options: now \| later\nThe agent recommends: now\nDetails:/);
  assert.match(s, /trigger: security/);
  assert.match(s, /open for 3 hours/);
});

test('settings: Jeff priority revives on, keeps off, and ignores junk', async () => {
  const { reviveRoster, cleanSettings } = await import('../src/server/roster/store.js');
  assert.equal(reviveRoster({ settings: { autonomy: 2, jeff: { waiting: 'on', triage: 'off' } } }).settings.jeff.priority, 'on');
  assert.equal(reviveRoster({ settings: { jeff: { priority: 'off' } } }).settings.jeff.priority, 'off');
  assert.equal(cleanSettings({ jeff: { priority: 'shadow' } }).jeff.priority, 'on');
  assert.equal(cleanSettings({ jeff: {} }, cleanSettings({ jeff: { priority: 'off' } })).jeff.priority, 'off');
});

test('the Needs-you strip lists escalations in Jeff order with his chip, and falls back without ranks or with the sort off', () => {
  const view = (priority: 'on' | 'off', ranked: boolean): RosterView =>
    ({
      floor: 'f1',
      admin: true,
      approvals: [],
      settings: { jeff: { waiting: 'shadow', triage: 'shadow', priority } },
      escalations: [
        esc('crit', { urgency: 'critical', at: 9, ...(ranked ? { jeffRank: rated({ rank: 2, blocking: 0.5, risk: 0.1 }) } : {}) }),
        esc('old', { at: 1, ...(ranked ? { jeffRank: rated({ rank: 1, blocking: 0.92, risk: 0.4 }) } : {}) }),
        esc('urg', { urgency: 'urgent', at: 3 }),
      ],
    }) as unknown as RosterView;
  const needs = (r: RosterView) => collectNeeds({ floor: 'f1', workers: [], pulls: [], floors: [], roster: r });
  const on = needs(view('on', true));
  assert.deepEqual(on.map((n) => n.key), ['esc-old', 'esc-crit', 'esc-urg']);
  assert.equal(on[0].rank?.chip, '🧑‍⚖️ #1 · resolve first');
  assert.match(on[0].rank!.tip, /^Jeff \(Jev\) ranks this #1: blocking 92%, risk 40%/);
  assert.equal(on[1].rank?.n, 2);
  assert.equal(on[2].rank, undefined);
  for (const r of [view('off', true), view('on', false)]) {
    const items = needs(r);
    assert.deepEqual(items.map((n) => n.key), ['esc-crit', 'esc-urg', 'esc-old']);
    assert.ok(items.every((n) => n.rank === undefined));
  }
  // The console's own fallback stays loudest-then-newest.
  assert.deepEqual(jeffOrder(view('on', false).escalations, true, escalationOrder).map((e) => e.id), ['crit', 'urg', 'old']);
});
