// The team phone (shared/phone.ts, server/phone/, ui/phone/notes.ts): who a message goes to (plain → the
// Project Coordinator, @Name, @team and its warning, a DM, a thread, an escalation's thread → resolve),
// the fallback when there's no Coordinator, a person's message kept in the chatter, the reply read off a
// fixture transcript, the badge and read state, Do not disturb and the digest, and the notifications
// made from the Needs-you items with their buttons.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { WorkerInfo, WorkerStatus } from '../src/shared/protocol.js';
import { alertPlan, badgeOf, channelView, cleanAlerts, cleanReads, defaultRecipient, digestDue, dmMessages, dmThread, dndUntil, isQuiet, mergeReads, parseMention, routeMessage, storedAlerts, teamWarning, threadKey, unreadIn, type PhoneAgent } from '../src/shared/phone.js';
import { Roster } from '../src/server/roster/index.js';
import type { HireAsk, TeamFloor } from '../src/server/roster/types.js';
import { Chatter } from '../src/server/chatter/index.js';
import { ChatterFile } from '../src/server/chatter/store.js';
import { journalSource, textReader } from '../src/server/chatter/journal.js';
import { Phone } from '../src/server/phone/index.js';
import { replyAfter, replyFromFile } from '../src/server/phone/reply.js';
import { PhoneReadStore } from '../src/server/phone/reads.js';
import { phoneTag } from '../src/server/phone/prompt.js';
import { placeOf, readerOf } from '../src/server/http/routes/phone.js';
import { collectNeeds } from '../src/client/ui/needsyou/logic.js';
import { newAlerts, noteOf, notesOf, redCount } from '../src/client/ui/phone/notes.js';
import type { RosterView } from '../src/shared/roster/types.js';
import type { ConvoMsg } from '../src/shared/protocol/convo.js';

const MIN = 60_000;

class FakeFloor implements TeamFloor {
  id = `f${Math.random().toString(36).slice(2, 8)}`;
  name = 'phone-test';
  dir = mkdtempSync(path.join(os.tmpdir(), 'phone-'));
  map = new Map<string, WorkerInfo>();
  prompts: { id: string; text: string; by?: string }[] = [];
  wakes: { id: string; text?: string; by?: string }[] = [];
  roster!: Roster;
  clock!: { now: number };
  private n = 0;
  workers = () => [...this.map.values()];
  worker = (id: string) => this.map.get(id);
  async hire(ask: HireAsk) {
    const id = `w${++this.n}`;
    const w = { id, kind: 'agent', provider: 'claude', model: ask.model, deskId: 'd', name: ask.name, color: '#fff', status: 'starting', acked: true, createdBy: ask.by, createdAt: this.clock.now, prompt: ask.prompt, cols: 80, rows: 24, viewers: [], viewerIds: [] } as unknown as WorkerInfo;
    this.map.set(id, w);
    return w;
  }
  async stop(id: string) {
    this.map.delete(id);
  }
  prompt(id: string, text: string, by?: string) {
    if (!this.map.has(id)) return 'Worker is not running';
    this.prompts.push({ id, text, by });
    return undefined;
  }
  wake(id: string, text?: string, by?: string) {
    this.wakes.push({ id, text, by });
    return undefined;
  }
  rename() {}
  cwdOf = (w: WorkerInfo) => path.join(this.dir, 'wt', w.id);
  openPulls = () => [];
  toast = () => undefined;
  changed = () => undefined;
  /** A worker update, as the office passes it to the roster and then the phone. */
  set(id: string, status: WorkerStatus, phone?: Phone) {
    Object.assign(this.map.get(id)!, { status });
    this.roster.onWorker(this, this.map.get(id)!);
    phone?.onWorker(this, this.map.get(id)!);
  }
}

