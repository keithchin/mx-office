// The team chatter (server/chatter/) against a fake floor and a real roster: each source turned into
// who-said-what-to-whom, the journals read incrementally with their name mentions, redaction and
// clipping, The Firm's interviews, a PR handed over, the Project Manager (a person) told apart from an agent of the same name, the capped file
// with its cursor, and GET /api/chatter.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ServerResponse } from 'node:http';
import type { WorkerInfo, WorkerStatus } from '../src/shared/protocol.js';
import { betweenAgents, isGroup, matchesFilter, withHuman, type ChatterMessage, type ChatterParty } from '../src/shared/chatter.js';
import { Roster } from '../src/server/roster/index.js';
import type { HireAsk, TeamFloor } from '../src/server/roster/types.js';
import { Chatter, chatterFor, cleanText } from '../src/server/chatter/index.js';
import { noteDispatch } from '../src/server/chatter/bus.js';
import { entryKeys, headingTime, journalSource, mentions, textReader } from '../src/server/chatter/journal.js';
import { registerChatterSource } from '../src/server/chatter/sources.js';
import { ChatterFile } from '../src/server/chatter/store.js';
import { chatterFilter, chatterRoutes } from '../src/server/http/routes/chatter.js';
import { agentTold, prHanded } from '../src/server/chatter/hooks.js';
import { firmSource, interviewDrafts } from '../src/server/chatter/firm.js';
import type { Engagement } from '../src/shared/firm/engagement.js';

const MIN = 60_000;

class FakeFloor implements TeamFloor {
  id = `f${Math.random().toString(36).slice(2, 8)}`;
  name = 'chatter-test';
  dir = mkdtempSync(path.join(os.tmpdir(), 'chatter-'));
  map = new Map<string, WorkerInfo>();
  prompts: { id: string; text: string }[] = [];
  roster!: Roster;
  clock!: { now: number };
  private n = 0;
  workers = () => [...this.map.values()];
  worker = (id: string) => this.map.get(id);
  async hire(ask: HireAsk) {
    const id = `w${++this.n}`;
    const w = { id, kind: 'agent', provider: 'claude', model: ask.model, deskId: 'd', name: ask.name, color: '#fff', status: 'starting', acked: true, createdBy: ask.by, createdAt: this.clock.now, prompt: ask.prompt, cols: 80, rows: 24, viewers: [], viewerIds: [] } as unknown as WorkerInfo;
    this.map.set(id, w);
    mkdirSync(this.cwdOf(w), { recursive: true });
    return w;
  }
  async stop(id: string) {
    this.map.delete(id);
    this.roster.onWorkerGone(this, id);
  }
  prompt(id: string, text: string) {
    if (!this.map.has(id)) return 'Worker is not running';
    this.prompts.push({ id, text });
    return undefined;
  }
  wake() {
    return undefined;
  }
  rename(id: string, name: string) {
    const w = this.map.get(id);
    if (w) w.name = name;
  }
  cwdOf = (w: WorkerInfo) => path.join(this.dir, 'wt', w.id);
  openPulls = () => [];
  toast = () => undefined;
  changed = () => undefined;
  set(id: string, status: WorkerStatus) {
    Object.assign(this.map.get(id)!, { status });
    this.roster.onWorker(this, this.map.get(id)!);
  }
}

function setup(journals: Record<string, string> = {}) {
  const clock = { now: Date.UTC(2026, 9, 5, 6, 0) };
  const floor = new FakeFloor();
  floor.clock = clock;
  const dataDir = mkdtempSync(path.join(os.tmpdir(), 'chatter-data-'));
  const roster = new Roster({ dataDir, floors: () => [floor], makeIssue: async () => ({ number: 7 }), analysis: () => '', now: () => clock.now }, 0);
  floor.roster = roster;
  const sent: ChatterMessage[] = [];
  const chatter = new Chatter(
    { dataDir, roster, floors: () => [floor], floor: (id) => (id === floor.id ? floor : undefined), floorOfWorker: (id) => (floor.map.has(id) ? floor : undefined), now: () => clock.now, broadcast: (_f, m) => void sent.push(m) },
    { lookMs: 0, journal: journalSource((_f, r) => textReader(journals[r.team] ?? '')) },
  );
  const d = roster.data(floor.id);
  // The names the test uses: the Coordinator is Keith, like the Project Manager.
  for (const [role, name] of [['pm', 'Keith'], ['lead-developer', 'Hedy'], ['lead-designer', 'Anita'], ['lead-tester', 'Toni'], ['chief-analyst', 'Ada']] as const) d.members[role].name = name;
  return { clock, floor, roster, chatter, sent, d, dataDir, journals };
}

