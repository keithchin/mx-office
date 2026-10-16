// Tell honesty (the packtrack audit of 16 Oct, findings 4 and 5): an agent's `office-workers tell` / tell_worker
// says only what the office has evidence for (queued, typed, received; never "Told" before the session shows it),
// and a message with nothing in it (empty, whitespace, only a marker or only the "About …:" prefill an Ask button
// puts in the box) is refused before anything is recorded or typed. Fake floors only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { WorkerInfo, WorkerStatus } from '../src/shared/protocol.js';
import { Roster } from '../src/server/roster/index.js';
import type { HireAsk, TeamFloor } from '../src/server/roster/types.js';
import { sendAsAnswer } from '../src/server/roster/dispatch-send.js';
import { EMPTY_TELL, isEmptyTell, tellBody } from '../src/shared/tell-text.js';
import { tellReply, tellState } from '../src/server/hooks/tell-reply.js';
import { handleMcp } from '../bin/office-workers.js';

// The payload of dsp_01M51S9XJC1XR77CBX8MK6HWVY as Katherine got it: the prefill and the marker, nothing else.
const LOST = 'About "Allow `mxcli exec` on a scratch copy of the .mpr for the row 3 capability probes":\n\n[office answer dsp_01M51S9XJC1XR77CBX8MK6HWVY · TELL-lead rev 4]';

test('nothing to send: empty, whitespace, only a marker or a Task line, or only the untouched prefill', () => {
  for (const t of ['', '   ', '\n\t\r\n', '[office answer dsp_01M51S9XJC1XR77CBX8MK6HWVY · TELL-lead rev 4]', 'Task: tsk_01M51S9XJC1XR77CBX8MK6HWVY', 'About "Allow mxcli exec": ', 'about "x":', LOST, undefined, 42]) {
    assert.equal(isEmptyTell(t), true, JSON.stringify(t));
  }
  assert.equal(EMPTY_TELL, 'Nothing to send: the message was empty');
  // Anything the person actually wrote goes, the prefill with it.
  assert.equal(tellBody('About "Allow mxcli exec": yes, on the scratch copy only'), 'About "Allow mxcli exec": yes, on the scratch copy only');
  assert.equal(tellBody('Rebase on main\n\nTask: tsk_01M51S9XJC1XR77CBX8MK6HWVY'), 'Rebase on main');
  assert.equal(isEmptyTell('ok'), false);
  assert.equal(isEmptyTell('About the release: go'), false);
});