function setup(transcripts: Record<string, string> = {}) {
  const clock = { now: Date.UTC(2026, 9, 6, 6, 0) };
  const floor = new FakeFloor();
  floor.clock = clock;
  const dataDir = mkdtempSync(path.join(os.tmpdir(), 'phone-data-'));
  const roster = new Roster({ dataDir, floors: () => [floor], makeIssue: async () => ({ number: 7 }), analysis: () => '', now: () => clock.now }, 0);
  floor.roster = roster;
  const chatter = new Chatter(
    { dataDir, roster, floors: () => [floor], floor: (id) => (id === floor.id ? floor : undefined), floorOfWorker: (id) => (floor.map.has(id) ? floor : undefined), now: () => clock.now, broadcast: () => undefined },
    { lookMs: 0, journal: journalSource(() => textReader('')) },
  );
  const phone = new Phone({ roster, chatter, floor: (id) => (id === floor.id ? floor : undefined), transcript: (_f, w) => transcripts[w.id], now: () => clock.now });
  const d = roster.data(floor.id);
  // Every role named here, the Solo Lead too: the roster picks the others' names at random from NAME_POOL,
  // so one left out drew 'Anita' (or Hedy, Ada) one time in thirty and two members shared a name, which the
  // office never allows (members.rename): a journal line naming Anita was then said to both.
  for (const [role, name] of [['pm', 'Keith'], ['lead-developer', 'Hedy'], ['lead-designer', 'Anita'], ['lead-tester', 'Toni'], ['chief-analyst', 'Ada'], ['solo-lead', 'Sol']] as const) d.members[role].name = name;
  assert.equal(new Set(Object.values(d.members).map((m) => m.name.toLowerCase())).size, Object.keys(d.members).length, 'every member a different name');
  return { clock, floor, roster, chatter, phone, d, dataDir };
}

async function hire(t: ReturnType<typeof setup>, role: 'pm' | 'lead-developer' | 'lead-designer' | 'chief-analyst') {
  assert.equal(await t.roster.members.hire(t.floor, role, 'Test'), undefined);
  const id = t.d.members[role].workerId!;
  t.floor.set(id, 'working');
  t.floor.set(id, 'idle');
  return id;
}

const A = (workerId: string, name: string, role?: PhoneAgent['role']): PhoneAgent => ({ workerId, name, ...(role ? { role } : {}) });
const cast = [A('k', 'Keith', 'pm'), A('h', 'Hedy', 'lead-developer'), A('a', 'Anita', 'lead-designer'), A('ada', 'Ada', 'chief-analyst'), A('x', 'Hedy Two')];

/** A Claude Code transcript: the user message that carried the phone message, the agent's reply with a tool call between. */
function transcript(dir: string, userText: string, replies: string[]): string {
  const file = path.join(dir, 'session.jsonl');
  const lines = [
    { type: 'user', uuid: 'u0', message: { role: 'user', content: 'Earlier work' } },
    { type: 'assistant', uuid: 'a0', message: { id: 'm0', content: [{ type: 'text', text: 'Earlier reply' }] } },
    { type: 'user', uuid: 'u1', message: { role: 'user', content: userText } },
    { type: 'assistant', uuid: 'a1', message: { id: 'm1', content: [{ type: 'text', text: replies[0] }, { type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'npm test' } }] } },
    { type: 'user', uuid: 'u2', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'secret output' }] } },
    ...replies.slice(1).map((r, i) => ({ type: 'assistant', uuid: `a${i + 2}`, message: { id: `m${i + 2}`, content: [{ type: 'text', text: r }] } })),
  ];
  writeFileSync(file, lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
  return file;
}

test('routing: a plain message goes to the Coordinator, @Name to that agent (the longest name that fits), @team to every Lead', () => {
  const plain = routeMessage('Where are we?', { in: 'channel' }, cast);
  assert.ok(plain.ok);
  assert.deepEqual(plain.ok && plain.to.map((a) => a.name), ['Keith']);
  const named = routeMessage('@hedy two can you look?', { in: 'channel' }, cast);
  assert.deepEqual(named.ok && [named.to.map((a) => a.name), named.body], [['Hedy Two'], 'can you look?']);
  const hedy = routeMessage('@Hedy, the build?', { in: 'channel' }, cast);
  assert.deepEqual(hedy.ok && [hedy.to.map((a) => a.name), hedy.body], [['Hedy'], 'the build?']);
  const team = routeMessage('@team status before the demo', { in: 'dm', workerId: 'k' }, cast);
  assert.ok(team.ok && team.group === 'team');
  assert.deepEqual(team.ok && team.to.map((a) => a.name), ['Hedy', 'Anita', 'Ada']);
  assert.equal(teamWarning(cast), 'This wakes 3 agents (≈3 turns)');
  assert.equal(teamWarning([A('k', 'Keith', 'pm')]), undefined);
  assert.deepEqual(routeMessage('@Nobody hi', { in: 'channel' }, cast), { ok: false, why: 'Nobody called @Nobody is on this floor' });
  assert.deepEqual(routeMessage('@Hedy', { in: 'channel' }, cast), { ok: false, why: 'Write something after the @mention' });
  assert.equal(parseMention('@teamwork rocks', cast).mention, 'teamwork');
});

