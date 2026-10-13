// The Questions page (server/questions/, shared/questions.ts): open questions an analyst wrote into the BRDs
// (`openQuestions`, the toolkit's vocabulary), collected from a fixture project's main checkout and two agent
// worktrees (fictional content in the shape of a real project's BRDs), answered, sent back through the agent,
// recorded, exported for the client and imported again. Real git; the toolkit script faked (in process, and
// once as a bash script); no office, no Claude, no GitHub.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { WorkerInfo } from '../src/shared/protocol.js';
import { answersMessage, cardStatus, needsWords, parsePastedAnswers, questionCounts, sourceWords, type Question, type QuestionsNeed, type Recipient } from '../src/shared/questions.js';
import { collectNeeds } from '../src/shared/needsyou.js';
import { isRedNeed } from '../src/shared/notify-teams.js';
import { Collector, FALLBACK_NOTE } from '../src/server/questions/collect.js';
import { normalise } from '../src/server/questions/normalise.js';
import { bashRunner, type ScriptOutcome, type ScriptRunner } from '../src/server/questions/script.js';
import { QuestionsService, type QFloor, type QuestionsDeps } from '../src/server/questions/service.js';
import { changedFiles, foldersOf, sendOpts } from '../src/server/questions/index.js';
import { csvAnswers, exportRows, toCsv, toHtml } from '../src/server/questions/export.js';
import { pushItemsOf } from '../src/server/webpush/notifier.js';
import type { AuditInput } from '../src/shared/audit.js';

const H = 3_600_000;
const NOW = Date.parse('2026-10-13T12:00:00Z');
const KB = 'analysis/visitor-desk/knowledge-base/brd';

const q = (id: string, kind: string, status: string, extra: Record<string, unknown> = {}) => ({ id, question: `Fictional question ${id}?`, kind, status, evidence: `Section 9 says nothing about ${id}.`, proposedPosition: null, blocks: `FR-${id}`, owner: 'Pilot owner', sourceRef: 'analysis/visitor-desk/knowledge-base/share/KB_DECISIONS.md', ...extra });
const brd = (id: string, title: string, qs: unknown[]) => JSON.stringify({ id, title, modules: [], openQuestions: qs }, null, 1);

const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, stdio: 'pipe', windowsHide: true }).toString();

/** main has F001 (OQ-01, OQ-02) and F002 (G1), committed; Tim's worktree changes F001 (OQ-01 answered, OQ-03 new); Elsa's adds F003. */
function fixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'questions-'));
  const dir = path.join(root, 'visitor-desk');
  mkdirSync(path.join(dir, KB), { recursive: true });
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.email', 'test@example.com');
  git(dir, 'config', 'user.name', 'Test');
  writeFileSync(path.join(dir, '.gitignore'), '.agent-office/\n');
  writeFileSync(path.join(dir, KB, 'F001-registry.brd.json'), brd('F001', 'IDN Registry', [q('OQ-01', 'user-only', 'RAISED'), q('OQ-02', 'choice', 'RAISED', { proposedPosition: 'Make it a site setting.' })]));
  writeFileSync(path.join(dir, KB, 'F002-invites.brd.json'), brd('F002', 'VIS Invitations', [q('G1', 'user-only', 'RAISED', { blocks: 'none' })]));
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'BRDs');
  const tim = path.join(dir, '.agent-office', 'worktrees', 'tim-1');
  const elsa = path.join(dir, '.agent-office', 'worktrees', 'elsa-2');
  git(dir, 'worktree', 'add', '-q', '-b', 'office/tim-1', tim);
  git(dir, 'worktree', 'add', '-q', '-b', 'office/elsa-2', elsa);
  writeFileSync(path.join(tim, KB, 'F001-registry.brd.json'), brd('F001', 'IDN Registry', [q('OQ-01', 'user-only', 'ANSWERED', { answer: 'Fifty staff.' }), q('OQ-02', 'choice', 'RAISED', { proposedPosition: 'Make it a site setting.' }), q('OQ-03', 'user-only', 'UNRAISED')]));
  writeFileSync(path.join(elsa, KB, 'F003-checkin.brd.json'), brd('F003', 'CHK Check-in', [q('C1', 'conflict', 'ASSUMED drafting position (a), hardcode')]));
  const workers = [
    { id: 'w-tim', name: 'Tim', kind: 'agent', status: 'idle', worktree: { path: path.join('.agent-office', 'worktrees', 'tim-1'), branch: 'office/tim-1', base: '' } },
    { id: 'w-elsa', name: 'Elsa', kind: 'agent', status: 'working', worktree: { path: path.join('.agent-office', 'worktrees', 'elsa-2'), branch: 'office/elsa-2', base: '' } },
  ] as unknown as WorkerInfo[];
  return { root, dir, tim, elsa, workers };
}

