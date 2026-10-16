// Nothing waits on the PM unseen, S8: the toolkit's gate advisories (written to .claude/.gate-advisories,
// otherwise printed only to an agent's stderr) as warn rows naming whose copy; a ✋ stage gate-check marks
// MANUAL "waits for your sign-off" once it is in play, whether or not the setup panel shows; and one info row for
// what's ready for your review (BRDs with reviewStatus draft or pending, the design system, wireframes).
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { actMessage, advisories, advisoryWords, brdPending, readyForReview } from '../src/server/asks/detect.js';
import { reviewFiles } from '../src/server/asks/main.js';
import { collectNeeds, hereCount } from '../src/shared/needsyou.js';
import type { SetupView } from '../src/shared/wizard.js';
import type { Read } from '../src/server/asks/sources.js';

const read = (kind: 'checkout' | 'worktree', who: string, files: Record<string, string>): Read => ({ place: { kind, who, dir: '/x' }, files: new Map(Object.entries(files)) });

test("gate advisories: one warn row per advisory and copy, in words, with Ask the lead", () => {
  assert.equal(advisoryWords('stage0'), 'Stage 0 not complete');
  assert.equal(advisoryWords('source-ledger'), 'Source files not yet accounted for (blocks Stage 1)');
  const items = advisories([read('worktree', 'Pixel', { '.claude/.gate-advisories': 'source-ledger\nstage0\n' }), read('checkout', 'the project folder', { '.claude/.gate-advisories': 'stage0\n' }), read('worktree', 'Nibble', {})], 'Ada');
  assert.deepEqual(items.map((i) => i.text), ["Gate advisory in Pixel's copy: Source files not yet accounted for (blocks Stage 1) (source-ledger)", "Gate advisory in Pixel's copy: Stage 0 not complete (stage0)", 'Gate advisory in the project folder: Stage 0 not complete (stage0)']);
  assert.ok(items.every((i) => i.level === 'warn' && i.acts[0].act === 'ask-lead' && i.acts[0].label === 'Ask Ada'));
  assert.equal(new Set(items.map((i) => i.id)).size, 3);
  assert.match(actMessage('ask-lead', items[0], 'Keith') ?? '', /printed it only to the agent that ran it/);
  const needs = collectNeeds({ floor: 'f1', workers: [], pulls: [], floors: [], asks: { floor: 'f1', items } });
  assert.deepEqual([...new Set(needs.map((n) => `${n.kind}:${n.level}`))], ['advisory:warn']);
  assert.equal(hereCount(needs), 3);
});

const setup = (o: Partial<SetupView>): SetupView => ({ show: false, stages: [], questions: [], checking: false, ...o });

test('a ✋ MANUAL stage waits for your sign-off once it is in play, past Stage 4 too (from the verdicts); a later one does not yet', () => {
  const verdicts = [
    { id: '4', title: 'Build plan', status: 'PASS' },
    { id: '5', title: 'Build', status: 'MANUAL' },
    { id: '7', title: 'Acceptance', status: 'MANUAL' },
    { id: '6', title: 'Test', status: 'PENDING' },
  ];
  const needs = collectNeeds({ floor: 'f1', workers: [], pulls: [], floors: [], setup: setup({ verdicts }) });
  // Stage 7 is MANUAL too, but Stage 6 before it hasn't passed: not in play yet (shared/gate-play.ts).
  assert.deepEqual(needs.map((n) => [n.key, n.text]), [['setup-5', 'Stage 5 (Build) waits for your sign-off']]);
  // No verdicts yet: the panel's stages, as before, only while it shows.
  assert.equal(collectNeeds({ floor: 'f1', workers: [], pulls: [], floors: [], setup: setup({ stages: [{ id: '3', title: 'Design', status: 'MANUAL' }] }) }).length, 0);
  assert.equal(collectNeeds({ floor: 'f1', workers: [], pulls: [], floors: [], setup: setup({ show: true, stages: [{ id: '3', title: 'Design', status: 'MANUAL' }] }) }).length, 1);
});

const brd = (status: string, top?: string) => JSON.stringify({ id: 'F001', ...(top ? { reviewStatus: top } : {}), useCases: [{ id: 'UC1', reviewStatus: 'reviewed' }, { id: 'UC2', reviewStatus: status }] });

test("what's ready for your review: BRDs draft or pending, the design system and wireframes, as one info row", () => {
  assert.equal(brdPending(brd('pending')), true);
  assert.equal(brdPending(brd('reviewed', 'draft')), true);
  assert.equal(brdPending(brd('reviewed')), false);
  assert.equal(brdPending('not json'), false);
  const it = readyForReview(
    [{ file: 'analysis/knowledge-base/brd/F001.brd.json', text: brd('pending') }, { file: 'analysis/knowledge-base/brd/F002.brd.json', text: brd('reviewed') }, { file: 'analysis/knowledge-base/brd/F001.brd.json', text: brd('pending') }],
    ['design/design-system.html', 'design/wireframes/Home.html', 'design/wireframes/Inbox.html', 'design/wireframes/Home.html'],
  )!;
  assert.equal(it.text, 'Ready for your review: 1 BRD, design system, 2 wireframes');
  assert.equal(it.level, 'info');
  assert.deepEqual(it.acts.map((a) => a.act), ['documents', 'seen']);
  // A new wireframe is a new id, so "Mark as seen" doesn't hide it.
  assert.notEqual(readyForReview([], ['design/wireframes/Home.html', 'design/wireframes/New.html'])!.id, readyForReview([], ['design/wireframes/Home.html'])!.id);
  assert.equal(readyForReview([], []), undefined);
  const needs = collectNeeds({ floor: 'f1', workers: [], pulls: [], floors: [], asks: { floor: 'f1', items: [it] } });
  assert.deepEqual(needs.map((n) => [n.kind, n.action, n.alt?.action]), [['review', 'Documents', 'Mark as seen']]);
  assert.equal(hereCount(needs), 0);
});

test('BRDs and design artifacts newly landed in a worktree are found on the disk', async () => {
  const wt = mkdtempSync(path.join(os.tmpdir(), 'asks-rv-'));
  mkdirSync(path.join(wt, 'analysis/knowledge-base/brd'), { recursive: true });
  mkdirSync(path.join(wt, 'design/wireframes'), { recursive: true });
  writeFileSync(path.join(wt, 'analysis/knowledge-base/brd/F001.brd.json'), brd('pending'));
  writeFileSync(path.join(wt, 'design/design-system.html'), '<html></html>');
  writeFileSync(path.join(wt, 'design/wireframes/Home.html'), '<html></html>');
  // No git repo: main has nothing; the worktree is read from the disk.
  const got = await reviewFiles(mkdtempSync(path.join(os.tmpdir(), 'asks-norepo-')), 'HEAD', [{ kind: 'worktree', who: 'Barbara', dir: wt }]);
  assert.deepEqual(got.brds.map((b) => b.file), ['analysis/knowledge-base/brd/F001.brd.json']);
  assert.deepEqual(got.design.sort(), ['design/design-system.html', 'design/wireframes/Home.html']);
  assert.equal(readyForReview(got.brds, got.design)!.text, 'Ready for your review: 1 BRD, design system, 1 wireframe');
});