test('the tell reply says what happened: queued mid-turn, typed between turns, received; never "Told"', () => {
  assert.equal(tellState({ sent: 'held', status: 'working' }), 'queued');
  assert.equal(tellState({ sent: 'held', status: 'needs_input' }), 'queued');
  // Typed into a turn under way: Claude Code queues it until the turn ends, so it's queued, not received.
  assert.equal(tellState({ sent: 'sent', status: 'working' }), 'queued');
  assert.equal(tellState({ sent: 'sent', status: 'idle' }), 'typed');
  assert.equal(tellState({ sent: 'woke', status: 'exited' }), 'typed');
  assert.equal(tellState({ sent: 'sent', status: 'idle', received: true }), 'received');
  const q = tellReply('Sophie', { sent: 'sent', status: 'working' });
  assert.match(q.note, /^Queued for Sophie \(mid-turn; it goes in when Sophie's turn ends\)/);
  assert.match(tellReply('Sophie', { sent: 'held', status: 'needs_input' }).note, /^Queued for Sophie \(answering a question in its terminal;/);
  assert.match(tellReply('Sophie', { sent: 'sent', status: 'done' }).note, /^Typed into Sophie's terminal \(typed between turns\); the office will confirm when Sophie receives it\./);
  assert.match(tellReply('Sophie', { sent: 'woke', status: 'offline' }).note, /^Typed into Sophie's terminal \(Sophie was asleep and starts up with it\)/);
  assert.equal(tellReply('Sophie', { sent: 'sent', status: 'idle', received: true }).note, 'Received by Sophie.');
  for (const sent of ['sent', 'woke', 'held'] as const) for (const status of ['working', 'idle', 'done', 'needs_input', 'exited'] as WorkerStatus[]) assert.doesNotMatch(tellReply('Sophie', { sent, status }).note, /\bTold\b/);
});

test('tell_worker passes the office\'s words on, and never says "Told" on its own', async () => {
  const io = (answer: object) => ({ env: { AGENT_OFFICE_HOOK_URL: 'http://127.0.0.1:4455/', AGENT_OFFICE_WORKER_ID: 'w1', AGENT_OFFICE_HOOK_TOKEN: 'tok' }, fetch: (async () => new Response(JSON.stringify(answer))) as typeof fetch });
  const call = (answer: object) => handleMcp({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'tell_worker', arguments: { worker: 'Sophie', prompt: 'rebase' } } }, io(answer));
  const queued = await call({ ok: true, worker: { name: 'Sophie' }, delivery: 'queued', note: "Queued for Sophie (mid-turn; it goes in when Sophie's turn ends). Not received yet; don't send it again." });
  assert.match(queued?.result.content[0].text, /^Queued for Sophie/);
  // An older office with no note: still no "Told".
  const old = await call({ ok: true, worker: { name: 'Sophie' } });
  assert.equal(old?.result.content[0].text, 'Handed to the office for Sophie; not confirmed received yet.');
  // The office refusing an empty one: the caller reads why.
  const refused = { env: io({}).env, fetch: (async () => new Response(JSON.stringify({ error: EMPTY_TELL }), { status: 400 })) as typeof fetch };
  const r = await handleMcp({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'tell_worker', arguments: { worker: 'Sophie', prompt: ' ' } } }, refused);
  assert.equal(r?.result.isError, true);
  assert.match(r?.result.content[0].text, /Nothing to send: the message was empty/);
});

// ---- On a fake floor: the person's tells ------------------------------------------------------------------

class FakeFloor implements TeamFloor {
  id = `tell-${Math.random().toString(36).slice(2, 8)}`;
  name = 'tell-honesty-test';
  dir = mkdtempSync(path.join(os.tmpdir(), 'tell-floor-'));
  map = new Map<string, WorkerInfo>();
  typed: string[] = [];
  roster!: Roster;
  private n = 0;
  workers = () => [...this.map.values()];
  worker = (id: string) => this.map.get(id);
  async hire(ask: HireAsk): Promise<WorkerInfo> {
    const id = `w${++this.n}`;
    const w = { id, kind: 'agent', provider: 'claude', deskId: 'd', name: ask.name, color: '#fff', status: 'idle', acked: true, createdBy: ask.by, createdAt: 0, cols: 80, rows: 24, viewers: [], viewerIds: [] } as unknown as WorkerInfo;
    this.map.set(id, w);
    mkdirSync(this.cwdOf(w), { recursive: true });
    return w;
  }
  async stop(id: string) {
    this.map.delete(id);
  }
  prompt(_id: string, text: string) {
    this.typed.push(text);
    return undefined;
  }
  wake(_id: string, text?: string) {
    if (text) this.typed.push(text);
    return undefined;
  }
  rename() {}
  cwdOf = (w: WorkerInfo) => path.join(this.dir, 'wt', w.id);
  openPulls = () => [];
  toast = () => {};
  changed = () => {};
  activity = () => {};
}

async function office() {
  const floor = new FakeFloor();
  const roster = new Roster({ dataDir: mkdtempSync(path.join(os.tmpdir(), 'tell-data-')), floors: () => [floor], makeIssue: async () => ({ number: 2 }), analysis: () => '', now: () => Date.now() }, 0);
  floor.roster = roster;
  assert.equal(await roster.members.hire(floor, 'pm', 'Keith'), undefined);
  const w = floor.worker(roster.data(floor.id).members.pm.workerId!)!;
  Object.assign(w, { status: 'idle' });
  floor.typed.length = 0;
  return { floor, roster, w };
}

test("the person's tell with nothing in it is refused: nothing recorded, nothing typed (dsp_01M51S9X…)", async () => {
  const { floor, roster, w } = await office();
  await roster.dispatch.ready(floor.id);
  const before = roster.dispatch.store.list(floor.id).length;
  for (const t of ['', '  ', 'About "Allow `mxcli exec` on a scratch copy of the .mpr for the row 3 capability probes": ']) {
    assert.equal(await roster.interrupts.tell(floor, t, 'Keith', 'now'), EMPTY_TELL, JSON.stringify(t));
  }
  // An escalation's or a sign-off's tell goes through the same durable send: refused there too.
  const { result } = await sendAsAnswer(roster, floor, w, 'About "Can\'t now": ', { origin: 'person', by: 'Keith', wake: true }, { decision: 'tell:esc-abc', by: 'Keith' });
  assert.deepEqual(result, { ok: false, status: 400, error: EMPTY_TELL });
  assert.equal(floor.typed.length, 0, 'nothing typed');
  assert.equal(roster.dispatch.store.list(floor.id).length, before, 'no dispatch recorded');
  // Something said goes.
  assert.equal(await roster.interrupts.tell(floor, 'About "Allow mxcli exec": yes, on the scratch copy', 'Keith', 'now'), undefined);
  assert.equal(floor.typed.length, 1);
  assert.match(floor.typed[0], /yes, on the scratch copy\n\n\[office answer dsp_[0-9A-Z]{26} · TELL-lead rev \d+\]$/);
});