test('routing: a DM goes to its agent, a thread to its agents, an escalation thread resolves it', () => {
  const dm = routeMessage('hi', { in: 'dm', workerId: 'a' }, cast);
  assert.deepEqual(dm.ok && dm.to.map((a) => a.name), ['Anita']);
  assert.deepEqual(routeMessage('hi', { in: 'dm', workerId: 'gone' }, cast), { ok: false, why: "That agent isn't on this floor any more" });
  const th = routeMessage('and then?', { in: 'thread', thread: 'th-1', agents: ['h', 'a', 'gone'] }, cast);
  assert.deepEqual(th.ok && th.to.map((a) => a.name), ['Hedy', 'Anita']);
  const esc = routeMessage('After the sprint', { in: 'thread', thread: 'esc:e1', agents: ['h'], escalationId: 'e1' }, cast);
  assert.ok(esc.ok && esc.resolve === 'e1');
  // Nobody from the thread is left: the Coordinator, with a note.
  const left = routeMessage('still there?', { in: 'thread', thread: 'th-2', agents: ['gone'] }, cast);
  assert.ok(left.ok && left.to[0].name === 'Keith' && /Nobody from that thread/.test(left.note ?? ''));
});

test('no Coordinator on the floor: the Chief Analyst, else any Lead, else any agent, with a note', () => {
  const noPm = cast.filter((a) => a.role !== 'pm');
  const r = routeMessage('Where are we?', { in: 'channel' }, noPm);
  assert.ok(r.ok);
  assert.equal(r.ok && r.to[0].name, 'Ada');
  assert.match(r.ok ? (r.note ?? '') : '', /no Project Coordinator at work, so it went to Ada/);
  assert.equal(defaultRecipient([A('h', 'Hedy', 'lead-developer'), A('x', 'Bob')]).to?.name, 'Hedy');
  assert.match(defaultRecipient([A('x', 'Bob')]).note ?? '', /no project team at work, so it went to Bob/);
  assert.deepEqual(routeMessage('hi', { in: 'channel' }, []), { ok: false, why: 'There are no agents on this floor to message' });
});

test('sending: held until the turn is over, by the person, recorded and kept as the person’s message', async () => {
  const t = setup();
  const pm = await hire(t, 'pm');
  t.floor.set(pm, 'working');
  const before = t.floor.prompts.length;
  const r = t.phone.send({ floor: t.floor.id, text: 'What is blocking the demo?', place: { in: 'channel' }, by: 'Sam', admin: false });
  assert.ok(r.ok);
  assert.deepEqual(r.ok && r.to, [{ workerId: pm, name: 'Keith', status: 'held' }]);
  // Nothing typed into a turn under way.
  assert.equal(t.floor.prompts.length, before);
  t.floor.set(pm, 'idle', t.phone);
  const typed = t.floor.prompts.at(-1)!;
  assert.equal(typed.id, pm);
  assert.equal(typed.by, 'Sam');
  assert.match(typed.text, /Sam \(the Project Manager, a person\) messaged you on the team phone/);
  assert.match(typed.text, /What is blocking the demo\?/);
  // In the chatter, said by the person, and on disk.
  const kept = new ChatterFile(t.dataDir, t.floor.id).messages().find((m) => m.kind === 'message');
  assert.ok(kept);
  assert.equal(kept!.from.kind, 'human');
  assert.equal(kept!.from.name, 'Sam');
  assert.equal(kept!.text, 'What is blocking the demo?');
  assert.ok(kept!.ref?.thread?.startsWith('th-'));
  assert.deepEqual(t.phone.pendingOn(t.floor.id).map((p) => p.workerId), [pm]);
});

