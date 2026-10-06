// Jeff, the Router (server/judge/, roster/jeff.ts): the Jev request and answers, the Haiku fallback's
// JSON, redaction, the circuit breaker and the key file, all with a fake fetch and a fake Haiku (no
// network, no model); then his two judgements on a fake floor: shadow logs but never acts, on raises
// an escalation once and labels only unlabelled issues he's sure of.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { GhIssue, WorkerInfo, WorkerStatus } from '../src/shared/protocol.js';
import type { JudgeMade, JudgeRow } from '../src/shared/judge.js';
import { summarize } from '../src/shared/judge.js';
import { Judge, type HaikuLike } from '../src/server/judge/index.js';
import { JevKey } from '../src/server/judge/key.js';
import { JudgeLog } from '../src/server/judge/log.js';
import { Breaker, clipState, fallbackSchema, JEV_URL, jevRequest, parseFallback, parseJev, redact, type Questions } from '../src/server/judge/pure.js';
import { lastAssistantText } from '../src/server/judge/turns.js';
import { childEnv } from '../src/server/workers/env.js';
import { Roster } from '../src/server/roster/index.js';
import { questionLine, triageQuestions, WAITING_QUESTIONS } from '../src/server/roster/jeff.js';
import type { TeamFloor } from '../src/server/roster/types.js';
import type { TeamId } from '../src/shared/roster/roles.js';

const Q: Questions = {
  waiting: { type: 'noul', instructions: 'waits?' },
  kind: { type: 'choice', instructions: 'kind', criteria: { question: 'q', fyi: 'f', none: 'n' } },
  priority: { type: 'score', instructions: 'p', criteria: ['low', 'normal', 'high'] },
};

const jevBody = {
  model: 'jev-1.13.0',
  answers: {
    waiting: { type: 'noul', noul: 0.97 },
    kind: { type: 'choice', choice: 'question', confidence: 0.9, probabilities: { question: 0.9, fyi: 0.05, none: 0.05 } },
    priority: { type: 'score', score: 1.0, confidence: 0.8, legend: { 0: 'low' }, probabilities: { 0: 0.1, 1: 0.8, 2: 0.1 } },
  },
  usage: { input_tokens: 10, output_tokens: 0 },
};

function fakeFetch(respond: () => { status: number; body?: unknown } | 'throw' | 'hang') {
  const calls: { url: string; init: RequestInit }[] = [];
  const f = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const r = respond();
    if (r === 'throw') throw new Error('ECONNREFUSED');
    if (r === 'hang') return new Promise((_res, rej) => init.signal?.addEventListener('abort', () => rej(new Error('aborted'))));
    return { ok: r.status < 300, status: r.status, json: async () => r.body } as Response;
  }) as unknown as typeof fetch;
  return { f, calls };
}

function fakeHaiku(answer: unknown, enabled = true): HaikuLike & { asked: string[] } {
  const asked: string[] = [];
  return { enabled, asked, ask: async (_s: string, input: string) => (asked.push(input), answer) };
}

const haikuAnswer = { answers: { waiting: { noul: 0.8 }, kind: { choice: 'question', probabilities: { question: 0.7, fyi: 0.2, none: 0.1 } }, priority: { score: 2, confidence: 0.6 } } };

// ---- Pure parts --------------------------------------------------------------------------------------

test('the Jev request has the model, the state and the questions as the quickstart says', () => {
  assert.deepEqual(jevRequest('hello', Q), { model: 'jev-latest', state: 'hello', questions: Q });
});

test("Jev's answers are parsed per type; a missing or out-of-range answer is no verdict", () => {
  const v = parseJev(Q, jevBody)!;
  assert.equal(v.model, 'jev-1.13.0');
  assert.deepEqual(v.answers.waiting, { type: 'noul', noul: 0.97 });
  assert.equal(v.answers.kind.type === 'choice' && v.answers.kind.choice, 'question');
  assert.equal(v.answers.priority.type === 'score' && v.answers.priority.level, 'normal');
  assert.equal(parseJev(Q, { answers: { ...jevBody.answers, kind: { choice: 'banana' } } }), undefined);
  assert.equal(parseJev(Q, { answers: { waiting: { noul: 0.5 } } }), undefined);
  assert.equal(parseJev(Q, null), undefined);
});

