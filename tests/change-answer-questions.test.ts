// Change answer, BRD questions (Slice 1B-3): a sent question's answer changed is the next revision,
// dispatched once to the analyst with the question key and the new revision; the book entry is sent again
// and followed through at the new revision; the history comes from the answer store, so it shows every
// revision after the book's bounded copies (a few expectations kept) have rolled over. Real git, the
// toolkit script faked, the 1B-1 dispatcher real; no office, no Claude, no GitHub.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { WorkerInfo } from '../src/shared/protocol.js';
import { Collector } from '../src/server/questions/collect.js';
import { normalise } from '../src/server/questions/normalise.js';
import type { ScriptOutcome, ScriptRunner } from '../src/server/questions/script.js';
import { QuestionsService, type QFloor } from '../src/server/questions/service.js';
import { changedFiles, foldersOf, questionLocator } from '../src/server/questions/index.js';
import { Dispatcher } from '../src/server/dispatch/service.js';
import { FollowStore } from '../src/server/followthrough/store.js';
import { ChangeAnswer } from '../src/server/change-answer/service.js';
import { withMarker } from '../src/shared/dispatch.js';
import { git } from './followthrough-helpers.js';

const KB = 'analysis/knowledge-base/brd';
const NOW = Date.parse('2026-10-15T09:00:00Z');
const q = (id: string, status: string, extra: Record<string, unknown> = {}) => ({ id, question: `Fictional question ${id}?`, kind: 'user-only', status, blocks: `FR-${id}`, proposedPosition: 'Monthly', ...extra });
const brd = (qs: unknown[]) => JSON.stringify({ id: 'F001', title: 'Registry', openQuestions: qs }, null, 1);

function fakeScript(): ScriptRunner {
  return async (_s, dir) => {
    const kb = path.join(dir, KB);
    const files = existsSync(kb) ? readdirSync(kb).filter((f) => f.endsWith('.brd.json')) : [];
    const questions = files.flatMap((f) => (JSON.parse(readFileSync(path.join(kb, f), 'utf8')).openQuestions as Record<string, unknown>[]).map((x) => ({ state: normalise(x).state, id: String(x.id), origin: f, question: String(x.question), reason: 'script', rawStatus: String(x.status) })));
    return { ok: true, json: { examined: { brdFiles: files.length, smeQuestionFiles: 0, nothingExamined: !files.length }, questions } } satisfies ScriptOutcome;
  };
}

async function harness() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'caq-'));
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
  const workers = [] as unknown as WorkerInfo[];
  const floor: QFloor = { id: 'caq', name: 'proj', dir };
  const data = mkdtempSync(path.join(os.tmpdir(), 'caq-data-'));
  let now = NOW;
  const dispatcher = new Dispatcher({ dataDir: data, now: () => now });
  const collector = new Collector({ floor: floor.id, floorDir: dir, script: async () => '/tk/bin/open-questions.sh', run: fakeScript(), changed: changedFiles, now: () => now });
  const svc = new QuestionsService({
    dataDir: data,
    now: () => now,
    floors: () => [floor],
    folders: () => foldersOf(floor, workers),
    collector: () => collector,
    recipientOf: () => ({ name: 'Tim', workerId: 'w-tim', working: false }),
    send: () => ({ dispatchId: 'dsp_test' }),
    answer: (f, spec) => dispatcher.answer(f.id, spec),
    locator: (f) => questionLocator(f.dir),
    decisionHours: () => 24,
    record: () => {},
  });
  const typed: string[] = [];
  const c = new ChangeAnswer({
    dataDir: data,
    now: () => now,
    dispatcher,
    follow: new FollowStore(path.join(data, 'followthrough')),
    escalations: () => [],
    questions: () => ({ book: (id) => svc.book(id), commit: (id) => svc.commit(id) }),
    escTarget: () => 'n/a',
    qTarget: async () => (text: string) => ({ channel: 'type' as const, workerId: 'w-tim', workerName: 'Tim', payload: (m: string) => withMarker(text, m), act: (r) => (typed.push(r.payload), { state: 'submitted' as const }) }),
    sources: () => ({ tasks: [], changeRequests: [] }),
    flush: async () => {},
    record: () => {},
  });
  const KEY = 'F001.brd.json#OQ-01';
  const answer = async () => (await svc.view(floor, true)).answers[KEY];
  await svc.collect(floor);
  assert.equal(await svc.answer(floor, KEY, 'answer', { text: 'Weekly, on Mondays.', by: 'Keith' }), undefined);
  await svc.send(floor, 'Tim', { by: 'Keith', when: 'after' });
  return { floor, svc, c, dispatcher, typed, KEY, answer, tick: () => (now += 60_000) };
}