test('sending goes through a reached spend cap (a person’s message), wakes an asleep agent, and is refused with a reason when nobody can take it', async () => {
  const t = setup();
  const pm = await hire(t, 'pm');
  t.d.spend = { day: t.d.spend.day, usd: 99, seen: {} };
  t.d.settings.costCaps = { 1: 1, 2: 1, 3: 1, 4: 1 } as never;
  t.floor.set(pm, 'offline');
  const r = t.phone.send({ floor: t.floor.id, text: 'Wake up please', place: { in: 'channel' }, by: 'Sam', admin: false });
  assert.ok(r.ok && r.to[0].status === 'woke');
  assert.equal(t.floor.wakes.at(-1)?.by, 'Sam');
  const none = setup();
  const bad = none.phone.send({ floor: none.floor.id, text: 'hello', place: { in: 'channel' }, by: 'Sam', admin: false });
  assert.deepEqual(bad, { ok: false, why: 'There are no agents on this floor to message', status: 400 });
});

test('an escalation thread: answered through the roster’s resolve (admins only), its answer in the chatter, and the agent’s reply after', async () => {
  const transcripts: Record<string, string> = {};
  const t = setup(transcripts);
  const dev = await hire(t, 'lead-developer');
  const e = t.roster.escalations.raise(t.floor, t.floor.worker(dev)!, { urgency: 'important', trigger: 'scope', title: 'Add CSV export?', details: 'Asked twice.', options: [] });
  t.chatter.look(t.floor, false);
  const place = { in: 'thread' as const, thread: `esc:${e.id}`, agents: [] };
  assert.deepEqual(t.phone.send({ floor: t.floor.id, text: 'Yes, in v2', place, by: 'Sam', admin: false }), { ok: false, why: 'Only the Project Manager (an admin) can answer escalations', status: 403 });
  const r = t.phone.send({ floor: t.floor.id, text: 'Yes, in v2', place, by: 'Sam', admin: true });
  assert.ok(r.ok && r.resolved === e.id);
  assert.equal(t.d.escalations.find((x) => x.id === e.id)?.status, 'resolved');
  assert.equal(t.d.escalations.find((x) => x.id === e.id)?.resolution?.text, 'Yes, in v2');
  const all = t.chatter.file(t.floor.id).messages();
  const answer = all.find((m) => m.kind === 'answer' && m.ref?.escalationId === e.id);
  assert.equal(answer?.from.kind, 'human');
  assert.equal(threadKey(answer!), `esc:${e.id}`);
  // Its turn on the answer, and the reply read off its transcript into the same thread.
  const answerPrompt = t.floor.prompts.at(-1)!.text;
  transcripts[dev] = transcript(t.floor.dir, answerPrompt, ['On it: CSV export goes into v2.']);
  t.floor.set(dev, 'working', t.phone);
  t.floor.set(dev, 'idle', t.phone);
  const reply = t.chatter.file(t.floor.id).messages().find((m) => m.kind === 'message' && m.from.workerId === dev);
  assert.equal(reply?.text, 'On it: CSV export goes into v2.');
  assert.equal(reply?.ref?.escalationId, e.id);
  assert.equal(t.phone.pending.length, 0);
  // Approve from its button: no words needed.
  const e2 = t.roster.escalations.raise(t.floor, t.floor.worker(dev)!, { urgency: 'important', title: 'Use Atlas cards?', details: '', options: [] });
  const ok = t.phone.send({ floor: t.floor.id, text: '', place: { in: 'thread', thread: `esc:${e2.id}`, agents: [] }, by: 'Sam', admin: true, verdict: 'approve' });
  assert.ok(ok.ok);
  assert.equal(t.d.escalations.find((x) => x.id === e2.id)?.resolution?.verdict, 'approve');
});