test("the fallback's JSON is read with or without a code fence, and checked like Jev's", () => {
  const a = parseFallback(Q, haikuAnswer)!;
  assert.equal(a.kind.type === 'choice' && a.kind.confidence, 0.7);
  assert.equal(a.priority.type === 'score' && a.priority.level, 'high');
  const fenced = parseFallback(Q, '```json\n' + JSON.stringify(haikuAnswer) + '\n```')!;
  assert.deepEqual(fenced, a);
  // The answers map itself, without the wrapper, is accepted too; numbers are clamped.
  assert.equal((parseFallback(Q, { ...haikuAnswer.answers, waiting: { noul: 7 } })!.waiting as { noul: number }).noul, 1);
  assert.equal(parseFallback(Q, 'not json'), undefined);
  assert.equal(parseFallback(Q, { answers: { waiting: { noul: 0.5 } } }), undefined);
  const schema = fallbackSchema(Q) as any;
  assert.deepEqual(schema.properties.answers.required, ['waiting', 'kind', 'priority']);
  assert.deepEqual(schema.properties.answers.properties.kind.properties.choice.enum, ['question', 'fyi', 'none']);
});

test('redaction takes out tokens and keys; clipping keeps the end (or the start) after redacting', () => {
  const text = 'use github_pat_11ABCDEFG0123456789_abcdefXYZ and ghp_abcdefghijklmnopqrstuvwxyz0123 with sk-ant-api03-abcdefghijklmnop and Authorization: Bearer abc.def.ghijkl; password=hunter2hunter2';
  const r = redact(text);
  for (const s of ['github_pat_11', 'ghp_abc', 'sk-ant', 'abc.def.ghijkl', 'hunter2']) assert.ok(!r.includes(s), `${s} left in: ${r}`);
  assert.match(r, /password=\[redacted\]/);
  const long = `${'a'.repeat(5000)} ghp_abcdefghijklmnopqrstuvwxyz0123 END`;
  const tail = clipState(long, 100);
  assert.equal(tail.length, 100);
  assert.ok(tail.endsWith('[redacted] END'));
  assert.ok(clipState(`START ${'b'.repeat(5000)}`, 50, 'head').startsWith('START'));
});

test('the breaker opens after two failures, for a while, then lets one through', () => {
  let now = 0;
  const b = new Breaker(() => now, 2, 1000);
  b.fail('x');
  assert.equal(b.open, false);
  b.fail('y');
  assert.equal(b.open, true);
  assert.equal(b.lastError, 'y');
  now = 1001;
  assert.equal(b.open, false);
  b.ok();
  assert.equal(b.lastError, undefined);
});

test('the key comes from the key file (first line), re-read when it changes, else TYPESAFE_API_KEY; workers never get either', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'jev-key-'));
  const file = path.join(dir, 'key');
  let now = 0;
  const env: NodeJS.ProcessEnv = { AGENT_OFFICE_JEV_KEY_FILE: file, TYPESAFE_API_KEY: 'env-key' };
  const k = new JevKey(env, () => now);
  assert.equal(k.get(), 'env-key');
  writeFileSync(file, '  file-key  \nsecond line\n');
  assert.equal(k.get(), 'env-key', 'not looked at again within 30s');
  now += 31_000;
  assert.equal(k.get(), 'file-key');
  assert.equal(new JevKey({}).get(), undefined);
  const saved = { a: process.env.TYPESAFE_API_KEY, b: process.env.AGENT_OFFICE_JEV_KEY_FILE };
  process.env.TYPESAFE_API_KEY = 'secret';
  process.env.AGENT_OFFICE_JEV_KEY_FILE = file;
  try {
    const e = childEnv();
    assert.equal(e.TYPESAFE_API_KEY, undefined);
    assert.equal(e.AGENT_OFFICE_JEV_KEY_FILE, undefined);
  } finally {
    if (saved.a === undefined) delete process.env.TYPESAFE_API_KEY;
    else process.env.TYPESAFE_API_KEY = saved.a;
    if (saved.b === undefined) delete process.env.AGENT_OFFICE_JEV_KEY_FILE;
    else process.env.AGENT_OFFICE_JEV_KEY_FILE = saved.b;
  }
});