async function hire(t: ReturnType<typeof setup>, role: 'pm' | 'lead-developer' | 'lead-designer') {
  assert.equal(await t.roster.members.hire(t.floor, role, 'Test'), undefined);
  const id = t.d.members[role].workerId!;
  t.floor.set(id, 'working');
  t.floor.set(id, 'done');
  return id;
}

const from = (m: ChatterMessage) => m.from;
const toName = (m: ChatterMessage) => (isGroup(m.to) ? m.to.group : m.to.name);

test('an agent escalation and the Project Manager’s answer: the person is a human even when an agent shares the name', async () => {
  const t = setup();
  await hire(t, 'pm');
  const dev = await hire(t, 'lead-developer');
  const e = t.roster.escalations.raise(t.floor, t.floor.worker(dev)!, { urgency: 'important', trigger: 'scope', title: 'Add CSV export?', details: 'Customers asked twice.', options: [], recommendation: 'Yes, in v2' });
  t.chatter.look(t.floor);
  const esc = t.sent.find((m) => m.kind === 'escalation')!;
  assert.deepEqual([esc.from.name, esc.from.kind, esc.from.role, esc.from.roleId], ['Hedy', 'agent', 'Lead Developer', 'lead-developer']);
  assert.deepEqual(esc.to, { group: 'pm' });
  assert.match(esc.text, /^Add CSV export\? — I'd go with: Yes, in v2 — Customers asked twice\.$/);
  assert.equal(esc.ref?.escalationId, e.id);

  // Keith the person answers; Keith the Coordinator is an agent.
  t.clock.now += MIN;
  t.roster.escalations.resolve(t.floor, e.id, 'approve', 'go for it', 'Keith');
  t.chatter.look(t.floor);
  const ans = t.sent.find((m) => m.kind === 'answer')!;
  assert.deepEqual([ans.from.name, ans.from.kind, ans.from.role], ['Keith', 'human', 'Project Manager']);
  assert.equal(toName(ans), 'Hedy');
  assert.equal(ans.text, 'Approved 👍 go for it');
  assert.ok(withHuman(ans) && !betweenAgents(ans));
  // The relay to the Coordinator Keith (an agent) is between agents, not with the person.
  const n = t.sent.length;
  t.roster.escalations.raise(t.floor, t.floor.worker(dev)!, { urgency: 'important', trigger: 'blocked', title: 'No test DB', details: '', options: [] });
  assert.equal(t.roster.escalations.flushCoordinator(t.floor), true);
  const relay = t.sent.slice(n).find((m) => m.kind === 'relay')!;
  assert.deepEqual([relay.from.kind, toName(relay), (relay.to as ChatterParty).kind, (relay.to as ChatterParty).role], ['office', 'Keith', 'agent', 'Project Coordinator']);
  assert.match(relay.text, /Hedy escalated “No test DB” to the Project Manager/);
  assert.ok(betweenAgents(relay) && !withHuman(relay));
  assert.ok(matchesFilter(ans, { with: 'person', name: 'Keith', kind: 'human' }) && !matchesFilter(relay, { with: 'person', name: 'Keith', kind: 'human' }));
  assert.ok(matchesFilter(relay, { with: 'person', name: 'Keith', kind: 'agent' }));
  // Once the new escalation is in, looking again adds nothing: every source key is one message.
  t.chatter.look(t.floor);
  const before = t.sent.length;
  t.chatter.look(t.floor);
  assert.equal(t.sent.length, before);
  t.chatter.stop();
});

test('Jeff and the office raising on an agent’s behalf speak as themselves', () => {
  const t = setup();
  t.d.escalations.push(
    { id: 'j1', at: t.clock.now, workerId: 'x', by: 'Hedy', role: 'lead-developer', urgency: 'important', fyi: false, level: 2, title: 'Which matrix?', details: 'Jeff noticed Hedy ended its turn waiting on you (question, 90% sure).', options: [], status: 'open' },
    { id: 'o1', at: t.clock.now, workerId: 'y', by: 'Toni', role: 'lead-tester', urgency: 'important', fyi: false, level: 2, title: 'Sign off?', details: 'Toni was benched while waiting on the Project Manager, without having escalated it. The office raised this on its behalf from its handoff note (x).', options: [], status: 'open' },
  );
  t.chatter.look(t.floor);
  const [jeff, office] = ['j1', 'o1'].map((id) => t.sent.find((m) => m.ref?.escalationId === id)!);
  assert.deepEqual([jeff.from.kind, jeff.from.name, jeff.text], ['jeff', 'Jeff', 'Hedy ended its turn waiting on you: Which matrix?']);
  assert.deepEqual([office.from.kind, office.text], ['office', "Toni's handoff note says it's waiting on you: Sign off?"]);
  t.chatter.stop();
});

test('standups, decisions, handoffs, hires from a handoff and subagent reviews come off the roster', async () => {
  const t = setup();
  // Level 1: every proposal waits on the Project Manager.
  t.d.settings.autonomy = 1;
  await hire(t, 'pm');
  const dev = await hire(t, 'lead-developer');
  const s = t.roster.standups.run(t.floor, 'Keith');
  assert.notEqual(typeof s, 'string');
  t.chatter.look(t.floor);
  const start = t.sent.find((m) => m.kind === 'standup')!;
  assert.equal(start.from.kind, 'office');
  assert.match(start.text, /Standup time 📋 \(Keith called it\).*Asking Hedy/);
  // Hedy's report comes from its journal entry for today.
  mkdirSync(path.join(t.floor.cwdOf(t.floor.worker(dev)!), 'docs', 'team'), { recursive: true });
  const { writeFileSync } = await import('node:fs');
  writeFileSync(path.join(t.floor.cwdOf(t.floor.worker(dev)!), 'docs/team/development.md'), '# Dev\n\n## 2026-10-05 14:00 Standup\n### Done\n- Orders entity\n### Next\n- Invoices\n### Blockers\n- none\n### Proposals\n- [task] Split the module — too big\n');
  t.clock.now += MIN;
  t.floor.set(dev, 'working');
  t.floor.set(dev, 'done');
  t.chatter.look(t.floor);
  const report = t.sent.find((m) => m.kind === 'standup' && m.from.name === 'Hedy')!;
  assert.equal(report.text, 'Done: Orders entity. Next: Invoices.');
  // The Project Manager decides on Hedy's proposal.
  const p = t.d.proposals.find((x) => x.by === 'Hedy')!;
  t.clock.now += MIN;
  assert.equal(await t.roster.standups.decide(t.floor, p.id, 'reject', 'Keith', 'not now'), undefined);
  t.chatter.look(t.floor);
  const dec = t.sent.find((m) => m.kind === 'answer' && m.ref?.standup)!;
  assert.deepEqual([dec.from.kind, toName(dec), dec.text], ['human', 'Hedy', 'Not doing “Split the module”: not now']);
  // A subagent review.
  t.clock.now += MIN;
  t.roster.subagents.review(t.floor, 'lead-developer', 'developer', 'rework', 'missing the index');
  t.chatter.look(t.floor);
  const rv = t.sent.find((m) => m.kind === 'review')!;
  assert.deepEqual([rv.from.name, toName(rv), (rv.to as ChatterParty).role, rv.text], ['Hedy', 'developer', "Hedy's subagent", 'Needs rework 🔁 missing the index']);
  // A handoff note, then a fresh hire primed with it.
  t.clock.now += MIN;
  t.d.members['lead-designer'].handoff = { at: t.clock.now, text: '## 2026-10-05 Handoff\n\nI handed the wireframes to Hedy.' };
  t.d.members['lead-designer'].phase = 'benched';
  t.chatter.look(t.floor);
  const ho = t.sent.find((m) => m.kind === 'handoff')!;
  assert.deepEqual([ho.from.name, toName(ho)], ['Anita', 'team']);
  assert.equal(ho.text, 'Handoff: I handed the wireframes to Hedy.');
  t.clock.now += MIN;
  await hire(t, 'lead-designer');
  t.chatter.look(t.floor);
  const back = t.sent.filter((m) => m.kind === 'handoff').at(-1)!;
  assert.deepEqual([back.from.kind, toName(back)], ['office', 'Anita']);
  assert.match(back.text, /fresh from your handoff note/);
  t.chatter.stop();
});

test('nudges, a tell between agents and a subagent dispatch come in as they happen', async () => {
  const t = setup();
  const dev = await hire(t, 'lead-developer');
  const des = await hire(t, 'lead-designer');
  agentTold(t.floor.id, t.floor.worker(dev)!, t.floor.worker(des)!, 'Can you check the order page spacing?');
  const tell = t.sent.at(-1)!;
  assert.deepEqual([tell.kind, from(tell).name, from(tell).role, toName(tell), (tell.to as ChatterParty).role], ['relay', 'Hedy', 'Lead Developer', 'Anita', 'Lead Designer']);
  assert.equal(noteDispatch(dev, { tool_name: 'Agent', tool_input: { subagent_type: 'developer', description: 'Draft MDL for Orders', prompt: 'Write the MDL for the Orders entity' } }, t.clock.now), true);
  const dispatch = t.sent.at(-1)!;
  assert.deepEqual([dispatch.kind, from(dispatch).name, toName(dispatch), (dispatch.to as ChatterParty).team], ['dispatch', 'Hedy', 'developer', 'development']);
  assert.equal(dispatch.text, 'Draft MDL for Orders — Write the MDL for the Orders entity');
  assert.equal(noteDispatch(dev, { tool_name: 'Bash', tool_input: { command: 'ls' } }), false);
  // The review nudge after a subagent came back.
  const { noteSubagentHook } = await import('../src/server/workers/subagents.js');
  t.floor.set(dev, 'working');
  noteSubagentHook(dev, { tool_name: 'Agent', tool_input: { subagent_type: 'developer', description: 'x' } }, false, t.clock.now);
  t.floor.set(dev, 'done');
  t.clock.now += 20_000;
  assert.equal(t.roster.nudges.check(t.floor, 'lead-developer'), true);
  const nudge = t.sent.at(-1)!;
  assert.deepEqual([nudge.kind, nudge.from.kind, toName(nudge), nudge.text], ['nudge', 'office', 'Hedy', 'Your developer is back: review what it did, then carry on or escalate.']);
  t.chatter.stop();
});

test('journals: the first look takes the latest few, later looks only what is new, and lines naming someone are said to them', () => {
  const t = setup();
  const head = '# Development journal\n\n';
  t.journals.development = `${head}## 2026-09-01 Old entry\nAncient.\n\n## 2026-10-04 09:00 Standup\n- Did things\n\n## 2026-10-05 10:30 Notes\nPlain notes, nobody named.\n`;
  t.chatter.look(t.floor);
  const first = t.sent.filter((m) => m.kind === 'journal');
  assert.deepEqual(first.map((m) => m.text), ['Standup: Did things', 'Notes: Plain notes, nobody named.'], 'the September one is history');
  assert.equal(first[1].at, Date.UTC(2026, 9, 5, 2, 30), '10:30 in Singapore, the default schedule zone');
  assert.equal(first[1].ref?.journal, 'docs/team/development.md#2026-10-05 10:30 Notes');
  t.clock.now += MIN;
  t.journals.development += "\n## 2026-10-05 13:00 Handing over\n- I handed the order specs to Anita\n- I've asked Toni to rerun the suite\n- Keith wants the plan by Friday\n- Waiting on the Project Manager for the budget\n- Ana is not on the team\n";
  t.chatter.look(t.floor);
  const later = t.sent.filter((m) => m.kind === 'journal').slice(first.length);
  assert.deepEqual(later.map((m) => [toName(m), m.text]), [
    ['Anita', 'I handed the order specs to Anita'],
    ['Toni', "I've asked Toni to rerun the suite"],
    ['Keith', 'Keith wants the plan by Friday'],
    ['pm', 'Waiting on the Project Manager for the budget'],
  ]);
  assert.equal((later[2].to as ChatterParty).kind, 'agent', 'Keith in a journal is the Coordinator');
  assert.equal(later[0].from.name, 'Hedy');
  t.chatter.lookAll();
  assert.equal(t.sent.filter((m) => m.kind === 'journal').length, first.length + later.length, 'nothing twice');
  t.chatter.stop();
});

test('journal helpers: keys for repeated headings, heading times, mentions as whole words', () => {
  const entries = textReader('## 2026-10-05 Standup\na\n## 2026-10-05 Standup\nb\n');
  assert.deepEqual(entryKeys(entries), ['2026-10-05|2026-10-05 Standup#1', '2026-10-05|2026-10-05 Standup#2']);
  assert.equal(headingTime({ heading: '2026-10-05 09:15 Standup', date: '2026-10-05', body: '' }, 'UTC'), Date.UTC(2026, 9, 5, 9, 15));
  assert.equal(headingTime({ heading: '2026-10-05 Standup', date: '2026-10-05', body: '' }, 'UTC'), undefined);
  const m = mentions('Asked Ann to look\nAnnabel is someone else\n**Ann** reviewed it', [{ key: 'x', name: 'Ann' }]);
  assert.deepEqual(m.get('x'), ['Asked Ann to look', 'Ann reviewed it']);
});

test('text is redacted and clipped; an empty one is dropped', () => {
  assert.equal(cleanText('token ghp_abcdefghijklmnopqrstuvwxyz123456 here'), 'token [redacted] here');
  assert.equal(cleanText('password: hunter2hunter2'), 'password: [redacted]');
  const long = cleanText('word '.repeat(200));
  assert.equal(long.length, 400);
  assert.ok(long.endsWith('…'));
  const t = setup();
  assert.equal(t.chatter.add(t.floor.id, { kind: 'relay', from: { name: 'A', kind: 'agent' }, to: { group: 'team' }, text: '   ' }), undefined);
  const m = t.chatter.add(t.floor.id, { kind: 'relay', from: { name: 'A', kind: 'agent' }, to: { group: 'team' }, text: 'key sk-abcdefghijklmnop1234 leaked' })!;
  assert.equal(m.text, 'key [redacted] leaked');
  assert.ok(!readFileSync(path.join(t.dataDir, 'chatter', `${t.floor.id}.jsonl`), 'utf8').includes('sk-abc'));
  t.chatter.stop();
});

test('the file is capped, survives a restart, and pages with a cursor newest first', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'chatter-cap-'));
  const f = new ChatterFile(dir, 'fl', 10);
  for (let i = 0; i < 12; i++) f.add({ id: `m${String(i).padStart(2, '0')}`, at: 1000 + i, floor: 'fl', from: { name: 'A', kind: 'agent' }, to: { group: 'team' }, kind: 'relay', text: `n${i}` });
  assert.ok(f.messages().length <= 10);
  assert.equal(f.messages().at(-1)!.text, 'n11');
  const again = new ChatterFile(dir, 'fl', 10);
  assert.deepEqual(again.messages().map((m) => m.text), f.messages().map((m) => m.text));

  const t = setup();
  for (let i = 0; i < 5; i++) t.chatter.add(t.floor.id, { kind: 'relay', from: { name: i % 2 ? 'Hedy' : 'Keith', kind: i % 2 ? 'agent' : 'human' }, to: { group: 'team' }, text: `m${i}`, at: t.clock.now - (5 - i) * MIN });
  const p1 = t.chatter.page(t.floor.id, { limit: 2 });
  assert.deepEqual(p1.messages.map((m) => m.text), ['m4', 'm3']);
  const p2 = t.chatter.page(t.floor.id, { limit: 2, cursor: p1.cursor });
  assert.deepEqual(p2.messages.map((m) => m.text), ['m2', 'm1']);
  const p3 = t.chatter.page(t.floor.id, { limit: 2, cursor: p2.cursor });
  assert.deepEqual([p3.messages.map((m) => m.text), p3.cursor], [['m0'], undefined]);
  assert.deepEqual(t.chatter.page(t.floor.id, { since: t.clock.now - 2 * MIN - 1 }).messages.map((m) => m.text), ['m4', 'm3']);
  assert.deepEqual(t.chatter.page(t.floor.id, { filter: { with: 'person', name: 'keith', kind: 'human' } }).messages.map((m) => m.text), ['m4', 'm2', 'm0']);
  t.chatter.stop();
});