test('reply capture: the agent’s text after the message, tool noise left out and Markdown kept; no transcript says so', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'phone-tr-'));
  const tag = phoneTag('abc123');
  const file = transcript(dir, `📱 Sam messaged you\n\nStatus?\n\nAnswer them ${tag}`, ['**Two thirds done**:', '- submit works\n- reject is in review']);
  assert.equal(replyFromFile(file, tag), '**Two thirds done**:\n\n- submit works\n- reject is in review');
  assert.equal(replyFromFile(file, '[team phone nope]'), undefined);
  const msgs: ConvoMsg[] = [{ id: 'u', kind: 'user', text: `hi ${tag}` }, { id: 't', kind: 'tool', tool: 'Bash', summary: 'Ran ls', status: 'ok' }];
  assert.equal(replyAfter(msgs, tag), '');

  // End to end on a floor: the reply in the DM's thread; and with no transcript, the office's note.
  const transcripts: Record<string, string> = {};
  const t = setup(transcripts);
  const pm = await hire(t, 'pm');
  const r = t.phone.send({ floor: t.floor.id, text: 'Status?', place: { in: 'dm', workerId: pm }, by: 'Sam', admin: false });
  assert.ok(r.ok && r.thread === dmThread(pm));
  transcripts[pm] = transcript(t.floor.dir, t.floor.prompts.at(-1)!.text, ['All green.']);
  t.floor.set(pm, 'working', t.phone);
  t.floor.set(pm, 'idle', t.phone);
  const dm = dmMessages(t.chatter.file(t.floor.id).messages(), pm);
  assert.deepEqual(dm.map((m) => [m.from.kind, m.text]), [['human', 'Status?'], ['agent', 'All green.']]);

  delete transcripts[pm];
  t.phone.send({ floor: t.floor.id, text: 'And now?', place: { in: 'dm', workerId: pm }, by: 'Sam', admin: false });
  t.floor.set(pm, 'working', t.phone);
  t.floor.set(pm, 'idle', t.phone);
  const note = t.chatter.file(t.floor.id).messages().at(-1)!;
  assert.equal(note.from.kind, 'office');
  assert.match(note.text, /Keith replied in its terminal/);
  assert.equal(note.ref?.worker, pm);
});

test('threads: a channel folds replies under the thread’s first message', () => {
  const m = (id: string, at: number, thread?: string, esc?: string) => ({ id, at, floor: 'f', from: { name: 'x', kind: 'agent' as const }, to: { group: 'pm' as const }, kind: 'message' as const, text: id, ...(thread || esc ? { ref: { ...(thread ? { thread } : {}), ...(esc ? { escalationId: esc } : {}) } } : {}) });
  const v = channelView([m('c', 3, 'th-1'), m('a', 1, 'th-1'), m('b', 2), m('d', 4, undefined, 'e9'), m('e', 5, undefined, 'e9')]);
  assert.deepEqual(v.map((t) => [t.root.id, t.replies.map((r) => r.id)]), [['a', ['c']], ['b', []], ['d', ['e']]]);
  assert.equal(v[2].key, 'esc:e9');
});

test('badge and read state: a red count for what needs you, else a grey dot; reads survive a restart, later wins', () => {
  assert.deepEqual(badgeOf(3, 9), { kind: 'count', n: 3 });
  assert.deepEqual(badgeOf(0, 2), { kind: 'dot' });
  assert.deepEqual(badgeOf(0, 0), { kind: 'none' });
  const msgs = [{ at: 10, from: { name: 'a', kind: 'agent' as const } }, { at: 20, from: { name: 'Sam', kind: 'human' as const } }, { at: 30, from: { name: 'b', kind: 'office' as const } }];
  assert.equal(unreadIn(msgs, undefined), 2);
  assert.equal(unreadIn(msgs, 10), 1);
  assert.equal(unreadIn(msgs, 30), 0);
  assert.deepEqual(mergeReads({ 'floor:a': 5, 'dm:a:w': 9 }, { 'floor:a': 7, 'dm:a:w': 3 }), { 'floor:a': 7, 'dm:a:w': 9 });
  assert.deepEqual(cleanReads({ 'floor:a': 5, 'evil key': 3, 'dm:x:y': 'no', 'floor:b': -1 }), { 'floor:a': 5 });

  const dir = mkdtempSync(path.join(os.tmpdir(), 'phone-reads-'));
  const store = new PhoneReadStore(dir);
  store.mark('a:u1', { 'floor:f1': 100 });
  store.mark('a:u1', { 'floor:f1': 50, 'dm:f1:w': 70 });
  store.flush();
  assert.deepEqual(new PhoneReadStore(dir).get('a:u1'), { 'floor:f1': 100, 'dm:f1:w': 70 });
  assert.deepEqual(new PhoneReadStore(dir).get('a:u2'), {});
  // Whose: the account, else the browser's own key; never a bad key.
  assert.equal(readerOf({ account: { id: 'acc1' } } as never, 'whatever'), 'a:acc1');
  assert.equal(readerOf({}, 'abcdef123456'), 'b:abcdef123456');
  assert.equal(readerOf({}, '../x'), undefined);
  assert.deepEqual(placeOf({ in: 'thread', thread: 'esc:e1', agents: ['spoofed'], escalationId: 'other' }), { in: 'thread', thread: 'esc:e1', agents: [] });
  assert.equal(placeOf({ in: 'dm', workerId: 'a b' }), undefined);
});