/** A stand-in for bin/open-questions.sh --json: the toolkit's rules over each BRD, with its own reason so the tests can tell. */
function fakeScript(calls: string[] = []): ScriptRunner {
  return async (_script, dir) => {
    calls.push(dir);
    const kb = path.join(dir, KB);
    const files = existsSync(kb) ? readdirSync(kb).filter((f) => f.endsWith('.brd.json')) : [];
    const questions = files.flatMap((f) => (JSON.parse(readFileSync(path.join(kb, f), 'utf8')).openQuestions as Record<string, unknown>[]).map((x) => ({ state: normalise(x).state, id: String(x.id), origin: f, question: String(x.question), reason: 'from the script', rawStatus: String(x.status) })));
    return { ok: true, json: { examined: { brdFiles: files.length, smeQuestionFiles: 0, nothingExamined: !files.length }, questions } } satisfies ScriptOutcome;
  };
}

function harness(o: { run?: ScriptRunner; script?: string | undefined; fx?: ReturnType<typeof fixture> } = {}) {
  const fx = o.fx ?? fixture();
  const state = { now: NOW };
  const floor: QFloor = { id: 'visitor', name: 'visitor-desk', dir: fx.dir };
  const sent: { workerId: string; text: string; by: string; when: string }[] = [];
  const audits: AuditInput[] = [];
  const collector = new Collector({ floor: floor.id, floorDir: fx.dir, script: async () => ('script' in o ? o.script : '/toolkit/bin/open-questions.sh'), run: o.run ?? fakeScript(), changed: changedFiles, now: () => state.now });
  const ada: Recipient = { name: 'Ada', workerId: 'w-ada', working: false };
  const deps: QuestionsDeps = {
    dataDir: mkdtempSync(path.join(os.tmpdir(), 'questions-data-')),
    now: () => state.now,
    floors: () => [floor],
    folders: () => foldersOf(floor, fx.workers),
    collector: () => collector,
    recipientOf: (_f, x) => (x.source.agent && x.source.workerId ? { name: x.source.agent, workerId: x.source.workerId, working: x.source.agent === 'Elsa' } : ada),
    send: (_f, workerId, text, by, when) => void sent.push({ workerId, text, by, when }),
    decisionHours: () => 24,
    record: (e) => void audits.push(e),
  };
  return { fx, state, floor, sent, audits, deps, svc: new QuestionsService(deps) };
}

const byKey = (qs: readonly Question[]) => new Map(qs.map((x) => [x.key, x]));

// ---- Collection ------------------------------------------------------------------------------------------

test('collection across main and two worktrees: the worktree copy wins over main, each labelled with whose copy and whether it is committed', async () => {
  const h = harness();
  await h.svc.collect(h.floor);
  const v = await h.svc.view(h.floor, true);
  assert.equal(v.set?.via, 'script');
  const m = byKey(v.set!.questions);
  assert.deepEqual([...m.keys()].sort(), ['F001-registry.brd.json#OQ-01', 'F001-registry.brd.json#OQ-02', 'F001-registry.brd.json#OQ-03', 'F002-invites.brd.json#G1', 'F003-checkin.brd.json#C1']);
  // Tim's working copy wins for F001: OQ-01 answered there, OQ-03 only there.
  const oq1 = m.get('F001-registry.brd.json#OQ-01')!;
  assert.equal(oq1.state, 'ANSWERED');
  assert.equal(oq1.reason, 'from the script');
  assert.deepEqual(oq1.source, { where: 'worktree', agent: 'Tim', workerId: 'w-tim', worktree: 'tim-1', committed: false });
  assert.equal(sourceWords(oq1.source), "Tim's working copy, not committed");
  assert.equal(m.get('F001-registry.brd.json#OQ-03')!.state, 'UNRAISED');
  // F002 only on main, committed.
  assert.equal(sourceWords(m.get('F002-invites.brd.json#G1')!.source), 'main');
  assert.equal(m.get('F003-checkin.brd.json#C1')!.source.agent, 'Elsa');
  // Grouped by BRD with its title; the details the script doesn't print come from the BRD.
  assert.deepEqual(v.set!.brds.map((b) => `${b.id} ${b.title}`), ['F001 IDN Registry', 'F002 VIS Invitations', 'F003 CHK Check-in']);
  assert.equal(m.get('F001-registry.brd.json#OQ-02')!.proposedPosition, 'Make it a site setting.');
  assert.equal(oq1.evidence, 'Section 9 says nothing about OQ-01.');
});