test("a transcript's last main-thread assistant message, its text blocks joined", () => {
  const line = (o: object) => JSON.stringify(o);
  const jsonl = [
    line({ type: 'assistant', message: { id: 'm1', content: [{ type: 'text', text: 'old' }] } }),
    line({ type: 'assistant', isSidechain: true, message: { id: 's', content: [{ type: 'text', text: 'subagent' }] } }),
    line({ type: 'assistant', message: { id: 'm2', content: [{ type: 'text', text: 'Done.' }] } }),
    line({ type: 'assistant', message: { id: 'm2', content: [{ type: 'tool_use', id: 't' }] } }),
    line({ type: 'assistant', message: { id: 'm2', content: [{ type: 'text', text: 'Shall I merge?' }] } }),
    '{"torn',
  ].join('\n');
  assert.equal(lastAssistantText(jsonl), 'Done.\nShall I merge?');
});

test('questionLine picks the last question, plain', () => {
  assert.equal(questionLine('Built it.\n\n**Should I deploy to prod now?**\n\nThanks'), 'Should I deploy to prod now?');
  assert.equal(questionLine('All done.\n- tests pass'), 'tests pass');
});

// ---- The judge ---------------------------------------------------------------------------------------

test('with a key Jeff asks Jev (bearer key, redacted clipped state) and says so', async () => {
  const { f, calls } = fakeFetch(() => ({ status: 200, body: jevBody }));
  const j = new Judge({ fetch: f, key: () => 'k-123', haiku: fakeHaiku(haikuAnswer) });
  const v = (await j.ask(`${'x'.repeat(6000)} token ghp_abcdefghijklmnopqrstuvwxyz0123`, Q))!;
  assert.equal(v.by, 'jev');
  assert.equal(v.model, 'jev-1.13.0');
  assert.equal(calls[0].url, JEV_URL);
  assert.equal((calls[0].init.headers as Record<string, string>).Authorization, 'Bearer k-123');
  const sent = JSON.parse(String(calls[0].init.body));
  assert.ok(sent.state.length <= 4000);
  assert.ok(!sent.state.includes('ghp_'));
  assert.equal(j.status().state, 'jev');
});

test('no key: the Haiku fallback answers in the same shape; nothing at all: undefined', async () => {
  const { f, calls } = fakeFetch(() => ({ status: 200, body: jevBody }));
  const h = fakeHaiku(haikuAnswer);
  const j = new Judge({ fetch: f, key: () => undefined, haiku: h });
  const v = (await j.ask('Shall I merge?', Q))!;
  assert.equal(v.by, 'haiku');
  assert.equal(calls.length, 0);
  assert.match(h.asked[0], /Shall I merge\?/);
  assert.equal(j.status().state, 'haiku');
  const none = new Judge({ fetch: f, key: () => undefined, haiku: null });
  assert.equal(await none.ask('x', Q), undefined);
  assert.equal(none.status().state, 'unavailable');
  assert.equal(await new Judge({ key: () => undefined, haiku: fakeHaiku('garbage') }).ask('x', Q), undefined);
});

test('Jev failing (5xx, network, timeout, bad JSON) falls back to Haiku, and after two failures Jev is skipped', async () => {
  let mode: 'err' | 'throw' | 'hang' | 'bad' = 'err';
  const { f, calls } = fakeFetch(() => (mode === 'err' ? { status: 503 } : mode === 'bad' ? { status: 200, body: { answers: {} } } : mode));
  let now = 0;
  const j = new Judge({ fetch: f, key: () => 'k', haiku: fakeHaiku(haikuAnswer), now: () => now, timeoutMs: 20 });
  assert.equal((await j.ask('a', Q))!.by, 'haiku');
  mode = 'hang';
  assert.equal((await j.ask('b', Q))!.by, 'haiku');
  assert.equal(calls.length, 2);
  assert.equal(j.status().state, 'haiku');
  assert.match(j.status().detail, /longer than/);
  // Open: Jev isn't even asked.
  assert.equal((await j.ask('c', Q))!.by, 'haiku');
  assert.equal(calls.length, 2);
  now += 6 * 60_000;
  mode = 'throw';
  assert.equal((await j.ask('d', Q))!.by, 'haiku');
  assert.equal(calls.length, 3);
});

