// Recorded as given, questions (Slice 1B-2): at Send the office keeps what each revision asked the analyst
// to record (the same values the message carried); on each collection it compares the BRD's fields with
// that, and keeps where the record is. Only recorded as given at the current revision, merged into main,
// marks an answer recorded. Real git (a project with two worktrees and a bare origin), the toolkit script
// faked, the 1B-1 dispatcher real; no office, no Claude, no GitHub.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { WorkerInfo } from '../src/shared/protocol.js';
import { answersMessage, cardStatus, expectedOf, type Question } from '../src/shared/questions.js';
import { Collector } from '../src/server/questions/collect.js';
import { normalise } from '../src/server/questions/normalise.js';
import type { ScriptOutcome, ScriptRunner } from '../src/server/questions/script.js';
import { QuestionsService, type QFloor } from '../src/server/questions/service.js';
import { changedFiles, foldersOf, questionLocator } from '../src/server/questions/index.js';
import { Dispatcher } from '../src/server/dispatch/service.js';
import { FollowThrough } from '../src/server/followthrough/service.js';
import { judgeQuestion } from '../src/server/followthrough/judge.js';
import { git } from './followthrough-helpers.js';

const KB = 'analysis/knowledge-base/brd';
const NOW = Date.parse('2026-10-15T09:00:00Z');
const q = (id: string, status: string, extra: Record<string, unknown> = {}) => ({ id, question: `Fictional question ${id}?`, kind: 'user-only', status, blocks: `FR-${id}`, ...extra });
const brd = (qs: unknown[]) => JSON.stringify({ id: 'F001', title: 'Registry', openQuestions: qs }, null, 1);

function fakeScript(): ScriptRunner {
  return async (_s, dir) => {
    const kb = path.join(dir, KB);
    const files = existsSync(kb) ? readdirSync(kb).filter((f) => f.endsWith('.brd.json')) : [];
    const questions = files.flatMap((f) => (JSON.parse(readFileSync(path.join(kb, f), 'utf8')).openQuestions as Record<string, unknown>[]).map((x) => ({ state: normalise(x).state, id: String(x.id), origin: f, question: String(x.question), reason: 'script', rawStatus: String(x.status) })));
    return { ok: true, json: { examined: { brdFiles: files.length, smeQuestionFiles: 0, nothingExamined: !files.length }, questions } } satisfies ScriptOutcome;
  };
}

/** A project whose main has OQ-01 raised, pushed to a bare origin, and Tim's worktree. */
async function harness() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'ftq-'));
  const dir = path.join(root, 'proj');
  const origin = path.join(root, 'origin.git');
  mkdirSync(path.join(dir, KB), { recursive: true });
  git(root, 'init', '-q', '--bare', '-b', 'main', origin);
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.email', 't@example.com');
  git(dir, 'config', 'user.name', 'T');
  git(dir, 'config', 'core.autocrlf', 'false');
  writeFileSync(path.join(dir, '.gitignore'), '.agent-office/\n');
  writeFileSync(path.join(dir, KB, 'F001.brd.json'), brd([q('OQ-01', 'RAISED')]));
  git(dir, 'add', '-A');
  git(dir, 'commit', '-qm', 'BRD');
  git(dir, 'remote', 'add', 'origin', origin);
  git(dir, 'push', '-q', '-u', 'origin', 'main');
  const tim = path.join(dir, '.agent-office', 'worktrees', 'tim-1');
  git(dir, 'worktree', 'add', '-q', '-b', 'office/tim-1', tim);
  const workers = [{ id: 'w-tim', name: 'Tim', kind: 'agent', status: 'idle', worktree: { path: path.join('.agent-office', 'worktrees', 'tim-1'), branch: 'office/tim-1', base: '' } }] as unknown as WorkerInfo[];
  const floor: QFloor = { id: 'ftq', name: 'proj', dir };
  const data = mkdtempSync(path.join(os.tmpdir(), 'ftq-data-'));
  const dispatcher = new Dispatcher({ dataDir: data, now: () => NOW });
  const collector = new Collector({ floor: floor.id, floorDir: dir, script: async () => '/tk/bin/open-questions.sh', run: fakeScript(), changed: changedFiles, now: () => NOW });
  const sent: string[] = [];
  const svc = new QuestionsService({
    dataDir: data,
    now: () => NOW,
    floors: () => [floor],
    folders: () => foldersOf(floor, workers),
    collector: () => collector,
    recipientOf: () => ({ name: 'Tim', workerId: 'w-tim', working: false }),
    send: (_f, _w, text) => (sent.push(text), { dispatchId: 'dsp_test' }),
    answer: (f, spec) => dispatcher.answer(f.id, spec),
    locator: (f) => questionLocator(f.dir),
    decisionHours: () => 24,
    record: () => {},
  });
  const ft = new FollowThrough({ dataDir: data, now: () => NOW, dispatcher, escalations: () => [], questions: () => ({ book: (id) => svc.book(id), commit: (id) => svc.commit(id) }), escTarget: () => 'n/a', qTarget: async () => 'Nobody is at work to record it', flush: async () => {}, record: () => {} });
  const KEY = 'F001.brd.json#OQ-01';
  const record = (where: string, status: string, extra: Record<string, unknown>) => writeFileSync(path.join(where, KB, 'F001.brd.json'), brd([q('OQ-01', status, extra)]));
  const answer = async () => (await svc.view(floor, true)).answers[KEY];
  await svc.collect(floor);
  return { dir, tim, floor, svc, ft, dispatcher, sent, KEY, record, answer };
}