test('the toolkit script missing: the BRDs are read with its rules and the set says "read from the BRD files (toolkit script unavailable)"', async () => {
  const h = harness({ script: undefined });
  await h.svc.collect(h.floor);
  const v = await h.svc.view(h.floor, true);
  assert.equal(v.set?.via, 'brd');
  assert.equal(v.set?.note, FALLBACK_NOTE);
  assert.equal(v.set?.questions.length, 5);
  assert.equal(byKey(v.set!.questions).get('F001-registry.brd.json#OQ-02')!.state, 'RAISED');
});

test('the toolkit script failing is never "no questions": they are read from the BRDs and the failure is said', async () => {
  const h = harness({ run: async () => ({ ok: false, why: 'open-questions.sh failed (exit 2): Error: jq is required.' }) });
  await h.svc.collect(h.floor);
  const v = await h.svc.view(h.floor, true);
  assert.equal(v.set?.via, 'brd');
  assert.equal(v.set?.questions.length, 5);
  assert.ok(v.set?.problems?.some((p) => /jq is required/.test(p)));
  assert.ok(v.need && v.need.waiting > 0, 'still waiting on you');
});

test('the bash runner: a fake open-questions.sh run with bash; exit 1 (questions block) is an answer, output that is not JSON a failure', { skip: !hasBash() && 'no bash here' }, async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'questions-sh-'));
  const ok = path.join(dir, 'ok.sh');
  writeFileSync(ok, '#!/usr/bin/env bash\necho \'{"examined":{"brdFiles":1,"smeQuestionFiles":0,"nothingExamined":false},"questions":[{"state":"UNRAISED","id":"OQ-9","origin":"F009-x.brd.json","question":"Why?","rawStatus":"open"}]}\'\nexit 1\n');
  const bad = path.join(dir, 'bad.sh');
  writeFileSync(bad, '#!/usr/bin/env bash\necho "Error: jq is required." >&2\nexit 2\n');
  const run = bashRunner({ bash: bashExe(), env: async () => ({ ...process.env }) as Record<string, string> });
  const a = await run(ok, dir, dir);
  assert.ok(a.ok && a.json.questions[0].id === 'OQ-9');
  const b = await run(bad, dir, dir);
  assert.ok(!b.ok && /exit 2/.test(b.why) && /jq is required/.test(b.why));
});

test('no BRDs anywhere: nothing examined, and the page says "No BRDs yet"', async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'questions-none-'));
  const c = new Collector({ floor: 'x', floorDir: root, script: async () => '/s', run: fakeScript(), changed: changedFiles, now: () => NOW });
  const { set } = await c.collect([{ dir: root, where: 'main' }]);
  assert.equal(set.via, 'none');
  const { emptyWords } = await import('../src/client/ui/questions/logic.js');
  assert.match(emptyWords({ floor: 'x', set, answers: {}, routes: {}, recipients: [], collecting: false, admin: true })!, /^No BRDs yet/);
});

test('collection is cached: the script runs again only for a folder whose files changed', async () => {
  const calls: string[] = [];
  const h = harness({ run: fakeScript(calls) });
  await h.svc.collect(h.floor);
  assert.equal(calls.length, 3);
  await h.svc.collect(h.floor);
  assert.equal(calls.length, 3, 'nothing changed: no script run');
  writeFileSync(path.join(h.fx.elsa, KB, 'F003-checkin.brd.json'), brd('F003', 'CHK Check-in', [q('C1', 'conflict', 'RAISED')]));
  await h.svc.collect(h.floor);
  assert.deepEqual(calls.slice(3), [h.fx.elsa]);
});

// ---- Counting, Needs you and notifications ----------------------------------------------------------------

