// A merged PR is a task's outcome only with evidence (roster/task-outcome.ts, packtrack audit 16 Oct, finding 1):
// it merged after the task was given, and it carries the task's id (a `Task: tsk_…` line in its description or
// in one of its commits). One that only matches by worker, branch or time is "associated (unconfirmed)", never
// integrated. Ends recorded before the rule that don't stand are taken back when the task is read
// (roster/task-reopen.ts), with a note, and the durable task record is never rewritten. Fake floors and a
// throwaway git repo only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, existsSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { WorkerInfo, WorkerStatus } from '../src/shared/protocol.js';
import { Roster } from '../src/server/roster/index.js';
import type { HireAsk, TeamFloor } from '../src/server/roster/types.js';
import { finishedWhy, outcomeOf, reviveAssignment, taskOutcome, type Assignment } from '../src/server/roster/resume.js';
import { pullEvidence, type PullLook } from '../src/server/roster/task-outcome.js';
import { staleDone } from '../src/server/roster/task-reopen.js';
import { PrTaskIds, taskLineIds } from '../src/server/roster/pr-task-ids.js';
import { memberTaskAt } from '../src/server/roster/dispatch-hooks.js';
import { BACK_GRACE_MS } from '../src/server/roster/back-to-work.js';

const ID = 'tsk_01M52HHWBF4996YA5XXXX73304';
const OTHER = 'tsk_01M526SK6TXBBJ53EAPEDG0FQQ';
const GIVEN = Date.parse('2026-10-16T14:23:45Z');
const task: Assignment = { text: 'P-4 photo resend', at: GIVEN, by: 'Katherine', taskId: ID };
const pr = (number: number, mergedAt: string | undefined, body = '', state = 'MERGED'): PullLook => ({ number, state, headRefName: 'office/pixel-b1e9', ...(mergedAt ? { mergedAt } : {}), body });

// ---- The rule, pure -----------------------------------------------------------------------------------------

test('a PR merged before the task was given is not its outcome, even if it names the task', () => {
  const old = pr(3, '2026-10-16T11:01:00Z', `Task: ${ID}`);
  assert.equal(pullEvidence(old, { since: GIVEN, taskId: ID }), 'predates');
  assert.equal(taskOutcome({ task, pr: { number: 3 }, pulls: [old] }), undefined, 'the task stays open');
  assert.equal(finishedWhy({ task, pr: { number: 3 }, pulls: [old] }), undefined, 'and is nudged as an open task');
  // Its agent saying task done is still only a claim.
  assert.equal(taskOutcome({ task, pr: { number: 3 }, pulls: [old], lastWords: 'Task done.' })?.kind, 'claimed');
});

test('a PR merged after the task that carries its Task line (description or a commit) is its outcome', () => {
  const body = pr(7, '2026-10-16T16:00:00Z', `Resend photos\n\nTask: ${ID}\n`);
  assert.deepEqual(taskOutcome({ task, pr: { number: 7 }, pulls: [body] }), { kind: 'integrated', why: 'PR #7 merged', pr: 7 });
  // A commit trailer, read from local git (pr-task-ids.ts), counts the same.
  const bare = pr(7, '2026-10-16T16:00:00Z', 'Resend photos');
  const carries = (p: PullLook) => (p.number === 7 ? new Set([ID]) : new Set<string>());
  assert.equal(taskOutcome({ task, pr: { number: 7 }, pulls: [bare], carries })?.kind, 'integrated');
  // A merged PR that isn't the worker's but names the task in its description counts too.
  assert.deepEqual(taskOutcome({ task, pr: { number: 3 }, pulls: [pr(3, '2026-10-16T11:01:00Z'), body] }), { kind: 'integrated', why: 'PR #7 merged', pr: 7 });
  // Naming another task, or the id only in passing (not a Task: line), doesn't.
  assert.equal(taskOutcome({ task, pr: { number: 7 }, pulls: [pr(7, '2026-10-16T16:00:00Z', `Task: ${OTHER}`)] })?.kind, 'associated');
  assert.equal(taskOutcome({ task, pr: { number: 7 }, pulls: [pr(7, '2026-10-16T16:00:00Z', `see ${ID} later`)] })?.kind, 'associated');
});