test('at Send the office keeps what the message asked to record, from the same values the message carries', async () => {
  const h = await harness();
  assert.equal(await h.svc.answer(h.floor, h.KEY, 'answer', { text: 'Weekly, on Mondays.', by: 'Keith' }), undefined);
  await h.svc.send(h.floor, 'Tim', { by: 'Keith', when: 'after' });
  const a = await h.answer();
  assert.equal(a.status, 'sent');
  assert.equal(a.answerRev, 1);
  assert.deepEqual(a.expected, [{ rev: 1, state: 'ANSWERED', answer: 'Weekly, on Mondays.' }]);
  assert.match(h.sent[0], /answer: "Weekly, on Mondays\."/);
  // An accepted proposal: decision, consentBy and consentAt as the message writes them.
  const x = expectedOf({ kind: 'accept', by: 'Keith', at: NOW }, { proposedPosition: 'Make it a site setting.' }, 2);
  assert.deepEqual(x, { rev: 2, state: 'ASSUMED', decision: 'Make it a site setting.', consentBy: 'Keith', consentAt: '2026-10-15T09:00Z' });
  const msg = answersMessage([{ key: 'k', id: 'OQ-02', file: 'F.brd.json', kind: 'accept', by: 'Keith', at: NOW, status: 'pending' }], new Map([['k', { key: 'k', id: 'OQ-02', file: 'F.brd.json', question: 'Where is it set?', state: 'RAISED', rawStatus: 'RAISED', proposedPosition: 'Make it a site setting.', source: { where: 'main', committed: true } } as Question]]), 'Keith');
  assert.match(msg, /decision: "Make it a site setting\."[\s\S]*consentBy: "Keith"[\s\S]*consentAt: "2026-10-15T09:00Z"/);
});

test('questions-uncommitted-not-confirmed: recorded as given in a working copy is not recorded, nor followed off', async () => {
  const h = await harness();
  await h.svc.answer(h.floor, h.KEY, 'answer', { text: 'Weekly, on Mondays.', by: 'Keith' });
  await h.svc.send(h.floor, 'Tim', { by: 'Keith', when: 'after' });
  h.record(h.tim, 'ANSWERED', { answer: 'Weekly, on Mondays.' });
  await h.svc.collect(h.floor);
  const a = await h.answer();
  assert.deepEqual([a.status, a.recording?.outcome, a.recording?.location?.where], ['sent', 'recorded', 'working-copy']);
  assert.equal((await h.ft.view(h.floor.id, true)).items.length, 1);
});

