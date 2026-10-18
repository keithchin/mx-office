// Asks in a reply's list (roster/reply-asks.ts): a status reply that marks some listed items as the Project
// Manager's ("items 1 to 3 need your hands") files one escalation per item, deterministically (no judge), and
// leaves out what it says can be skipped; folded into an open escalation it repeats or names; negations,
// conditionals, relays and plain progress replies file nothing; deploying, cloud settings and credentials are
// needs-human, outside the office. Synthetic words, neutral names.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { WorkerInfo, WorkerStatus } from '../src/shared/protocol.js';
import type { AuditInput } from '../src/shared/audit.js';
import { fyiNow } from '../src/shared/roster/escalation.js';
import { Roster } from '../src/server/roster/index.js';
import type { TeamFloor } from '../src/server/roster/types.js';
import { useAudit } from '../src/server/audit/index.js';
import { fileReplyAsks, replyAsks } from '../src/server/roster/reply-asks.js';
import { ASK_THE_PM } from '../src/server/roster/prompts.js';

const events: AuditInput[] = [];
useAudit({ append: (e: AuditInput) => (events.push(e), { ...e, id: String(events.length), at: Date.now(), prev: '', hash: '' }) } as never);

const STATUS = [
  'Here is where things stand. Stage 5 is built and reviewed; what is left needs a person.',
  '',
  'Only items 1 to 3 need your hands. Items 4 and 5 can be skipped for now.',
  '',
  '1. **Merge PR #10** (sign-off row, corrected names) and close PR #11.',
  '2. **Row 32, deploy and walk**: deploy the build to the test environment and walk the approval flow.',
  '3. **Translated copy**: get someone to review the translated strings before the demo.',
  '4. **Lint warnings**: 21 warnings left, none blocking.',
  '5. **Old branches**: delete the merged branches.',
].join('\n');

class FakeFloor implements TeamFloor {
  id = `f${Math.random().toString(36).slice(2, 8)}`;
  name = 'test';
  dir = mkdtempSync(path.join(os.tmpdir(), 'reply-ask-'));
  map = new Map<string, WorkerInfo>();
  words = new Map<string, string>();
  roster!: Roster;
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
  judged = () => {};
  lastWords = (w: WorkerInfo) => this.words.get(w.id);
  add(id: string, name: string) {
    this.map.set(id, { id, kind: 'agent', provider: 'claude', name, status: 'idle', viewers: [], viewerIds: [], createdAt: 0 } as unknown as WorkerInfo);
  }
  set(id: string, status: WorkerStatus) {
    const w = this.map.get(id)!;
    w.status = status;
    this.roster.onWorker(this, w);
  }
}

function setup() {
  const floor = new FakeFloor();
  let now = Date.UTC(2026, 9, 18, 9);
  // No judge at all: what's filed here never depends on a model.
  const roster = new Roster({ dataDir: mkdtempSync(path.join(os.tmpdir(), 'reply-ask-data-')), floors: () => [floor], makeIssue: async () => ({ dryRun: true }), analysis: () => '', now: () => now }, 0);
  floor.roster = roster;
  floor.add('c1', 'Ada');
  roster.data(floor.id).members.pm.workerId = 'c1';
  const turn = (text: string) => {
    floor.words.set('c1', text);
    floor.set('c1', 'working');
    now += 60_000;
    floor.set('c1', 'done');
  };
  return { floor, roster, turn, advance: (ms: number) => (now += ms), escs: () => roster.data(floor.id).escalations, ada: () => floor.map.get('c1')! };
}