test('a PR merged after the task without its id is associated (unconfirmed) only: never integrated, the task stays open', () => {
  const after = pr(7, '2026-10-16T16:00:00Z', 'Resend photos');
  const o = taskOutcome({ task, pr: { number: 7 }, pulls: [after], carries: () => new Set() });
  assert.deepEqual(o, { kind: 'associated', why: `PR #7 merged, associated (unconfirmed): it doesn't carry Task: ${ID}`, pr: 7 });
  assert.equal(finishedWhy({ task, pr: { number: 7 }, pulls: [after] }), undefined, 'still open: nudged as usual');
  // Commits not read yet: unconfirmed too, never delivered on a guess.
  assert.equal(taskOutcome({ task, pr: { number: 7 }, pulls: [after], carries: () => undefined })?.kind, 'associated');
  // No merge time known, or a legacy task with no id: unconfirmed.
  assert.equal(taskOutcome({ task, pr: { number: 7 }, pulls: [pr(7, undefined, `Task: ${ID}`)] })?.kind, 'associated');
  const legacy: Assignment = { text: 'old work', at: GIVEN, by: 'K' };
  assert.equal(taskOutcome({ task: legacy, pr: { number: 7 }, pulls: [after] })?.kind, 'associated');
  // A claim wins over it, and it never replaces a pending claim.
  assert.equal(taskOutcome({ task, pr: { number: 7 }, pulls: [after], lastWords: 'Task done.' })?.kind, 'claimed');
  const claimed: Assignment = { ...task, pending: { kind: 'claimed', at: GIVEN + 1, why: 'it said task done (pending verification)' } };
  assert.equal(taskOutcome({ task: claimed, pr: { number: 7 }, pulls: [after] })?.kind, 'claimed');
  // A closed PR replaced by an unconfirmed merge: no decision card, and not delivered.
  const closed = { ...pr(6, undefined, '', 'CLOSED'), closedAt: '2026-10-16T15:00:00Z' };
  assert.equal(taskOutcome({ task, pr: { number: 6 }, pulls: [closed, after] })?.kind, 'associated');
  // A PR closed before the task was given raises no decision for it.
  const closedBefore = { ...pr(2, undefined, '', 'CLOSED'), closedAt: '2026-10-16T10:00:00Z' };
  assert.equal(taskOutcome({ task, pr: { number: 2 }, pulls: [closedBefore] }), undefined);
});

test('staleDone: a recorded PR end stands unless the PR predates the task, or its commits are known not to carry the id', () => {
  const done: Assignment = { ...task, doneAt: GIVEN + 3_000_000, doneWhy: 'PR #3 merged', outcome: 'integrated', pr: 3, v: 2 };
  assert.equal(staleDone(done, { pulls: [pr(3, '2026-10-16T11:01:00Z')] }), 'earlier shown as done by PR #3 — that PR predates the task');
  const after = pr(3, '2026-10-16T16:00:00Z');
  assert.equal(staleDone(done, { pulls: [after], carries: () => undefined }), undefined, "commits not read yet: it stands for now");
  assert.equal(staleDone(done, { pulls: [after], carries: () => new Set([OTHER]) }), `earlier shown as done by PR #3 — that PR doesn't carry Task: ${ID}`);
  assert.equal(staleDone(done, { pulls: [after], carries: () => new Set([ID]) }), undefined);
  assert.equal(staleDone(done, { pulls: [] }), undefined, 'PR not in the list: nothing to judge');
  assert.equal(staleDone({ ...done, outcome: 'delivered', pr: undefined }, { pulls: [pr(3, '2026-10-16T11:01:00Z')] }), undefined, 'an issue end is left alone');
  // The note survives a save.
  const kept = reviveAssignment({ ...task, shownDone: { at: 1, why: 'PR #3 merged', pr: 3, note: 'earlier shown as done by PR #3 — that PR predates the task' } });
  assert.equal(kept?.shownDone?.note, 'earlier shown as done by PR #3 — that PR predates the task');
});

// ---- On a fake floor: existing wrong ends are corrected on read ---------------------------------------------