test('The Firm’s interviews: a reviewer’s question to the Lead, the answer back, an unanswered one, never a sample', async () => {
  const t = setup();
  const dev = await hire(t, 'lead-developer');
  const q = (id: string, extra: object) => ({ id, reviewer: 'code', team: 'development', text: 'Why two modules for orders?', at: t.clock.now - MIN, ...extra });
  const engagement = (id: string, questions: object[], sample = false) => ({ id, floor: t.floor.id, sample, reviewers: [{ id: 'code', name: 'Marcus Hale' }], questions }) as unknown as Engagement;
  const list = [
    engagement('e1', [q('Q1', { to: { role: 'lead-developer', name: 'Hedy', workerId: dev }, status: 'answered', answer: 'One per bounded context. token ghp_abcdefghijklmnopqrstuvwxyz123456', answeredAt: t.clock.now }), q('Q2', { status: 'unanswered', why: 'Hedy is benched' })]),
    engagement('e2', [q('Q9', { status: 'open' })], true),
  ];
  const off = registerChatterSource(firmSource(() => list));
  t.chatter.look(t.floor, false);
  t.chatter.look(t.floor, false);
  const firm = t.sent.filter((m) => m.kind === 'firm');
  assert.equal(firm.length, 4, 'Q1 asked and answered, Q2 asked and unanswered, the sample left out, nothing twice');
  const [ask, ans] = firm.filter((m) => m.ref?.engagement === 'e1' && (m.from.name === 'Hedy' || toName(m) === 'Hedy'));
  assert.deepEqual([ask.from.kind, ask.from.name, ask.from.reviewer, ask.from.role, toName(ask), (ask.to as ChatterParty).role], ['reviewer', 'Marcus Hale', 'code', 'Code & Architecture Reviewer, The Firm', 'Hedy', 'Lead Developer']);
  assert.deepEqual([ans.from.name, ans.from.kind, ans.from.workerId, toName(ans), ans.text], ['Hedy', 'agent', dev, 'Marcus Hale', 'One per bounded context. token [redacted]']);
  assert.ok(betweenAgents(ask) && betweenAgents(ans));
  const none = firm.find((m) => m.from.kind === 'office')!;
  assert.equal(none.text, 'Nobody could answer Q2: Hedy is benched.');
  assert.ok(firm.some((m) => m.text.startsWith('Why') && isGroup(m.to) && m.to.group === 'team'), 'a question nobody got goes to the team');
  assert.deepEqual(interviewDrafts(list[0], t.clock.now + 1), [], 'older than the backfill line: history');
  off();
  t.chatter.stop();
});