test('Do not disturb and the digest: what goes now, waits, or is dropped', () => {
  const now = new Date(2026, 9, 6, 15, 30).getTime();
  assert.equal(dndUntil('off', now), 0);
  assert.equal(dndUntil('on', now), Infinity);
  assert.equal(dndUntil('1h', now), now + 3_600_000);
  const t = new Date(dndUntil('tomorrow', now));
  assert.deepEqual([t.getDate(), t.getHours(), t.getMinutes()], [7, 9, 0]);
  // Even just after midnight, "tomorrow" is the next day's 9:00.
  assert.equal(new Date(dndUntil('tomorrow', new Date(2026, 9, 6, 0, 10).getTime())).getDate(), 7);
  const s = { dndUntil: 0, digestMinutes: 0, sound: true };
  assert.equal(alertPlan(false, s, now), 'now');
  assert.equal(alertPlan(false, { ...s, digestMinutes: 15 }, now), 'digest');
  assert.equal(alertPlan(true, { ...s, digestMinutes: 15 }, now), 'now');
  assert.equal(alertPlan(true, { ...s, dndUntil: now + 1 }, now), 'drop');
  assert.equal(alertPlan(true, { ...s, dndUntil: now - 1 }, now), 'now');
  assert.ok(isQuiet({ dndUntil: Infinity }, now));
  assert.equal(digestDue({ digestMinutes: 15 }, 2, now - 14 * MIN, now), false);
  assert.equal(digestDue({ digestMinutes: 15 }, 2, now - 15 * MIN, now), true);
  assert.equal(digestDue({ digestMinutes: 15 }, 0, now - 99 * MIN, now), false);
  assert.equal(digestDue({ digestMinutes: 0 }, 5, 0, now), false);
  // Stored and read back, Infinity included; nonsense is the default.
  assert.deepEqual(cleanAlerts(JSON.parse(JSON.stringify(storedAlerts({ dndUntil: Infinity, digestMinutes: 30, sound: false })))), { dndUntil: Infinity, digestMinutes: 30, sound: false });
  assert.deepEqual(cleanAlerts({ dndUntil: 'x', digestMinutes: 7 }), { dndUntil: 0, digestMinutes: 0, sound: true });
});