test('questions-recorded-as-given: as given in a working copy, then on a branch, then merged; only merged marks it recorded', async () => {
  const h = await harness();
  await h.svc.answer(h.floor, h.KEY, 'answer', { text: 'Weekly, on Mondays.', by: 'Keith' });
  await h.svc.send(h.floor, 'Tim', { by: 'Keith', when: 'after' });
  // Never the resolved state alone: ANSWERED with no answer is not recorded.
  h.record(h.tim, 'ANSWERED', { decision: '' });
  // 1. Tim records it as given, not committed.
  h.record(h.tim, 'ANSWERED', { answer: 'weekly, on Mondays' });
  await h.svc.collect(h.floor);
  let a = await h.answer();
  assert.deepEqual([a.status, a.recording?.outcome, a.recording?.location?.where, a.recording?.location?.commitSha], ['sent', 'recorded', 'working-copy', undefined]);
  const qq = (await h.svc.view(h.floor, true)).set!.questions.find((x) => x.key === h.KEY)!;
  assert.equal(cardStatus(qq, a).text, 'Recorded as given · In a working copy, not committed (Tim)');
  // 2. Committed on Tim's branch.
  git(h.tim, '-c', 'user.email=t@e', '-c', 'user.name=T', 'commit', '-qam', 'record OQ-01');
  await h.svc.collect(h.floor);
  a = await h.answer();
  assert.deepEqual([a.status, a.recording?.location?.where, a.recording?.location?.branch], ['sent', 'committed-on-branch', 'office/tim-1']);
  assert.equal(a.recording?.location?.commitSha, git(h.tim, 'rev-parse', 'HEAD').trim());
  assert.equal(a.recording?.location?.blobId, git(h.tim, 'rev-parse', `HEAD:${KB}/F001.brd.json`).trim());
  // Still followed through, status-level.
  assert.equal((await h.ft.view(h.floor.id, true)).items[0]?.recording.outcome, 'recorded');
  // 3. Merged into main and pushed: recorded.
  git(h.dir, 'merge', '-q', '--no-ff', '-m', 'merge', 'office/tim-1');
  git(h.dir, 'push', '-q', 'origin', 'main');
  await h.svc.collect(h.floor);
  a = await h.answer();
  assert.deepEqual([a.status, a.recording?.location?.where, a.recordedState], ['recorded', 'merged-into-main', 'ANSWERED']);
  assert.equal((await h.ft.view(h.floor.id, true)).items.length, 0);
});

test('questions-recorded-differently: different words stay recorded differently, kept as written, never recorded, even merged', async () => {
  const h = await harness();
  await h.svc.answer(h.floor, h.KEY, 'answer', { text: 'Weekly, on Mondays.', by: 'Keith' });
  await h.svc.send(h.floor, 'Tim', { by: 'Keith', when: 'after' });
  h.record(h.tim, 'ANSWERED', { answer: 'Monthly, by the 5th.' });
  git(h.tim, '-c', 'user.email=t@e', '-c', 'user.name=T', 'commit', '-qam', 'record');
  git(h.dir, 'merge', '-q', '--no-ff', '-m', 'merge', 'office/tim-1');
  git(h.dir, 'push', '-q', 'origin', 'main');
  await h.svc.collect(h.floor);
  const a = await h.answer();
  assert.deepEqual([a.status, a.recording?.outcome, a.recording?.location?.where], ['sent', 'recorded-differently', 'merged-into-main']);
  assert.match(a.recording?.text ?? '', /Monthly, by the 5th/);
  const it = (await h.ft.view(h.floor.id, true)).items[0];
  assert.equal(it.decided, 'ANSWERED: Weekly, on Mondays.');
  // Accept as recorded: a new revision whose expectation is the record; recorded (and merged), so it's done. No dispatch.
  const r = await h.ft.act(h.floor.id, `q:${h.KEY}`, 'accept-as-recorded', { by: 'Keith', expectedRev: 1 });
  assert.ok(r.ok, JSON.stringify(r));
  const after = await h.answer();
  assert.deepEqual([after.answerRev, after.status], [2, 'recorded']);
  const hist = await h.dispatcher.answers.history(h.floor.id, `q:${h.KEY}`);
  assert.deepEqual([hist[1].kind, hist[1].basis], ['accept-as-recorded', 'recorded-differently']);
  assert.equal(h.dispatcher.store.list(h.floor.id).length, 0);
  await h.svc.collect(h.floor);
  assert.equal((await h.answer()).status, 'recorded');
});

test('a record matching an earlier revision is recorded for that revision', () => {
  const qq = { key: 'k', id: 'OQ-01', file: 'F.brd.json', question: 'x', state: 'ANSWERED', rawStatus: 'ANSWERED', answer: 'Weekly', source: { where: 'main', committed: true } } as Question;
  const j = judgeQuestion(qq, { answerRev: 2, expected: [{ rev: 1, state: 'ANSWERED', answer: 'Weekly' }, { rev: 2, state: 'ANSWERED', answer: 'Daily' }] });
  assert.deepEqual([j.outcome, j.rev], ['recorded-older-rev', 1]);
  assert.equal(judgeQuestion({ ...qq, state: 'RAISED' }, { answerRev: 2, expected: [{ rev: 2, state: 'ANSWERED', answer: 'Weekly' }] }).outcome, 'not-recorded-yet');
});
