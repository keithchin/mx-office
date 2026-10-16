// Design systems: an existing app's adoption is an operation with stages (apply → commit → push → merge →
// activate, server/design/adoption.ts). Synthetic repositories, a fake mxcli, a local bare origin and injected
// failures: a failed commit or push changes no binding and leaves a recovery card; a candidate on its branch is
// never shown or told to agents as adopted; Retry keeps the branch's own commits; a restart at each boundary
// is put right from git; two Adopts make one operation; the project file's other settings survive.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DesignService } from '../src/server/design/service.js';
import type { AdoptionPoint } from '../src/server/design/adoption.js';
import { designCandidates } from '../src/shared/decisions/design.js';
import type { ProjectDesignBinding } from '../src/shared/design/types.js';
import { designWorld, published, repoApp, sh } from './design-helpers.js';

const PREV: ProjectDesignBinding = { systemId: 'dsg_01JA0000000000000000000009', name: 'Old Look', n: 3, digest: 'e'.repeat(64), kind: 'atlas', preset: 'administration', approval: { kind: 'wizard', by: 'Ada', at: 1 }, exceptions: [] };

async function world(t: { after(fn: () => void): void }, opts: { remote?: boolean; checkpoint?: (p: AdoptionPoint) => Promise<void> } = {}) {
  const clock = { now: 1_000 };
  const w = designWorld(t, { now: () => clock.now, ...(opts.checkpoint ? { checkpoint: opts.checkpoint } : {}) });
  const v = await published(w.s);
  const { dir, origin } = repoApp(w.root, { remote: opts.remote });
  w.floors.push({ id: 'f1', name: 'old-app', dir });
  await w.s.projects.bind('f1', undefined, PREV);
  assert.equal(await w.s.propose('f1', v.id, v.n, 'Ada'), undefined);
  return { ...w, v, dir, origin: origin!, clock };
}

const failingHook = (dir: string) => writeFileSync(path.join(dir, '.git', 'hooks', 'pre-commit'), '#!/bin/sh\necho "blocked by the hook" >&2\nexit 1\n');
const ask = (s: DesignService, issue?: number) => s.lines.line({ floorId: 'f1', taskId: 'tsk_T', text: 'Build the page', ...(issue ? { issue } : {}) });
const worktrees = (dir: string) => sh(dir, 'worktree', 'list').split('\n').length;

test('a failed commit: no binding change, no completed adoption, the card stays with Retry; Retry then commits', async (t) => {
  const { s, dir, v, audits } = await world(t);
  failingHook(dir);
  const err = await s.adopt('f1', 'Ada');
  assert.match(String(err), /the commit failed: blocked by the hook/);
  assert.deepEqual(s.projects.binding('f1'), PREV, 'the active binding is as it was');
  assert.equal(s.projects.apply('f1'), undefined, 'no apply record says done');
  const a = s.projects.adoption('f1')!;
  assert.deepEqual([a.status, a.failed?.stage, a.stages.apply.state, a.stages.commit.state, a.commit], ['failed', 'commit', 'done', 'failed', undefined]);
  const need = s.needView('f1', true);
  assert.ok(need.proposal, 'the proposal is still there');
  assert.equal(need.failed?.stage, 'commit');
  const card = designCandidates(need, 'f1')[0];
  assert.match(card.need.text, /failed at “committing it”: the commit failed/);
  assert.deepEqual([card.need.action, card.need.target, card.need.alt?.action], ['Retry', { to: 'design', floor: 'f1', act: 'adopt' }, 'Discard']);
  assert.equal(worktrees(dir), 1, 'no worktree left behind');
  assert.ok(audits.some((x) => x.action === 'design.adopt-failed'));
  // Fixed: Retry carries on and makes the candidate.
  unlinkSync(path.join(dir, '.git', 'hooks', 'pre-commit'));
  assert.equal(await s.adopt('f1', 'Ada'), undefined);
  const b = s.projects.adoption('f1')!;
  assert.deepEqual([b.status, b.remote, sh(dir, 'rev-parse', v.branch)], ['candidate', 'pushed', b.commit]);
  assert.deepEqual(s.projects.binding('f1'), PREV, 'still the old binding: not merged');
});