// ---- The log and the summary ------------------------------------------------------------------------

test('the log appends JSONL, is capped, and the summary puts disagreements first', () => {
  const log = new JudgeLog(mkdtempSync(path.join(os.tmpdir(), 'judge-log-')), 10, 6);
  const row = (i: number, agree: boolean | null): JudgeRow => ({ at: Date.UTC(2026, 9, 5) + i, kind: i % 2 ? 'triage' : 'waiting', subject: `s${i}`, by: i % 3 ? 'jev' : 'haiku', model: 'm', ms: 100, jeff: 'a', detail: '', rule: agree === null ? 'none' : 'a', agree, acted: false });
  for (let i = 0; i < 12; i++) log.append('f1', row(i, i === 10 ? false : i === 11 ? null : true));
  const rows = log.read('f1');
  assert.ok(rows.length <= 10 && rows.length >= 6);
  assert.equal(rows[rows.length - 1].subject, 's11');
  const s = summarize('f1', rows, { waiting: 'shadow', triage: 'on' }, { state: 'jev', detail: '' }, Date.UTC(2026, 9, 5, 12));
  assert.equal(s.rows[0].subject, 's10');
  const triage = s.kinds.find((k) => k.kind === 'triage')!;
  assert.equal(triage.mode, 'on');
  assert.equal(triage.compared, triage.total - 1);
  assert.equal(s.kinds[0].days.length, 14);
  assert.equal(s.kinds[0].days[13].day, '2026-10-05');
});

// ---- On a floor ---------------------------------------------------------------------------------------

class FakeFloor implements TeamFloor {
  id = `f${Math.random().toString(36).slice(2, 8)}`;
  name = 'test';
  dir = mkdtempSync(path.join(os.tmpdir(), 'jeff-floor-'));
  map = new Map<string, WorkerInfo>();
  words = new Map<string, string>();
  toasts: string[] = [];
  lines: string[] = [];
  labels: { n: number; team: TeamId }[] = [];
  made: JudgeMade[] = [];
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
  labelIssue = async (n: number, team: TeamId) => (this.labels.push({ n, team }), undefined);
  lastWords = (w: WorkerInfo) => this.words.get(w.id);
  judged = (m: JudgeMade) => void this.made.push(m);
  add(id: string, name: string) {
    this.map.set(id, { id, kind: 'agent', provider: 'claude', name, status: 'working', viewers: [], viewerIds: [], createdAt: 0 } as unknown as WorkerInfo);
  }
  set(id: string, status: WorkerStatus) {
    const w = this.map.get(id)!;
    w.status = status;
    this.roster.onWorker(this, w);
  }
}

function setup(answers: Record<string, unknown> | null, by: 'jev' | 'haiku' = 'jev') {
  const floor = new FakeFloor();
  const asked: string[] = [];
  const roster = new Roster(
    {
      dataDir: mkdtempSync(path.join(os.tmpdir(), 'jeff-data-')),
      floors: () => [floor],
      makeIssue: async () => ({ dryRun: true }),
      analysis: () => '',
      now: () => Date.UTC(2026, 9, 5, 3),
      judge: async (text, questions) => {
        asked.push(text);
        if (!answers) return undefined;
        const picked = Object.fromEntries(Object.keys(questions).map((k) => [k, answers[k]]));
        return { by, model: by === 'jev' ? 'jev-1.13.0' : 'claude-haiku', answers: picked as never, ms: 42 };
      },
    },
    0,
  );
  floor.roster = roster;
  return { floor, roster, asked, rows: () => roster.jeff.log.read(floor.id), settle: () => new Promise((r) => setTimeout(r, 20)) };
}