test('Needs you: one item per project, "N questions for the client · N BRDs · N block work", counted as waiting; answered ones drop out', async () => {
  const h = harness();
  await h.svc.collect(h.floor);
  const need = (await h.svc.need(h.floor))!;
  // OQ-02, OQ-03 (F001), G1 (F002, blocks nothing), C1 (F003: ASSUMED without consent is UNRAISED) wait; OQ-01 is ANSWERED.
  assert.deepEqual({ waiting: need.waiting, brds: need.brds, blocking: need.blocking }, { waiting: 4, brds: 3, blocking: 3 });
  assert.equal(needsWords(need), '4 questions for the client · 3 BRDs · 3 block work');
  const items = collectNeeds({ floor: 'visitor', workers: [], pulls: [], floors: [], questions: need, now: NOW }).filter((n) => n.kind === 'questions');
  assert.equal(items.length, 1);
  assert.equal(items[0].action, 'Answer');
  assert.deepEqual(items[0].target, { to: 'questions' });
  assert.ok(isRedNeed(items[0]));
  const { waitingCount } = await import('../src/client/ui/needsyou/feed.js');
  assert.equal(waitingCount(items), 1);
  await h.svc.answer(h.floor, 'F002-invites.brd.json#G1', 'answer', { text: 'Ten', by: 'Keith' });
  assert.equal((await h.svc.need(h.floor))!.waiting, 3);
});

test('one notification for a batch of new questions, not one per question; a later new question is a new batch', async () => {
  const h = harness();
  await h.svc.collect(h.floor);
  const ids = async () => {
    const need = (await h.svc.need(h.floor)) as QuestionsNeed;
    return pushItemsOf({ id: 'visitor', name: 'visitor-desk' }, collectNeeds({ floor: 'visitor', workers: [], pulls: [], floors: [], questions: need, now: NOW }), () => false).map((p) => p.id);
  };
  const first = await ids();
  assert.equal(first.length, 1, 'four questions, one push');
  assert.equal(h.audits.filter((a) => a.action === 'questions.new').length, 1);
  h.state.now += H;
  await h.svc.collect(h.floor);
  assert.deepEqual(await ids(), first, 'the same batch: nothing new to push');
  writeFileSync(path.join(h.fx.elsa, KB, 'F003-checkin.brd.json'), brd('F003', 'CHK Check-in', [q('C1', 'conflict', 'RAISED'), q('C2', 'user-only', 'RAISED')]));
  await h.svc.collect(h.floor);
  const next = await ids();
  assert.equal(next.length, 1);
  assert.notDeepEqual(next, first, 'a new batch, so one new notification');
});

// ---- Answers ----------------------------------------------------------------------------------------------

test('accept the proposal records consentBy and consentAt; Not relevant needs a reason; Answer needs words', async () => {
  const h = harness();
  await h.svc.collect(h.floor);
  assert.equal(await h.svc.answer(h.floor, 'F003-checkin.brd.json#C1', 'moot', { text: '  ', by: 'Keith' }), 'Say why it is not relevant');
  assert.equal(await h.svc.answer(h.floor, 'F001-registry.brd.json#OQ-03', 'answer', { text: '', by: 'Keith' }), 'Write the answer first');
  assert.equal(await h.svc.answer(h.floor, 'F001-registry.brd.json#OQ-03', 'accept', { by: 'Keith' }), 'There is no proposed position to accept');
  assert.equal(await h.svc.answer(h.floor, 'F001-registry.brd.json#OQ-01', 'answer', { text: 'x', by: 'Keith' }), "It's already ANSWERED in the BRD");
  assert.equal(await h.svc.answer(h.floor, 'F001-registry.brd.json#OQ-02', 'accept', { by: 'Keith' }), undefined);
  const { text } = await h.svc.draft(h.floor, 'Tim', 'Keith');
  assert.match(text, /OQ-02 in F001-registry\.brd\.json/);
  assert.match(text, /status: ASSUMED/);
  assert.match(text, /decision: "Make it a site setting\."/);
  assert.match(text, /consentBy: "Keith"/);
  assert.match(text, /consentAt: "2026-10-13T12:00Z"/);
});