class FakeFloor implements TeamFloor {
  id = `truth-${Math.random().toString(36).slice(2, 8)}`;
  name = 'truth-test';
  dir = mkdtempSync(path.join(os.tmpdir(), 'truth-floor-'));
  map = new Map<string, WorkerInfo>();
  typed: { id: string; text: string }[] = [];
  activities: string[] = [];
  list: PullLook[] = [];
  roster!: Roster;
  private n = 0;
  workers = () => [...this.map.values()];
  worker = (id: string) => this.map.get(id);
  async hire(ask: HireAsk): Promise<WorkerInfo> {
    const id = `w${++this.n}`;
    const w = { id, kind: 'agent', provider: 'claude', deskId: 'd', name: ask.name, color: '#fff', status: 'starting', acked: true, createdBy: ask.by, createdAt: this.roster.deps.now(), cols: 80, rows: 24, viewers: [], viewerIds: [], worktree: { path: `wt/${id}`, branch: 'office/pixel-b1e9', base: 'main' } } as unknown as WorkerInfo;
    this.map.set(id, w);
    mkdirSync(this.cwdOf(w), { recursive: true });
    return w;
  }
  async stop(id: string) {
    this.map.delete(id);
  }
  prompt(id: string, text: string) {
    this.typed.push({ id, text });
    return undefined;
  }
  wake() {
    return undefined;
  }
  rename() {}
  cwdOf = (w: WorkerInfo) => path.join(this.dir, 'wt', w.id);
  openPulls = () => this.list.filter((p) => p.state === 'OPEN').map((p) => ({ number: p.number, title: `PR ${p.number}`, url: '', headRefName: p.headRefName ?? '' }));
  pulls = () => this.list;
  toast = () => {};
  changed = () => {};
  activity = (text: string) => void this.activities.push(text);
  set(id: string, status: WorkerStatus) {
    Object.assign(this.map.get(id)!, { status });
    this.roster.onWorker(this, this.map.get(id)!);
  }
}

async function office() {
  const clock = { now: Date.UTC(2026, 9, 16, 14, 23) };
  const floor = new FakeFloor();
  const dataDir = mkdtempSync(path.join(os.tmpdir(), 'truth-data-'));
  const roster = new Roster({ dataDir, floors: () => [floor], makeIssue: async () => ({ number: 2 }), analysis: () => '', now: () => clock.now }, 0);
  floor.roster = roster;
  assert.equal(await roster.members.hire(floor, 'lead-developer', 'Katherine', undefined, 'Resend the P-4 photos from the File Uploader'), undefined);
  const id = roster.data(floor.id).members['lead-developer'].workerId!;
  const w = floor.worker(id)!;
  floor.set(id, 'working');
  const t = () => roster.data(floor.id).members['lead-developer'].task!;
  const member = () => roster.view(floor, true).members.find((m) => m.role === 'lead-developer')!;
  return { clock, floor, roster, id, w, t, member, dataDir };
}

test('a task recorded as done by an older PR falls back to open on read, with the note; the task record is not rewritten', async () => {
  const { clock, floor, roster, id, w, t, member, dataDir } = await office();
  const store = roster.tasks.ids.of(floor.id);
  await store.flushed(floor.id);
  const file = store.file(floor.id);
  const before = existsSync(file) ? readFileSync(file, 'utf8') : '';
  // As release 55 left it: "PR #3 merged", though PR #3 merged hours before the task was given.
  w.pr = { number: 3, url: '' };
  floor.list = [pr(3, '2026-10-16T11:01:00Z')];
  Object.assign(t(), { doneAt: clock.now + 60_000, doneWhy: 'PR #3 merged', outcome: 'integrated', pr: 3, v: 2 });
  const prev: Assignment = { text: 'BR-08 implementation', at: Date.parse('2026-10-16T11:15:43Z'), by: 'Katherine', taskId: 'tsk_01M526SK6TXBBJ53EAPEDG0FQQ', doneAt: 1, doneWhy: 'PR #3 merged', outcome: 'integrated', pr: 3, v: 2 };
  roster.data(floor.id).members['lead-developer'].prevTasks = [prev];
  // Read: open again, its true state, and the note says why.
  assert.equal(roster.tasks.current(floor, w), t().text);
  assert.equal(outcomeOf(t()), 'open');
  assert.equal(t().shownDone?.note, 'earlier shown as done by PR #3 — that PR predates the task');
  assert.equal(member().task, t().text, 'Needs you sees an open task again');
  assert.equal(member().taskNote, 'earlier shown as done by PR #3 — that PR predates the task');
  assert.equal(outcomeOf(roster.data(floor.id).members['lead-developer'].prevTasks![0]), 'open', 'the earlier task too');
  assert.ok(floor.activities.some((a) => /open again .*predates the task/.test(a)));
  // Her turn ends: nudged back to it, as any open task.
  floor.set(id, 'done');
  clock.now += BACK_GRACE_MS + 1000;
  assert.equal(roster.backToWork.check(floor, 'lead-developer'), true);
  // The durable record is append only and untouched by the correction.
  await store.flushed(floor.id);
  assert.equal(existsSync(file) ? readFileSync(file, 'utf8') : '', before);
  // The real delivery later: a PR merged after it, carrying its Task line.
  w.pr = { number: 7, url: '' };
  floor.list = [pr(3, '2026-10-16T11:01:00Z'), { ...pr(7, new Date(clock.now).toISOString(), `Task: ${t().taskId}`), headRefName: 'office/pixel-b1e9' }];
  assert.equal(roster.tasks.finished(floor, w), 'PR #7 merged', 'its turn-end look settles it');
  assert.deepEqual([outcomeOf(t()), t().pr, t().doneWhy], ['integrated', 7, 'PR #7 merged']);
  assert.equal(member().taskNote, undefined);
  roster.stop();
  void dataDir;
});