test('reply-asks-detect: "items 1 to 3 need your hands" is three asks; items 4 and 5, said to be skippable, are not', () => {
  const r = replyAsks(STATUS);
  assert.deepEqual(r.asks.map((a) => a.n), [1, 2, 3]);
  assert.match(r.asks[0].title, /^Merge PR #10\b/);
  assert.match(r.asks[1].title, /^Row 32, deploy and walk\b/);
  assert.match(r.asks[2].title, /^Translated copy\b/);
  // The agent's own words go with each one.
  assert.match(r.asks[1].words, /walk the approval flow/);
  assert.equal(r.skipped.length, 2);
  assert.match(r.skipped.join(' | '), /Lint warnings.*Old branches/);
  // Merging is hands-on; deploying is outside the office; a review someone else does is a question for the PM.
  assert.deepEqual(r.asks.map((a) => [a.handsOn, a.outside]), [[true, false], [true, true], [false, false]]);
});

test('reply-asks-detect: the same list run into one paragraph reads the same; a PR number in the lead-in is not an item number', () => {
  const r = replyAsks('Status: built and reviewed. Only items 1 to 3 need your hands; merging PR #10 is the first. Items 4 and 5 can be skipped for now. 1. **Merge PR #10** and close PR #11. 2. **Row 32, deploy and walk** on the test environment. 3. **Translated copy**: get someone to review it. 4. **Lint warnings**: none blocking. 5. **Old branches**: delete them.');
  assert.deepEqual(r.asks.map((a) => a.n), [1, 2, 3]);
  assert.equal(r.asks[0].title, 'Merge PR #10 and close PR #11');
  assert.equal(r.skipped.length, 2);
});

test('reply-asks-detect: a lead-in without numbers puts the whole list on the PM; items addressed to the PM count on their own', () => {
  const a = replyAsks('Status: the export works.\n\nFor you to do:\n- Approve the data model in ESC-0123456789\n- Sign off Stage 2\n- Lint is clean (FYI)');
  assert.deepEqual(a.asks.map((x) => x.title), ['Approve the data model in ESC-0123456789', 'Sign off Stage 2']);
  assert.equal(a.skipped.length, 1);
  const b = replyAsks('Next steps:\n1. I add the overview page.\n2. Tell me once the test environment has the new constant.\n3. I write the tests.');
  assert.deepEqual(b.asks.map((x) => x.n), [2]);
  // The new constant on the environment is a cloud setting: outside the office.
  assert.equal(b.asks[0].outside, true);
});

test('reply-asks-junk: negated, conditional and future lead-ins, relays and plain progress replies file nothing', () => {
  const none = [
    'Nothing below needs your hands; it is all in progress:\n1. Fix the failing test\n2. Merge PR #4 once it is green',
    "You don't need to do anything for these:\n- Rebase the branch\n- Rerun the lint",
    'If the build fails again, you need to:\n1. restart the preview\n2. tell me what it printed',
    'Once Stage 3 is done these will need your hands:\n1. Merge PR #12\n2. Sign off Stage 3',
    'Done this turn:\n1. Merged PR #6\n2. Fixed the failing test\n\nNext I start row 33.',
    'Plan for today:\n- Build the overview page\n- Add the export microflow\n- Merge PR #7 after review',
  ];
  for (const t of none) assert.deepEqual(replyAsks(t).asks, [], t);
  // Someone else's ask passed on has its own escalation; a question put to the PM in the same list still counts.
  const relay = replyAsks("Waiting on you:\n1. Grace's request for a schema change is still with you\n2. Do you want the export as CSV or as a spreadsheet?");
  assert.deepEqual(relay.asks.map((x) => x.n), [2]);
});

test('reply-asks-file: a status reply at the turn end files three escalations, none FYI, no judge; the same reply again files none', () => {
  const { turn, escs } = setup();
  turn(STATUS);
  const filed = escs();
  assert.equal(filed.length, 3);
  for (const e of filed) {
    assert.equal(e.status, 'open');
    assert.equal(fyiNow(e), false);
    assert.equal(e.from?.kind, 'reply-ask');
    assert.match(e.details, /listed this as needing you in its reply/);
    // The skipped ones are named, not filed.
    assert.match(e.details, /can be skipped for now \(not filed\): Lint warnings/);
  }
  const deploy = filed.find((e) => /deploy/.test(e.title))!;
  assert.equal(deploy.trigger, 'needs-human');
  assert.match(deploy.details, /outside the office/);
  assert.equal(filed.find((e) => /Merge PR #10/.test(e.title))!.trigger, 'needs-human');
  assert.equal(filed.find((e) => /Translated copy/.test(e.title))!.trigger, 'question');
  turn(STATUS);
  assert.equal(escs().length, 3);
});

test('reply-asks-link: the phone posting the same reply links its message to what was filed, files nothing more', () => {
  const { floor, roster, turn, escs, ada } = setup();
  turn(STATUS);
  const r = fileReplyAsks(roster, floor, ada(), STATUS, { message: 'msg123', thread: 'dm:c1' });
  assert.equal(r.raised.length, 0);
  assert.equal(r.kept, 3);
  for (const e of escs()) {
    assert.equal(e.from?.kind === 'reply-ask' && e.from.message, 'msg123');
    assert.match(e.details, /In the team chat: message msg123/);
  }
});

test('reply-asks-fold: an item the agent already escalated, or one naming an open escalation, is folded, not filed again', () => {
  const { floor, roster, turn, escs, ada } = setup();
  const own = roster.escalations.raiseFor(floor, { workerId: 'c1', by: 'Ada', role: 'pm' }, { urgency: 'important', trigger: 'needs-human', title: 'Merge PR #10', details: '', options: [] });
  const other = roster.escalations.raiseFor(floor, { workerId: 'w9', by: 'Grace' }, { urgency: 'important', title: 'Pick the archive period', details: '', options: ['1 year', '3 years'] });
  turn(`Needs you:\n1. **Merge PR #10** and close PR #11.\n2. Answer ESC-${other.id} on the archive period.\n3. Sign off Stage 4.`);
  const titles = escs().map((e) => e.title);
  assert.equal(escs().length, 3, titles.join(' | '));
  assert.ok(titles.includes('Sign off Stage 4'));
  assert.ok(own.foldedKeys?.some((k) => k.startsWith('reply:')));
  assert.ok(other.foldedKeys?.some((k) => k.startsWith('reply:')));
  void ada;
});

test('reply-asks-playbook: the rule tells agents to escalate each item a reply leaves for the PM', () => {
  assert.match(ASK_THE_PM, /lists things only the Project Manager can do/);
});