test('a PR handed from one agent to another', async () => {
  const t = setup();
  const dev = await hire(t, 'lead-developer');
  const des = await hire(t, 'lead-designer');
  prHanded(t.floor.id, t.floor.worker(dev)!, t.floor.worker(des)!, 42);
  const m = t.sent.at(-1)!;
  assert.deepEqual([m.kind, m.from.name, toName(m), m.text, m.ref?.pr], ['handoff', 'Hedy', 'Anita', 'PR #42 is yours now.', 42]);
  t.chatter.stop();
});

test('GET /api/chatter: a page for the floor, its filters, and a 404 for an unknown floor', () => {
  const t = setup();
  t.chatter.add(t.floor.id, { kind: 'answer', from: { name: 'Keith', kind: 'human', role: 'Project Manager' }, to: { name: 'Hedy', kind: 'agent' }, text: 'Yes', at: t.clock.now - MIN });
  t.chatter.add(t.floor.id, { kind: 'relay', from: { name: 'Hedy', kind: 'agent' }, to: { name: 'Anita', kind: 'agent' }, text: 'Over to you' });
  const cfg = {};
  chatterFor(cfg, () => t.chatter);
  const ctx = { cfg, floors: new Map([[t.floor.id, { id: t.floor.id }]]) } as never;
  const call = (q: string) => {
    let status = 0;
    let body = '';
    const res = { writeHead: (s: number) => void (status = s), end: (b: string) => void (body = b) } as unknown as ServerResponse;
    chatterRoutes.page.handle(ctx, { res, url: new URL(`http://x/api/chatter?${q}`) } as never);
    return { status, body: JSON.parse(body) };
  };
  assert.deepEqual(call(`floor=${t.floor.id}`).body.messages.map((m: ChatterMessage) => m.text), ['Over to you', 'Yes']);
  assert.deepEqual(call(`floor=${t.floor.id}&with=agents`).body.messages.map((m: ChatterMessage) => m.text), ['Over to you']);
  assert.deepEqual(call(`floor=${t.floor.id}&with=me`).body.messages.map((m: ChatterMessage) => m.text), ['Yes']);
  assert.deepEqual(call(`floor=${t.floor.id}&who=Keith&as=agent`).body.messages, []);
  assert.equal(call('floor=nope').status, 404);
  assert.equal(chatterRoutes.page.auth, 'session');
  assert.deepEqual(chatterFilter(new URL('http://x/?who=Hedy')), { with: 'person', name: 'Hedy' });
  t.chatter.stop();
});