const WAITING = { waiting: { type: 'noul', noul: 0.95 }, kind: { type: 'choice', choice: 'question', confidence: 0.9 } };
const NOT_WAITING = { waiting: { type: 'noul', noul: 0.1 }, kind: { type: 'choice', choice: 'fyi', confidence: 0.8 } };

test('the waiting questions are the ones the spec names', () => {
  assert.equal(WAITING_QUESTIONS.waiting.type, 'noul');
  assert.deepEqual(Object.keys((WAITING_QUESTIONS.kind as { criteria: object }).criteria), ['question', 'permission', 'sign-off', 'fyi', 'none']);
  assert.deepEqual(Object.keys((triageQuestions().team as { criteria: object }).criteria), ['management', 'design', 'development', 'testing', 'analysis']);
});

test('shadow (the default): a turn ending waiting is judged and logged, and nothing is raised', async () => {
  const { floor, roster, rows, settle } = setup(WAITING);
  assert.deepEqual(roster.data(floor.id).settings.jeff, { waiting: 'shadow', triage: 'shadow', priority: 'on', waitingPolicy: 'agree' });
  floor.add('w1', 'Ada');
  floor.words.set('w1', 'I built the page.\n\nShould I deploy it to production?');
  floor.set('w1', 'working');
  floor.set('w1', 'done');
  await settle();
  const r = rows();
  assert.equal(r.length, 1);
  assert.equal(r[0].kind, 'waiting');
  assert.equal(r[0].jeff, 'waiting');
  assert.equal(r[0].rule, 'not waiting');
  assert.equal(r[0].agree, false);
  assert.equal(r[0].acted, false);
  assert.equal(r[0].by, 'jev');
  assert.equal(roster.data(floor.id).escalations.length, 0);
  assert.equal(floor.made[0].verdict, '→ PM');
});

test('on: Jeff raises the escalation once per turn, not when one is already open, and never when he says not waiting', async () => {
  const { floor, roster, rows, settle } = setup(WAITING);
  roster.data(floor.id).settings.jeff.waiting = 'on';
  floor.add('w1', 'Ada');
  floor.words.set('w1', 'Done with the domain model.\n**Can you approve the schema change?**');
  floor.set('w1', 'working');
  floor.set('w1', 'done');
  // The same update again (no new turn) isn't judged again.
  floor.set('w1', 'done');
  await settle();
  const esc = roster.data(floor.id).escalations;
  assert.equal(esc.length, 1);
  assert.equal(esc[0].title, 'Can you approve the schema change?');
  assert.equal(esc[0].fyi, false);
  assert.equal(esc[0].urgency, 'important');
  assert.equal(esc[0].workerId, 'w1');
  assert.match(esc[0].details ?? '', /Jeff noticed Ada ended its turn waiting on you/);
  assert.ok(floor.lines.some((l) => l.includes('Jeff (Router) escalated')));
  assert.equal(rows()[0].acted, true);
  // Next turn ends the same way: the open escalation is the rule saying "waiting" already.
  floor.set('w1', 'working');
  floor.set('w1', 'done');
  await settle();
  assert.equal(roster.data(floor.id).escalations.length, 1);
  assert.equal(rows()[1].agree, true);
  assert.equal(rows()[1].acted, false);
});

test('on, but Jeff says not waiting (or has no answer): nothing raised; no judge at all, nothing logged', async () => {
  const a = setup(NOT_WAITING);
  a.roster.data(a.floor.id).settings.jeff.waiting = 'on';
  a.floor.add('w1', 'Ada');
  a.floor.words.set('w1', 'Merged PR #4. Moving on to the tests.');
  a.floor.set('w1', 'working');
  a.floor.set('w1', 'idle');
  await a.settle();
  assert.equal(a.roster.data(a.floor.id).escalations.length, 0);
  assert.equal(a.rows()[0].agree, true);
  const b = setup(null);
  b.roster.data(b.floor.id).settings.jeff.waiting = 'on';
  b.floor.add('w1', 'Ada');
  b.floor.words.set('w1', 'Shall I?');
  b.floor.set('w1', 'working');
  b.floor.set('w1', 'done');
  await b.settle();
  assert.equal(b.rows().length, 0);
  assert.equal(b.roster.data(b.floor.id).escalations.length, 0);
  // Off: not even asked.
  const c = setup(WAITING);
  c.roster.data(c.floor.id).settings.jeff.waiting = 'off';
  c.floor.add('w1', 'Ada');
  c.floor.words.set('w1', 'Shall I?');
  c.floor.set('w1', 'working');
  c.floor.set('w1', 'done');
  await c.settle();
  assert.equal(c.asked.length, 0);
});

