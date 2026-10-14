// Nothing waits on the PM unseen, S3: an ask in the lead's chat becomes an escalation. Whoever covers
// Management (here the Coordinator) has Jeff's waiting judgement On by default: a real ask in its last
// message that it didn't escalate in that turn is filed for it "from the chat", once a day per ask, a
// hands-on one as needs-human; set back to shadow, nothing is filed. Fake judge, no Claude or Jev.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { WorkerInfo, WorkerStatus } from '../src/shared/protocol.js';
import { Roster } from '../src/server/roster/index.js';
import type { TeamFloor } from '../src/server/roster/types.js';
import { chatAskTitle } from '../src/server/roster/jeff-ask.js';
import { DEFAULT_JEFF } from '../src/shared/judge.js';

class FakeFloor implements TeamFloor {
  id = `f${Math.random().toString(36).slice(2, 8)}`;
  name = 'test';
  dir = mkdtempSync(path.join(os.tmpdir(), 'chat-ask-'));
  map = new Map<string, WorkerInfo>();
  words = new Map<string, string>();
  toasts: string[] = [];
  lines: string[] = [];
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
  toast = (t: string) => void this.toasts.push(t);
  changed = () => {};
  activity = (t: string) => void this.lines.push(t);
  lastWords = (w: WorkerInfo) => this.words.get(w.id);
  add(id: string, name: string) {
    this.map.set(id, { id, kind: 'agent', provider: 'claude', name, status: 'working', viewers: [], viewerIds: [], createdAt: 0 } as unknown as WorkerInfo);
  }
  set(id: string, status: WorkerStatus) {
    const w = this.map.get(id)!;
    w.status = status;
    this.roster.onWorker(this, w);
  }
}

const WAITING = { waiting: { type: 'noul', noul: 0.95 }, kind: { type: 'choice', choice: 'question', confidence: 0.9 } };

function setup() {
  const floor = new FakeFloor();
  let now = Date.UTC(2026, 9, 13, 9);
  const roster = new Roster(
    {
      dataDir: mkdtempSync(path.join(os.tmpdir(), 'chat-ask-data-')),
      floors: () => [floor],
      makeIssue: async () => ({ dryRun: true }),
      analysis: () => '',
      now: () => now,
      judge: async (_text, questions) => ({ by: 'jev', model: 'jev-1', answers: Object.fromEntries(Object.keys(questions).map((k) => [k, (WAITING as Record<string, unknown>)[k]])) as never, ms: 5 }),
    },
    0,
  );
  floor.roster = roster;
  // The Coordinator (role pm) is worker c1; it covers Management on an Enterprise team.
  floor.add('c1', 'Ada');
  roster.data(floor.id).members.pm.workerId = 'c1';
  const turn = async (text: string) => {
    floor.words.set('c1', text);
    floor.set('c1', 'working');
    now += 60_000;
    floor.set('c1', 'done');
    await new Promise((r) => setTimeout(r, 20));
  };
  return { floor, roster, turn, advance: (ms: number) => (now += ms), escs: () => roster.data(floor.id).escalations };
}

test('the lead setting is On by default, and kept when saved', async () => {
  assert.equal(DEFAULT_JEFF.waitingLead, 'on');
  const { cleanSettings, reviveRoster } = await import('../src/server/roster/store.js');
  assert.equal(reviveRoster({ settings: { autonomy: 2 } }).settings.jeff.waitingLead, 'on');
  assert.equal(cleanSettings({ jeff: { waitingLead: 'shadow' } }).jeff.waitingLead, 'shadow');
});

test("an ask in the Coordinator's final message becomes one escalation from the chat; a repeat within a day is deduped", async () => {
  const t = setup();
  await t.turn('Standup summarised and pushed.\n\nCould you confirm whether the travel budget limit is per trip or per year?');
  assert.equal(t.escs().length, 1);
  const e = t.escs()[0];
  assert.equal(e.title, 'From the chat: Could you confirm whether the travel budget limit is per trip or per year?');
  assert.equal(e.trigger, 'question');
  assert.equal(e.fyi, false);
  assert.equal(e.role, 'pm');
  assert.match(e.details, /asked you this in its chat and didn't escalate it/);
  // The same ask next turn (and answered meanwhile) isn't filed again within the day.
  e.status = 'resolved';
  t.advance(2 * 3_600_000);
  await t.turn('Still waiting.\n\nCould you confirm whether the travel budget limit is per trip or per year?');
  assert.equal(t.escs().length, 1);
  // A day later it is.
  t.advance(25 * 3_600_000);
  await t.turn('Could you confirm whether the travel budget limit is per trip or per year?');
  assert.equal(t.escs().length, 2);
});

test('a hands-on ask is filed as needs-human, and another open escalation does not hold it back', async () => {
  const t = setup();
  t.roster.escalations.raiseFor(t.floor, { workerId: 'c1', by: 'Ada', role: 'pm' }, { urgency: 'important', trigger: 'blocked', title: 'Who owns the HR integration?', details: '', options: [] });
  t.advance(2 * 3_600_000);
  await t.turn('PR #51 has been green for four days.\n\nPlease merge PR #51 so the Lead Developer can build on it.');
  assert.equal(t.escs().length, 2);
  assert.equal(t.escs()[1].trigger, 'needs-human');
  assert.equal(chatAskTitle('AWAITING-PM: merge PR #51'), 'From the chat: merge PR #51');
});

test('an escalation the lead filed in the same turn means nothing is added', async () => {
  const t = setup();
  t.floor.words.set('c1', 'I raised it.\n\nCan you decide on the approval chain?');
  t.floor.set('c1', 'working');
  t.roster.escalations.raiseFor(t.floor, { workerId: 'c1', by: 'Ada', role: 'pm' }, { urgency: 'important', title: 'Approval chain: one level or two?', details: '', options: [] });
  t.advance(60_000);
  t.floor.set('c1', 'done');
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(t.escs().length, 1);
});

test('set back to shadow, nothing is filed; a report with no ask files nothing either', async () => {
  const t = setup();
  t.roster.data(t.floor.id).settings.jeff.waitingLead = 'shadow';
  await t.turn('Can you decide on the approval chain?');
  assert.equal(t.escs().length, 0);
  const u = setup();
  await u.turn('Standup summarised and pushed. Next: the weekly memo.');
  assert.equal(u.escs().length, 0);
});