test('Send builds ONE message with every answer for that analyst, delivered after their turn by default, audited; the answers go pending → sent', async () => {
  const h = harness();
  await h.svc.collect(h.floor);
  await h.svc.answer(h.floor, 'F001-registry.brd.json#OQ-02', 'accept', { by: 'Keith' });
  await h.svc.answer(h.floor, 'F001-registry.brd.json#OQ-03', 'answer', { text: 'The HR export, weekly.', by: 'Keith' });
  await h.svc.answer(h.floor, 'F002-invites.brd.json#G1', 'moot', { text: 'Descoped by D04', by: 'Keith' });
  await h.svc.answer(h.floor, 'F003-checkin.brd.json#C1', 'ask-client', { by: 'Keith' });
  const v = await h.svc.view(h.floor, true);
  // F001 is in Tim's working copy, F002 on main (whoever covers Analysis: Ada), F003 in Elsa's.
  assert.equal(v.routes['F001-registry.brd.json#OQ-02'], 'Tim');
  assert.equal(v.routes['F002-invites.brd.json#G1'], 'Ada');
  assert.equal(await h.svc.send(h.floor, 'Tim', { by: 'Keith', when: 'after' }), undefined);
  assert.equal(h.sent.length, 1, 'one message');
  const m = h.sent[0];
  assert.equal(m.workerId, 'w-tim');
  assert.equal(m.when, 'after');
  assert.match(m.text, /answered 2 open questions/);
  assert.match(m.text, /1\. OQ-02 .*\n {3}status: ASSUMED/);
  assert.match(m.text, /2\. OQ-03 .*\n {3}status: ANSWERED\n {3}answer: "The HR export, weekly\."/);
  assert.match(m.text, /re-run `bin\/open-questions\.sh \.`/);
  assert.doesNotMatch(m.text, /G1|C1/, 'only Tim\'s; Ask the client is never sent');
  const after = await h.svc.view(h.floor, true);
  assert.equal(after.answers['F001-registry.brd.json#OQ-02'].status, 'sent');
  assert.equal(after.answers['F001-registry.brd.json#OQ-02'].sentTo, 'Tim');
  assert.equal(after.answers['F002-invites.brd.json#G1'].status, 'pending');
  const audit = h.audits.find((a) => a.action === 'questions.sent')!;
  assert.match(audit.summary, /Sent 2 answers to Tim .*after their turn/);
  // The delivery: held for the end of the turn under way unless now, as the person's, back to the task after.
  assert.deepEqual(sendOpts('Keith', 'after'), { origin: 'person', by: 'Keith', wake: true, hold: true, resume: true, between: true });
  assert.equal(sendOpts('Keith', 'now').between, undefined);
  assert.equal(await h.svc.send(h.floor, 'Tim', { by: 'Keith', when: 'after' }), 'No answers are ready to send to them');
});

test('an answer is recorded only when a later collection shows ANSWERED, ASSUMED or MOOT for that id', async () => {
  const h = harness();
  await h.svc.collect(h.floor);
  await h.svc.answer(h.floor, 'F001-registry.brd.json#OQ-03', 'answer', { text: 'Weekly.', by: 'Keith' });
  await h.svc.send(h.floor, 'Tim', { by: 'Keith', when: 'now' });
  h.state.now += H;
  await h.svc.collect(h.floor);
  assert.equal((await h.svc.view(h.floor, true)).answers['F001-registry.brd.json#OQ-03'].status, 'sent', 'still UNRAISED in the BRD');
  // Tim records it the toolkit's way.
  writeFileSync(path.join(h.fx.tim, KB, 'F001-registry.brd.json'), brd('F001', 'IDN Registry', [q('OQ-01', 'user-only', 'ANSWERED', { answer: 'Fifty staff.' }), q('OQ-02', 'choice', 'RAISED', { proposedPosition: 'Make it a site setting.' }), q('OQ-03', 'user-only', 'ANSWERED', { answer: 'Weekly.' })]));
  await h.svc.collect(h.floor);
  const v = await h.svc.view(h.floor, true);
  const a = v.answers['F001-registry.brd.json#OQ-03'];
  assert.equal(a.status, 'recorded');
  assert.equal(a.recordedState, 'ANSWERED');
  assert.equal(cardStatus(byKey(v.set!.questions).get(a.key)!, a).text, 'Recorded (ANSWERED by Keith, 13 Oct)');
  assert.ok(h.audits.some((x) => x.action === 'questions.recorded' && /OQ-03 \(ANSWERED\)/.test(x.summary)));
});