test('a failed push: the local candidate is kept and said as committed locally, not pushed; Retry pushes the branch with the review edits on it', async (t) => {
  const { s, dir, origin, v } = await world(t);
  sh(dir, 'remote', 'set-url', 'origin', path.join(dir, '..', 'no-such-origin'));
  const err = await s.adopt('f1', 'Ada');
  assert.match(String(err), /committed locally, not pushed/);
  const a = s.projects.adoption('f1')!;
  assert.deepEqual([a.status, a.failed?.stage, a.stages.commit.state, a.remote], ['failed', 'push', 'done', 'failed']);
  assert.equal(sh(dir, 'rev-parse', v.branch), a.commit, 'the commit is on the local branch');
  assert.deepEqual(s.projects.binding('f1'), PREV);
  assert.match(designCandidates(s.needView('f1', true), 'f1')[0].need.text, /is committed locally on agent-office\/design-.*, not pushed/);
  // A reviewer adds a commit on the branch; origin comes back; Retry pushes the branch as it is (never forced).
  const wt = mkdtempSync(path.join(tmpdir(), 'ao-review-'));
  t.after(() => rmSync(wt, { recursive: true, force: true }));
  rmSync(wt, { recursive: true, force: true });
  sh(dir, 'worktree', 'add', '-q', wt, v.branch);
  writeFileSync(path.join(wt, 'REVIEW.md'), 'looked at it\n');
  sh(wt, 'add', 'REVIEW.md');
  sh(wt, 'commit', '-q', '-m', 'review: notes');
  sh(dir, 'worktree', 'remove', '--force', wt);
  sh(dir, 'remote', 'set-url', 'origin', origin);
  assert.equal(await s.adopt('f1', 'Ada'), undefined);
  const b = s.projects.adoption('f1')!;
  assert.deepEqual([b.status, b.remote, b.commit], ['candidate', 'pushed', a.commit], 'the same candidate, not a new one');
  assert.match(sh(origin, 'log', '--format=%s', v.branch), /review: notes[\s\S]*design: adopt/, 'the review commit went with it');
});