const issue = (number: number, labels: string[] = [], title = 'Login page crashes'): Pick<GhIssue, 'number' | 'title' | 'state' | 'body' | 'labels'> => ({ number, title, state: 'OPEN', body: 'Stack trace in the microflow', labels: labels.map((name) => ({ name, color: '#fff' })) });
const TRIAGE = (conf: number) => ({ team: { type: 'choice', choice: 'development', confidence: conf }, priority: { type: 'score', score: 2, level: 'high: blocks other work' } });

test('triage: the first look is a baseline; new issues are judged and logged; shadow never labels', async () => {
  const { floor, roster, rows, asked } = setup(TRIAGE(0.9), 'haiku');
  await roster.jeff.onIssues(floor, [issue(1), issue(2)]);
  assert.equal(asked.length, 0);
  await roster.jeff.onIssues(floor, [issue(1), issue(2), issue(3), issue(4, ['team:testing'])]);
  const r = rows();
  assert.equal(r.length, 2);
  assert.deepEqual(r.map((x) => [x.subject.split(' ')[0], x.jeff, x.rule, x.agree, x.acted]), [['#3', 'development', 'none', null, false], ['#4', 'development', 'testing', false, false]]);
  assert.equal(r[0].by, 'haiku');
  assert.match(r[0].detail, /priority high/);
  assert.equal(floor.labels.length, 0);
  // Seen once is judged once.
  await roster.jeff.onIssues(floor, [issue(3), issue(4, ['team:testing'])]);
  assert.equal(rows().length, 2);
});

test('triage on: labels only an unlabelled issue, and only when confident', async () => {
  const sure = setup(TRIAGE(0.9));
  sure.roster.data(sure.floor.id).settings.jeff.triage = 'on';
  await sure.roster.jeff.onIssues(sure.floor, []);
  await sure.roster.jeff.onIssues(sure.floor, [issue(12), issue(13, ['team:design'])]);
  assert.deepEqual(sure.floor.labels, [{ n: 12, team: 'development' }]);
  assert.ok(sure.floor.lines.includes('🧑‍⚖️ Jeff (Router) labelled #12 team:development'));
  assert.deepEqual(sure.rows().map((r) => r.acted), [true, false]);
  const unsure = setup(TRIAGE(0.6));
  unsure.roster.data(unsure.floor.id).settings.jeff.triage = 'on';
  await unsure.roster.jeff.onIssues(unsure.floor, []);
  await unsure.roster.jeff.onIssues(unsure.floor, [issue(12)]);
  assert.equal(unsure.floor.labels.length, 0);
});

test('old rosters revive with Jeff in shadow, and bad modes are ignored', async () => {
  const { reviveRoster, cleanSettings } = await import('../src/server/roster/store.js');
  assert.deepEqual(reviveRoster({ settings: { autonomy: 2 } }).settings.jeff, { waiting: 'shadow', triage: 'shadow', priority: 'on', waitingPolicy: 'agree' });
  const s = cleanSettings({ jeff: { waiting: 'on', triage: 'loud' } });
  assert.deepEqual(s.jeff, { waiting: 'on', triage: 'shadow', priority: 'on', waitingPolicy: 'agree' });
});

test("the 'model' policy is kept, and a bad one is ignored", async () => {
  const { cleanSettings } = await import('../src/server/roster/store.js');
  assert.equal(cleanSettings({ jeff: { waitingPolicy: 'model' } }).jeff.waitingPolicy, 'model');
  assert.equal(cleanSettings({ jeff: { waitingPolicy: 'always' } }).jeff.waitingPolicy, 'agree');
});