test('an unconfirmed merge leaves the task open, shows the note, and the resume line says how to count it', async () => {
  const { clock, floor, roster, w, t, member } = await office();
  w.pr = { number: 8, url: '' };
  floor.list = [pr(8, new Date(clock.now + 60_000).toISOString(), 'no task line')];
  assert.equal(roster.tasks.current(floor, w), t().text);
  assert.match(member().taskNote ?? '', /^PR #8 merged, associated \(unconfirmed\)/);
  assert.match(roster.tasks.line(floor, w), new RegExp(`must carry the line "Task: ${t().taskId}"`));
  // A dispatch made now doesn't capture an old merged PR as this task's.
  w.pr = { number: 3, url: '' };
  floor.list = [pr(3, '2026-10-16T11:01:00Z')];
  assert.equal(memberTaskAt(roster, floor.id, w.id)?.pr, undefined);
  roster.stop();
});

// ---- Commit trailers, from local git --------------------------------------------------------------------------

test('PrTaskIds reads the Task lines of a merged PR’s commits (merge commit and squash), and peeks without waiting', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'truth-git-'));
  const g = (...a: string[]) => execFileSync('git', a, { cwd: dir, encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@x', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@x' } }).trim();
  g('init', '-q', '-b', 'main');
  writeFileSync(path.join(dir, 'a.txt'), '1');
  g('add', '.');
  g('commit', '-q', '-m', `base\n\nTask: ${OTHER}`);
  g('checkout', '-q', '-b', 'feat');
  writeFileSync(path.join(dir, 'b.txt'), '2');
  g('add', '.');
  g('commit', '-q', '-m', `P-4 resend\n\nTask: ${ID}`);
  const head = g('rev-parse', 'HEAD');
  g('checkout', '-q', 'main');
  g('merge', '-q', '--no-ff', 'feat', '-m', 'Merge PR #7');
  const merge = g('rev-parse', 'HEAD');
  const ids = new PrTaskIds();
  assert.deepEqual([...((await ids.read(dir, { number: 7, headRefOid: head, mergeCommit: merge })) ?? [])], [ID], "the PR's own commit, not main's");
  // Squash: only the merge commit is known locally; its message carries the trailer.
  g('commit', '-q', '--allow-empty', '-m', `Squashed P-4 (#9)\n\n* P-4 resend\n\nTask: ${ID}`);
  const squash = g('rev-parse', 'HEAD');
  assert.deepEqual([...((await ids.read(dir, { number: 9, mergeCommit: squash })) ?? [])], [ID]);
  // peek: unknown at first, known once the look is done.
  assert.equal(ids.peek(dir, { number: 7, headRefOid: head, mergeCommit: merge }), undefined);
  for (let i = 0; i < 100 && !ids.peek(dir, { number: 7, headRefOid: head, mergeCommit: merge }); i++) await new Promise((r) => setTimeout(r, 20));
  assert.ok(ids.peek(dir, { number: 7, headRefOid: head, mergeCommit: merge })?.has(ID));
  assert.equal(ids.peek(dir, { number: 1 }), undefined, 'no revisions: nothing to read');
  assert.equal(await ids.read(dir, { number: 2, headRefOid: 'f'.repeat(40) }), undefined, 'a revision git lacks: unknown');
  assert.deepEqual(taskLineIds(`x\nTask: ${ID}\n  task: ${OTHER}\nsee ${OTHER}`), [ID, OTHER]);
});