test('a committed, unmerged candidate is never adopted: the gallery, the card and the agent line all say candidate; merged, it becomes the binding', async (t) => {
  const { s, dir, origin, v, audits, clock } = await world(t);
  assert.equal(await s.adopt('f1', 'Ada'), undefined);
  const view = (await s.projectView('f1', true))!;
  assert.deepEqual(view.binding, PREV, 'the gallery shows the active binding as it was');
  assert.equal(view.adoption?.status, 'candidate');
  assert.equal(view.adoption?.branch, v.branch);
  const card = designCandidates(s.needView('f1', true), 'f1')[0];
  assert.match(card.need.text, /is a candidate on the branch agent-office\/design-.* not merged/);
  assert.equal(card.need.level, 'info', 'shown, not counted as waiting');
  // Agents: the old binding's line (its guidance never mentions the candidate), never "applied" for the new one.
  await s.lines.prepare('f1');
  assert.match(ask(s)!, /^Design: Old Look@v3 /);
  // Without an active binding, the line says candidate, on its branch, not merged.
  await s.projects.forget('f1');
  await s.projects.setAdoption(view.adoption!);
  const line = ask(s)!;
  assert.match(line, /Acme Design System@v1 #[0-9a-f]{7} is only a candidate, on the branch agent-office\/design-[^,]+, not merged/);
  assert.doesNotMatch(line, /already applied|Read /);
  assert.ok(line.length <= 300);
  // Merged on origin (and fetched): the next look makes it the binding, once.
  sh(dir, 'push', '-q', 'origin', `${v.branch}:main`);
  sh(dir, 'fetch', '-q', 'origin');
  clock.now += 61_000; // a candidate is looked at again at most once a minute
  const after = (await s.projectView('f1', true))!;
  assert.equal(after.binding?.digest, v.digest);
  assert.equal(after.binding?.applied?.branch, v.branch);
  assert.equal(after.adoption, undefined);
  assert.equal(s.projects.adoption('f1')!.status, 'active');
  assert.equal(s.needView('f1', true).proposal, undefined, 'the card is gone once merged');
  assert.equal(audits.filter((x) => x.action === 'design.apply').length, 1);
  assert.match(ask(s)!, /^Design: Acme Design System@v1 .* Read /);
  // The project file on main kept its other settings.
  const file = JSON.parse(sh(origin, 'show', 'main:agent-office.project.json'));
  assert.deepEqual([file.toolkit, file.team, file.design.digest], [{ pin: 'abc123' }, { size: 3 }, v.digest]);
});

test('Retry keeps the branch’s own commits: a branch with someone’s work is built on, never deleted or forced', async (t) => {
  const { s, dir, origin, v } = await world(t);
  // Someone's earlier work on the very branch name, not in main.
  sh(dir, 'branch', v.branch);
  const wt = path.join(mkdtempSync(path.join(tmpdir(), 'ao-own-')), 'wt');
  t.after(() => rmSync(path.dirname(wt), { recursive: true, force: true }));
  sh(dir, 'worktree', 'add', '-q', wt, v.branch);
  writeFileSync(path.join(wt, 'NOTES.md'), 'design notes\n');
  sh(wt, 'add', 'NOTES.md');
  sh(wt, 'commit', '-q', '-m', 'notes: theirs');
  sh(dir, 'worktree', 'remove', '--force', wt);
  const theirs = sh(dir, 'rev-parse', v.branch);
  failingHook(dir);
  assert.match(String(await s.adopt('f1', 'Ada')), /the commit failed/);
  assert.equal(sh(dir, 'rev-parse', v.branch), theirs, 'not deleted, not moved');
  unlinkSync(path.join(dir, '.git', 'hooks', 'pre-commit'));
  assert.equal(await s.adopt('f1', 'Ada'), undefined);
  const a = s.projects.adoption('f1')!;
  assert.equal(a.preserved, 1);
  sh(dir, 'merge-base', '--is-ancestor', theirs, a.commit!);
  assert.match(sh(origin, 'log', '--format=%s', v.branch), /design: adopt[\s\S]*notes: theirs/);
  // Discard: the branch holds someone's commit and was pushed, so it stays.
  assert.equal(await s.keep('f1', 'Ada'), undefined);
  assert.equal(s.projects.adoption('f1')!.status, 'discarded');
  assert.equal(sh(dir, 'rev-parse', v.branch), a.commit);
  assert.deepEqual(s.projects.binding('f1'), PREV);
  assert.equal(s.needView('f1', true).proposal, undefined);
});

test('two Adopts at once make one operation and one commit; Adopt on a candidate makes no second commit', async (t) => {
  const { s, dir, v } = await world(t);
  const both = await Promise.all([s.adopt('f1', 'Ada'), s.adopt('f1', 'Bob')]);
  assert.deepEqual(both.filter((x) => x === undefined).length, 1);
  assert.ok(both.includes('Already adopting: wait for it to finish'));
  assert.equal(sh(dir, 'rev-list', '--count', `main..${v.branch}`), '1');
  assert.equal(await s.adopt('f1', 'Ada'), undefined);
  assert.equal(sh(dir, 'rev-list', '--count', `main..${v.branch}`), '1', 'no second commit');
  // A second version can't start a competing adoption while this one is open.
  const v2 = await published(s, 'branded', 'Acme Two');
  assert.notEqual(v2.digest, v.digest);
  assert.match(String(await s.propose('f1', v2.id, v2.n, 'Ada')), /adoption is still open on this project/);
});

test('no remote: the candidate is a local branch; squash-merged into the local main, it becomes the binding', async (t) => {
  const { s, dir, v, clock } = await world(t, { remote: false });
  assert.equal(await s.adopt('f1', 'Ada'), undefined);
  const a = s.projects.adoption('f1')!;
  assert.deepEqual([a.status, a.remote, a.stages.push.state], ['candidate', 'no-remote', 'skipped']);
  assert.deepEqual(s.projects.binding('f1'), PREV);
  sh(dir, 'merge', '-q', '--squash', v.branch);
  sh(dir, 'commit', '-q', '-m', 'squashed');
  assert.throws(() => sh(dir, 'merge-base', '--is-ancestor', a.commit!, 'main'), 'a squash: the commit itself is not on main');
  clock.now += 61_000;
  await s.projectView('f1', true);
  assert.equal(s.projects.binding('f1')!.digest, v.digest);
});

test('a broken agent-office.project.json is never overwritten: the adoption fails at apply, nothing is committed', async (t) => {
  const { s, dir, v } = await world(t);
  writeFileSync(path.join(dir, 'agent-office.project.json'), '{ "toolkit": ');
  sh(dir, 'commit', '-q', '-am', 'broken settings');
  assert.match(String(await s.adopt('f1', 'Ada')), /agent-office\.project\.json isn't valid JSON/);
  assert.equal(s.projects.adoption('f1')!.failed?.stage, 'apply');
  assert.equal(sh(dir, 'branch', '--list', v.branch), '', 'no branch with nothing of anyone’s on it… only the office’s, made just now');
});

// ---- A restart at each boundary -------------------------------------------------------------------

/** Adopt, stopped dead at `point` (as if the office were killed there); then a new service on the same data reconciles. */
async function killedAt(t: { after(fn: () => void): void }, point: AdoptionPoint) {
  let reached!: () => void;
  const there = new Promise<void>((r) => (reached = r));
  const w = await world(t, { checkpoint: async (p) => (p === point ? (reached(), new Promise<void>(() => undefined)) : undefined) });
  void w.s.adopt('f1', 'Ada');
  await there;
  const again = new DesignService({ ...w.deps, checkpoint: undefined });
  await again.ready();
  return { ...w, again, a: again.projects.adoption('f1')! };
}

test('restart after the record, before anything ran: failed at apply, nothing committed; Retry adopts', async (t) => {
  const { again, a, dir, v } = await killedAt(t, 'prepared');
  assert.deepEqual([a.status, a.failed?.stage, a.commit, a.worktree], ['failed', 'apply', undefined, undefined]);
  assert.match(a.failed!.detail, /office stopped during this step/);
  assert.deepEqual(again.projects.binding('f1'), PREV);
  assert.equal(await again.adopt('f1', 'Ada'), undefined);
  assert.equal(again.projects.adoption('f1')!.status, 'candidate');
  assert.equal(sh(dir, 'rev-list', '--count', `main..${v.branch}`), '1');
});

test('restart after mxcli applied, before the commit: failed at commit with no commit made; the worktree is cleaned; Retry commits once', async (t) => {
  const { again, a, dir, v } = await killedAt(t, 'applied');
  assert.deepEqual([a.status, a.failed?.stage, a.stages.apply.state, a.commit], ['failed', 'commit', 'done', undefined]);
  assert.match(a.failed!.detail, /no commit was made/);
  assert.equal(worktrees(dir), 1, 'the leftover worktree is gone');
  assert.deepEqual(again.projects.binding('f1'), PREV);
  assert.equal(await again.adopt('f1', 'Ada'), undefined);
  assert.equal(sh(dir, 'rev-list', '--count', `main..${v.branch}`), '1');
});

test('restart after the commit, before it was recorded: the commit is found on the branch; committed locally, not pushed; Retry pushes it', async (t) => {
  const { again, a, dir, origin, v } = await killedAt(t, 'committed');
  assert.deepEqual([a.status, a.stages.commit.state, a.commit, a.failed?.stage, a.remote], ['failed', 'done', sh(dir, 'rev-parse', v.branch), 'push', 'failed']);
  assert.match(a.failed!.detail, /^committed locally, not pushed/);
  assert.deepEqual(again.projects.binding('f1'), PREV);
  assert.equal(await again.adopt('f1', 'Ada'), undefined);
  assert.equal(sh(origin, 'rev-parse', v.branch), a.commit, 'pushed: the same commit');
  assert.equal(sh(dir, 'rev-list', '--count', `main..${v.branch}`), '1');
});

test('restart after the push, before it was recorded: origin has it, so it is a pushed candidate; not bound', async (t) => {
  const { again, a, origin, v } = await killedAt(t, 'pushed');
  assert.deepEqual([a.status, a.stages.push.state, a.remote, a.failed], ['candidate', 'done', 'pushed', undefined]);
  assert.equal(sh(origin, 'rev-parse', v.branch), a.commit);
  assert.deepEqual(again.projects.binding('f1'), PREV);
  assert.ok(existsSync(again.projects.file));
});