// A real progress report from a live floor that Jeff (on his say-so) used to escalate.
const FYI_REPORT = "I've approved #49's test results; merging it is the PM's call.\n\nStill running: the #51 Owner-required follow-up. When it's proven and reviewed, I'll send Anita its commit to cherry-pick into #51.";

test('on, agree (the default): a report Jeff thinks is waiting is held and logged as a disagreement, never raised', async () => {
  const { floor, roster, rows, settle } = setup(WAITING);
  roster.data(floor.id).settings.jeff.waiting = 'on';
  floor.add('w1', 'Hedy');
  floor.words.set('w1', FYI_REPORT);
  floor.set('w1', 'working');
  floor.set('w1', 'done');
  await settle();
  assert.equal(roster.data(floor.id).escalations.length, 0);
  const [r] = rows();
  assert.equal(r.jeff, 'waiting');
  assert.equal(r.rule, 'not waiting');
  assert.equal(r.agree, false);
  assert.equal(r.acted, false);
  assert.equal(r.held, 'no-ask');
  assert.equal(floor.made[0].verdict, 'no ask: held');
  // Under 'model' his say-so is enough again.
  roster.data(floor.id).settings.jeff.waitingPolicy = 'model';
  floor.set('w1', 'working');
  floor.set('w1', 'done');
  await settle();
  assert.equal(roster.data(floor.id).escalations.length, 1);
  assert.equal(rows()[1].acted, true);
});

test("on: Jeff doesn't raise again what the worker raised and was just answered", async () => {
  const { floor, roster, rows, settle } = setup(WAITING);
  roster.data(floor.id).settings.jeff.waiting = 'on';
  floor.add('w1', 'Ada');
  floor.words.set('w1', 'Done with the domain model.\n\nCan you approve the schema change?');
  floor.set('w1', 'working');
  floor.set('w1', 'done');
  await settle();
  const esc = roster.data(floor.id).escalations;
  assert.equal(esc.length, 1);
  esc[0].status = 'resolved';
  esc[0].resolution = { verdict: 'approve', text: '', by: 'pm', at: Date.UTC(2026, 9, 5, 2), delivered: true };
  floor.set('w1', 'working');
  floor.set('w1', 'done');
  await settle();
  assert.equal(roster.data(floor.id).escalations.length, 1);
  assert.equal(rows()[1].held, 'duplicate');
  assert.equal(rows()[1].acted, false);
});

test('an agent raising what another already raised joins it as a +1, and hears the answer too', () => {
  const { floor, roster } = setup(WAITING);
  floor.add('w1', 'Anita');
  floor.add('w2', 'Hedy');
  const prompted: string[] = [];
  floor.prompt = ((id: string) => void prompted.push(id)) as never;
  const ask = (title: string) => ({ urgency: 'important' as const, title, details: 'CI #30 sees an empty password.', options: [] });
  const first = roster.escalations.raiseOrJoin(floor, floor.worker('w1')!, ask('Set repo secret E2E_DEMO_ADMIN_PASSWORD'));
  assert.equal(first.joined, false);
  const again = roster.escalations.raiseOrJoin(floor, floor.worker('w2')!, ask('**Set repo secret E2E_DEMO_ADMIN_PASSWORD.**'));
  assert.equal(again.joined, true);
  assert.equal(again.escalation.id, first.escalation.id);
  const esc = roster.data(floor.id).escalations;
  assert.equal(esc.length, 1);
  assert.deepEqual(esc[0].also?.map((a) => a.by), ['Hedy']);
  assert.match(esc[0].details, /\+1 from Hedy: \*\*Set repo secret/);
  // Hedy is waiting on it too, by the office's own rule.
  assert.equal(roster.jeff.ruleWaiting(floor, floor.worker('w2')!), true);
  // Something else is its own escalation.
  assert.equal(roster.escalations.raiseOrJoin(floor, floor.worker('w2')!, ask('Merge PR #46 (e2e spec fix)')).joined, false);
  assert.equal(roster.escalations.resolve(floor, first.escalation.id, 'reply', 'Set it now.', 'pm'), undefined);
  assert.deepEqual(prompted.sort(), ['w1', 'w2']);
});