test('notifications are the Needs-you items: the right voice, the buttons that act, the red count and which alert', () => {
  const now = Date.now();
  const roster = {
    floor: 'f1',
    admin: true,
    escalations: [
      { id: 'e1', at: now - 5 * MIN, workerId: 'h', by: 'Hedy', urgency: 'important', title: 'Add CSV export?', details: '', options: [], level: 2, fyi: false, status: 'open' },
      { id: 'e2', at: now - 9 * MIN, workerId: 'h', by: 'Hedy', urgency: 'critical', title: 'Prod is down', details: '', options: [], level: 2, fyi: false, status: 'open' },
    ],
    approvals: [],
    paused: 'Spent $5.00 of the $4.00 cap',
    settings: { jeff: { priority: 'off' } },
  } as unknown as RosterView;
  const w = { id: 'k', kind: 'agent', name: 'Keith', status: 'needs_input', activity: 'Allow Bash?', deskId: 'd', color: '#fff', acked: false, createdBy: 't', createdAt: 0, cols: 80, rows: 24, viewers: [], waitingSince: now - MIN } as unknown as WorkerInfo;
  const pull = { number: 14, title: 'Reject with reason', state: 'OPEN', isDraft: false, checks: 'fail', updatedAt: new Date(now).toISOString() } as never;
  const floors = [{ id: 'f1', name: 'one', waiting: 1 }, { id: 'f2', name: 'two', waiting: 2 }] as never;
  const items = collectNeeds({ floor: 'f1', workers: [w], roster, pulls: [pull], floors });
  const notes = notesOf(items, true);
  const esc = notes.find((n) => n.key === 'esc-e1')!;
  assert.equal(esc.voice, 'jeff');
  assert.deepEqual(esc.actions.map((a) => a.do), ['reply', 'approve', 'reject']);
  assert.ok(esc.actions.every((a) => a.do === 'go' || a.escalation === 'e1'));
  assert.deepEqual(noteOf(items.find((n) => n.key === 'esc-e1')!, false).actions.map((a) => a.label), ['View']);
  const asking = notes.find((n) => n.kind === 'asking')!;
  assert.equal(asking.voice, 'office');
  assert.equal(asking.text, 'Keith is asking in its terminal: Allow Bash?');
  assert.deepEqual(asking.actions, [{ do: 'go', target: { to: 'worker', id: 'k' }, label: 'Open terminal' }]);
  assert.deepEqual(notes.find((n) => n.kind === 'paused')!.actions, [{ do: 'go', target: { to: 'settings', section: 'team' }, label: 'Raise cap' }]);
  assert.deepEqual(notes.find((n) => n.kind === 'pr')!.actions.map((a) => a.label), ['Merge…', 'Review']);
  // Red: this floor's items, and everyone waiting elsewhere (2 on f2), not double-counting f1.
  assert.equal(redCount(items, floors, 'f1'), items.filter((n) => n.kind !== 'floor').length + 2);
  // Alerts the phone sends itself: new, not a worker asking (session.ts has that), not a loud escalation (the office's own alert).
  const fresh = newAlerts(items, new Set());
  assert.ok(fresh.some((n) => n.key === 'esc-e1'));
  assert.ok(fresh.some((n) => n.kind === 'pr'));
  assert.ok(!fresh.some((n) => n.kind === 'asking' || n.key === 'esc-e2'));
  assert.deepEqual(newAlerts(items, new Set(items.map((n) => n.key))), []);
});

test('a new sev1 incident sounds an alert on the team phone (a sev2 only waits in Needs you); Do not disturb holds it', () => {
  const now = Date.UTC(2026, 9, 6, 12);
  const incidents = [
    { id: 'i1', number: 1, title: 'Real agents started', severity: 'sev1' as const, status: 'open' as const, floors: [], detectedAt: now - 60_000 },
    { id: 'i2', number: 2, title: 'Crash loop', severity: 'sev2' as const, status: 'open' as const, floors: ['f1'], detectedAt: now - 30_000 },
  ];
  const items = collectNeeds({ floor: 'f1', workers: [], roster: undefined, pulls: [], floors: [], incidents });
  assert.deepEqual(items.filter((n) => n.kind === 'incident').map((n) => n.key), ['incident-i1', 'incident-i2']);
  const fresh = newAlerts(items, new Set());
  assert.deepEqual(fresh.map((n) => n.key), ['incident-i1']);
  assert.equal(fresh[0].level, 'block');
  assert.deepEqual(newAlerts(items, new Set(['incident-i1'])), [], 'once');
  // It's red: shown now even with a digest on, and dropped while Do not disturb is on.
  const s = cleanAlerts(undefined);
  assert.equal(alertPlan(fresh[0].level === 'block', { ...s, digestMinutes: 15 }, now), 'now');
  assert.equal(alertPlan(fresh[0].level === 'block', { ...s, dndUntil: Infinity }, now), 'drop');
});