test('change-question: a sent answer changed is rev 2 superseding rev 1, typed once with the question key, and sent again at rev 2', async () => {
  const h = await harness();
  const decision = `q:${h.KEY}`;
  assert.deepEqual([(await h.answer()).status, (await h.answer()).answerRev], ['sent', 1]);
  const stale = await h.c.change(h.floor.id, { floor: h.floor.id, decision, expectedRev: 0, kind: 'accept' }, { by: 'Keith' });
  assert.equal(stale.ok ? 0 : stale.status, 409);
  assert.equal(h.typed.length, 0, 'nothing typed for a stale page');
  const r = await h.c.change(h.floor.id, { floor: h.floor.id, decision, expectedRev: 1, kind: 'accept' }, { by: 'Keith' });
  assert.ok(r.ok, JSON.stringify(r));
  const hist = await h.dispatcher.answers.history(h.floor.id, decision);
  assert.deepEqual(
    hist.map((l) => [l.rev, l.kind, l.supersedes]),
    [
      [1, 'answer', undefined],
      [2, 'accept-proposal', 1],
    ],
  );
  assert.equal(h.typed.length, 1);
  assert.ok(h.typed[0].startsWith(`This replaces my answer rev 1 to question ${h.KEY}: ASSUMED: Monthly`), h.typed[0]);
  assert.match(h.typed[0], new RegExp(`Record it as rev 2 of ${h.KEY.replace('.', '\\.')}`));
  assert.match(h.typed[0], /status: ASSUMED/);
  assert.match(h.typed[0], /Q OQ-01 rev 2\]$/);
  const a = await h.answer();
  assert.deepEqual([a.status, a.answerRev, a.kind, a.recording?.outcome], ['sent', 2, 'accept', 'not-recorded-yet']);
  assert.deepEqual(
    a.expected?.map((x) => [x.rev, x.state]),
    [
      [1, 'ANSWERED'],
      [2, 'ASSUMED'],
    ],
  );
});

test('change-history-complete: every revision from the answer store, full text and dispatch state, after the bounded copies rolled over', async () => {
  const h = await harness();
  const decision = `q:${h.KEY}`;
  const long = 'x'.repeat(3900); // the input's limit is 4,000 characters, as on the card
  for (let rev = 1; rev <= 7; rev++) {
    h.tick();
    const r = await h.c.change(h.floor.id, { floor: h.floor.id, decision, expectedRev: rev, kind: 'answer', text: `Answer ${rev + 1}: ${long}` }, { by: 'Keith' });
    assert.ok(r.ok, JSON.stringify(r));
  }
  const a = await h.answer();
  assert.equal(a.answerRev, 8);
  assert.ok((a.expected?.length ?? 0) <= 5, 'the book keeps a few');
  const d = await h.c.detail(h.floor.id, decision);
  assert.ok(typeof d !== 'string');
  assert.equal(d.revs.length, 8);
  assert.deepEqual(
    d.revs.map((x) => x.rev),
    [1, 2, 3, 4, 5, 6, 7, 8],
  );
  assert.equal(d.revs[7].text, `Answer 8: ${long}`, 'the full text');
  assert.equal(d.revs[3].supersedes, 3);
  assert.ok(d.revs.slice(1).every((x) => x.dispatch.length === 1 && x.dispatch[0].state === 'submitted'));
  assert.equal(d.revs[2].outcome?.outcome, 'not-recorded-yet', "an older revision's finding as it was when replaced");
  assert.deepEqual(d.links.map((l) => [l.kind, l.strength]), [['blocks', 'inferred']]);
  assert.equal(d.input.kind, 'q');
});