test('ASSUMED without consent is UNRAISED by the toolkit, still waiting on you, and shown as a warning', async () => {
  const h = harness();
  await h.svc.collect(h.floor);
  const v = await h.svc.view(h.floor, true);
  const c1 = byKey(v.set!.questions).get('F003-checkin.brd.json#C1')!;
  assert.equal(c1.state, 'UNRAISED');
  assert.equal(c1.assumedNoConsent, true);
  assert.deepEqual(cardStatus(c1, undefined), { tone: 'warn', text: 'Assumed by agent without your consent' });
  assert.equal(normalise({ status: 'ASSUMED x', consentBy: 'Keith', consentAt: '2026-10-13' }).state, 'ASSUMED');
  assert.deepEqual(cardStatus(byKey(v.set!.questions).get('F001-registry.brd.json#OQ-02')!, undefined), { tone: 'wait', text: 'Waiting on you' });
});

// ---- Export and import ------------------------------------------------------------------------------------

test('export for the client and import back: the CSV round-trips, answers attach to their ids as the client\'s, ready to send', async () => {
  const h = harness();
  await h.svc.collect(h.floor);
  await h.svc.answer(h.floor, 'F003-checkin.brd.json#C1', 'ask-client', { by: 'Keith' });
  const asked = await h.svc.exportRows(h.floor, 'asked');
  assert.deepEqual(asked.map((r) => r.id), ['C1']);
  const all = await h.svc.exportRows(h.floor, 'user-only');
  assert.deepEqual(all.map((r) => r.id).sort(), ['C1', 'G1', 'OQ-03']);
  const row = all.find((r) => r.id === 'OQ-03')!;
  assert.equal(row.brd, 'F001 IDN Registry');
  assert.equal(row.blocks, 'FR-OQ-03');
  assert.equal(row.answer, '');
  assert.match(row.context, /Section 9 says nothing about OQ-03\. Who can answer: Pilot owner/);
  const csv = toCsv(all);
  assert.match(csv, /^\uFEFFID,BRD,Question,Context,What it blocks,Answer\r\n/);
  // The client fills in the Answer column (one with a comma, quoted, as Excel saves it).
  const filled = csv.replace(/(OQ-03,.*),\r\n/, '$1,"Weekly, from HR"\r\n').replace(/(G1,.*),\r\n/, '$1,Ten\r\n');
  const rows = csvAnswers(filled);
  assert.ok(Array.isArray(rows));
  assert.deepEqual(rows.map((r) => [r.id, r.answer]).sort(), [['G1', 'Ten'], ['OQ-03', 'Weekly, from HR']]);
  const r = await h.svc.importAnswers(h.floor, [...rows, { id: 'NOPE-1', answer: 'x' }], { by: 'Keith', how: 'file' });
  assert.deepEqual({ ...r, matched: r.matched.sort() }, { matched: ['G1', 'OQ-03'], unknown: ['NOPE-1'], skipped: [] });
  const v = await h.svc.view(h.floor, true);
  const a = v.answers['F001-registry.brd.json#OQ-03'];
  assert.equal(a.text, 'Weekly, from HR');
  assert.equal(a.fromClient?.by, 'Keith');
  assert.equal(cardStatus(byKey(v.set!.questions).get(a.key)!, a).text, 'Answered (from the client file, imported by Keith): ready to send');
  assert.match(answersMessage([a], byKey(v.set!.questions), 'Keith'), /the client's answer, imported by Keith/);
  const html = toHtml(all, 'visitor-desk', NOW);
  assert.match(html, /<td class="id">OQ-03<\/td>/);
  assert.match(html, /<th>Answer<\/th>/);
});

test('pasted import: "ID: answer" lines, with -, = or – too, a line without an id continuing the one before', () => {
  assert.deepEqual(parsePastedAnswers('OQ-05: Yes, all ten.\n- G3B – Until the end of the visit window\n  and not longer.\n\nnot an id line\nSME-1 = Priya (privacy)\nfoo: bar'), [
    { id: 'OQ-05', answer: 'Yes, all ten.' },
    { id: 'G3B', answer: 'Until the end of the visit window and not longer. not an id line' },
    { id: 'SME-1', answer: 'Priya (privacy) foo: bar' },
  ]);
});

// ---- Stuck detection --------------------------------------------------------------------------------------

test('stuck: a blocking user-only question waiting more than 24 h is one stuck decision; answered, it resolves by itself', async () => {
  const h = harness();
  writeFileSync(path.join(h.fx.tim, KB, 'F001-registry.brd.json'), brd('F001', 'IDN Registry', [q('OQ-01', 'user-only', 'ANSWERED', { answer: 'Fifty staff.' }), q('OQ-02', 'choice', 'RAISED'), q('OQ-03', 'user-only', 'RAISED', { raisedAtGate: 'Stage 2 gate, 2026-10-10' }), q('OQ-04', 'user-only', 'RAISED')]));
  await h.svc.collect(h.floor);
  const { StuckService } = await import('../src/server/stuck/service.js');
  const { registerStuckSource } = await import('../src/server/stuck/sources.js');
  const { STUCK_DEFAULTS, stuckTitle } = await import('../src/shared/stuck.js');
  const off = registerStuckSource((f, now) => h.svc.stuckDrafts({ id: f.id, name: f.name, dir: f.dir }, now));
  try {
    const stuck = new StuckService({ dataDir: mkdtempSync(path.join(os.tmpdir(), 'questions-stuck-')), floors: () => [], now: () => h.state.now, settings: () => STUCK_DEFAULTS, readRepo: async () => undefined, runs: async () => [], spendSince: () => undefined, lead: () => undefined, tell: () => undefined, openEscalations: () => [], record: () => undefined });
    const sf = { id: 'visitor', name: 'visitor-desk', dir: h.fx.dir, pulls: () => [], working: () => false };
    const raised = await stuck.look(sf);
    // OQ-03 since its gate date (3 days); OQ-04 is new to the office just now (its file time is now): not yet; G1 blocks nothing; OQ-02 is a choice.
    assert.deepEqual(raised.map((e) => [e.action, e.record.draft.id]), [['raised', 'decision-F001-OQ-03']]);
    const v = await stuck.view(sf, true);
    assert.equal(v.items.length, 1);
    assert.equal(v.items[0].kind, 'decision');
    assert.equal(stuckTitle(v.items[0], h.state.now), 'Client question waiting on you: OQ-03 Fictional question OQ-03? Blocks FR-OQ-03.');
    assert.deepEqual(await stuck.look(sf), [], 'raised once');
    await h.svc.answer(h.floor, 'F001-registry.brd.json#OQ-03', 'answer', { text: 'Ten', by: 'Keith' });
    assert.deepEqual((await stuck.look(sf)).map((e) => e.action), ['resolved']);
  } finally {
    off();
  }
});

// ---- The rules of the road --------------------------------------------------------------------------------

test('never writes into a worktree, and never calls GitHub (a fake gh first on PATH records nothing)', async () => {
  const { runnable } = await import('./support/winshim.js');
  const bin = mkdtempSync(path.join(os.tmpdir(), 'questions-gh-'));
  const log = path.join(bin, 'gh-calls.log');
  writeFileSync(path.join(bin, 'gh'), `#!/usr/bin/env node\nrequire('fs').appendFileSync(${JSON.stringify(log)}, process.argv.slice(2).join(' ') + '\\n');\n`);
  runnable(path.join(bin, 'gh'));
  const PATH = Object.keys(process.env).find((k) => k.toUpperCase() === 'PATH') ?? 'PATH';
  const before = process.env[PATH];
  process.env[PATH] = `${bin}${path.delimiter}${before}`;
  try {
    const h = harness();
    const snap = () => [h.fx.tim, h.fx.elsa].flatMap((d) => walk(d)).join('\n');
    const was = snap();
    await h.svc.collect(h.floor);
    await h.svc.answer(h.floor, 'F001-registry.brd.json#OQ-02', 'accept', { by: 'Keith' });
    await h.svc.send(h.floor, 'Tim', { by: 'Keith', when: 'after' });
    await h.svc.exportRows(h.floor, 'user-only');
    await h.svc.collect(h.floor);
    assert.equal(snap(), was, 'every worktree file as it was');
    assert.equal(existsSync(log) ? readFileSync(log, 'utf8') : '', '', 'no gh call');
  } finally {
    process.env[PATH] = before;
  }
});

test('no synchronous fs or child processes on the request path, no GitHub in the code; git and bash go through the off-loop runner', () => {
  const dir = path.join(process.cwd(), 'src', 'server', 'questions');
  const src = readdirSync(dir).map((f) => readFileSync(path.join(dir, f), 'utf8')).join('\n') + readFileSync(path.join(process.cwd(), 'src', 'server', 'http', 'routes', 'questions.ts'), 'utf8');
  assert.doesNotMatch(src, /\b(readFileSync|writeFileSync|existsSync|statSync|readdirSync|mkdirSync|execSync|execFileSync|spawnSync|floorToolkitEnv|withFloorToolkitEnv)\b/);
  assert.doesNotMatch(src, /node:child_process|from '\.\.\/github\.js'|api\.github\.com|octokit|'gh'/i);
  assert.match(src, /from '\.\.\/offloop\/exec\.js'/);
});

test('the Playbooks tell the analyst to raise questions in the BRDs for the Questions page, and to record the answers the office sends', async () => {
  const { playbook } = await import('../src/server/roster/playbooks.js');
  const { coverLines } = await import('../src/server/roster/playbook-cover.js');
  const { defaultCoverage } = await import('../src/shared/roster/coverage.js');
  const names = { pm: 'Pat', 'lead-designer': 'Dee', 'lead-developer': 'Dev', 'lead-tester': 'Tess', 'chief-analyst': 'Tim', 'solo-lead': 'Sol' };
  const text = playbook('chief-analyst', { project: 'visitor-desk', name: 'Tim', names, level: 2 } as unknown as Parameters<typeof playbook>[1]);
  assert.match(text, /Raise questions for the PM as a batch in the BRD `openQuestions` with the toolkit's vocabulary \(status RAISED\)\. The office shows them on the Questions page\. Don't announce them only in chat\./);
  assert.match(text, /re-run bin\/open-questions\.sh/);
  assert.ok(coverLines(defaultCoverage('startup'), 'lead-developer').concat(coverLines(defaultCoverage('solo'), 'solo-lead')).some((l) => /Questions page/.test(l)));
});

test('the page: filters (needs the client, you can decide, blocks work, answered), search, groups by BRD title, and answers ready per analyst', async () => {
  const { groups, readyByRecipient, readyWords } = await import('../src/client/ui/questions/logic.js');
  const h = harness();
  await h.svc.collect(h.floor);
  await h.svc.answer(h.floor, 'F001-registry.brd.json#OQ-02', 'accept', { by: 'Keith' });
  await h.svc.answer(h.floor, 'F002-invites.brd.json#G1', 'answer', { text: 'Ten', by: 'Keith' });
  const v = await h.svc.view(h.floor, true);
  const ids = (f: Parameters<typeof groups>[1], s = '') => groups(v, f, s).flatMap((g) => g.questions.map((x) => x.id));
  assert.deepEqual(groups(v, 'all', '').map((g) => g.title), ['F001 · IDN Registry', 'F002 · VIS Invitations', 'F003 · CHK Check-in']);
  assert.deepEqual(ids('client'), ['OQ-03', 'OQ-01', 'G1']);
  assert.deepEqual(ids('decide'), ['OQ-02', 'C1']);
  assert.deepEqual(ids('blocks').includes('G1'), false);
  assert.deepEqual(ids('answered'), ['OQ-02', 'OQ-01', 'G1']);
  assert.deepEqual(ids('all', 'fr-c1'), ['C1']);
  const ready = readyByRecipient(v);
  assert.deepEqual([...ready].map(([to, list]) => `${readyWords(list.length)} · Send to ${to}`), ['1 answer ready · Send to Tim', '1 answer ready · Send to Ada']);
  const c = questionCounts(v.set!.questions, v.answers);
  const { headerWords } = await import('../src/shared/questions.js');
  assert.equal(headerWords(c), 'Questions · 3 of 5 answered · 2 block work');
});

// ---- helpers ----------------------------------------------------------------------------------------------

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else out.push(`${p}:${statSync(p).mtimeMs}:${createHash('sha1').update(readFileSync(p)).digest('hex')}`);
  }
  return out.sort();
}

function bashExe(): string {
  const gitBash = 'C:\\Program Files\\Git\\bin\\bash.exe';
  return process.platform === 'win32' && existsSync(gitBash) ? gitBash : 'bash';
}

function hasBash(): boolean {
  try {
    execFileSync(bashExe(), ['-c', 'exit 0'], { stdio: 'ignore', windowsHide: true });
    return true;
  } catch {
    return false;
  }
}
