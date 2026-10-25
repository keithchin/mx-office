// The change queue in a local-only project (real build test P0-3): no GitHub, no PRs, a bare local remote, real
// git and fake agents (the "agent" here is git commands). Before Increment B every change stayed "On candidate…
// Not merged" there, and an active change couldn't be cancelled. With the office's own seams (the candidate
// observer, merged-by-git on main's first-parent line, the preview's served revision, the queue service):
//   - DC-1 worked on dev/DC-1 and merged into main by fast-forward, and by a merge commit: Implemented, and the
//     queue moves to DC-2
//   - a candidate that is main's head (committed straight to main, the branch pointing at it): never "On
//     candidate", never "Not merged: the live preview runs main"
//   - preview availability follows the served revision (behind, then in)
//   - cancelling an active change in a local-only project frees the slot
//   - a correction (of: DC-1) queued behind DC-1 starts once DC-1 is implemented, or cancelled
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { changeBranch, activeOf, type DevChange } from '../src/shared/dev-changes.js';
import { ChangeStore } from '../src/server/dev-changes/store.js';
import { DevChanges, type Activated, type ChangeDeps } from '../src/server/dev-changes/service.js';
import { newCandidates } from '../src/server/dev-changes/observe.js';
import { changeFacts, changeViews, type ViewInputs } from '../src/server/dev-changes/view.js';
import { mergedAt } from '../src/server/dev-changes/wire.js';
import { defaultBranch, floorRef } from '../src/server/liveapp/checkout.js';
import { contains } from '../src/server/tasks/git.js';
import { removeDir } from './support/cleanup.js';

const FLOOR = 'local-shop';
const ALEX = { name: 'Alex Lee', id: 'acc_1', admin: false };

function sh(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', windowsHide: true, env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: 'test@example.com', GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: 'test@example.com' } }).trim();
}

/** A local-only project: a bare remote on disk, the project folder cloned from it, one commit on main. */
function project() {
  const root = mkdtempSync(path.join(tmpdir(), 'ao-dc-local-'));
  const remote = path.join(root, 'remote.git');
  const dir = path.join(root, 'project');
  sh(root, 'init', '--bare', '-q', '-b', 'main', remote);
  sh(root, 'clone', '-q', remote, dir);
  sh(dir, 'checkout', '-q', '-b', 'main');
  let n = 0;
  const commit = (msg: string) => {
    writeFileSync(path.join(dir, `f${++n}.txt`), msg);
    sh(dir, 'add', '-A');
    sh(dir, 'commit', '-q', '-m', msg);
    return sh(dir, 'rev-parse', 'HEAD');
  };
  commit('init');
  sh(dir, 'push', '-q', '-u', 'origin', 'main');
  sh(dir, 'remote', 'set-head', 'origin', 'main');
  return { root, dir, commit, head: (ref = 'HEAD') => sh(dir, 'rev-parse', ref) };
}

/** The queue with the office's real git seams (as dev-changes/index.ts wires them) and fakes for the team. */
function office(dir: string, root: string) {
  const store = new ChangeStore(path.join(root, 'data', 'dev-changes'));
  const handed: string[] = [];
  const preview = { running: false, served: undefined as string | undefined };
  let t = 0;
  // Main's head as the office reads it (index.ts mainHead, without its few-second cache).
  const mainHead = async () => (await floorRef(dir, await defaultBranch(dir)))?.sha.trim().toLowerCase();
  const inputs = (): ViewInputs => ({
    task: () => undefined,
    assignments: [],
    pulls: [], // local-only: no PR list at all
    preview: { running: preview.running, ...(preview.served ? { served: preview.served } : {}) },
    contains: (sha, into) => contains(dir, sha, into).catch(() => undefined),
    mergedAt: async (sha) => mergedAt(dir, sha, await mainHead()),
    mayCancel: (c) => c.owner === ALEX.id,
  });
  const deps: ChangeDeps = {
    store,
    now: () => Date.now(),
    blocked: () => undefined,
    mainHead,
    recheck: async () => undefined,
    async hand(_f, c): Promise<Activated | string> {
      handed.push(c.id);
      return { requestId: `CR-${handed.length}`, taskId: `tsk_${String(++t).padStart(26, '0')}`, member: 'Ada', role: 'pm', workerId: 'w-ada', delivery: 'sent' };
    },
    facts: (_f, c) => changeFacts(c, inputs()),
    record: () => undefined,
    stop: async () => ({ how: 'idle', worker: 'Ada' }),
    endTask: () => undefined,
  };
  const svc = new DevChanges(deps);
  /** What observeChanges does on an event: the active change's branch head as a candidate, then the queue moves. */
  const observe = async () => {
    const all = await store.all(FLOOR);
    const active = activeOf(all);
    if (active) {
      const head = await floorRef(dir, changeBranch(active.id));
      for (const cand of newCandidates(active, [], head?.sha.trim(), Date.now())) await store.event(FLOOR, active.id, { type: 'candidate', at: cand.seenAt, candidate: cand });
    }
    await svc.advance(FLOOR);
  };
  const views = async () => changeViews(await store.all(FLOOR), inputs());
  const view = async (id: string) => (await views()).find((v) => v.id === id)!;
  const ask = async (text: string, extra: Record<string, unknown> = {}) => {
    const r = await svc.intake(FLOOR, { text, by: ALEX.name, owner: ALEX.id, ...extra });
    if (typeof r === 'string') throw new Error(r);
    return r.change;
  };
  return { store, svc, handed, preview, observe, views, view, ask };
}

const NOT_MERGED = /Not merged/;

test('fast-forward: DC-1 on dev/DC-1 becomes Implemented once main has it, the queue moves to DC-2, the preview follows the served revision', async () => {
  const p = project();
  try {
    const o = office(p.dir, p.root);
    const before = p.head();
    o.preview.running = true;
    o.preview.served = before;
    await o.ask('Show the loan’s due date on the overview');
    await o.ask('Add a filter for overdue loans');
    assert.deepEqual(o.handed, ['DC-1'], 'one active change');
    // The agent works on dev/DC-1 and pushes the branch.
    sh(p.dir, 'checkout', '-q', '-b', 'dev/DC-1');
    const c1 = p.commit('DC-1: due date');
    sh(p.dir, 'push', '-q', 'origin', 'dev/DC-1');
    await o.observe();
    let v = await o.view('DC-1');
    assert.equal(v.state, 'candidate');
    assert.equal(v.revision, c1);
    assert.equal(v.facts.preview.status, 'main', 'an unmerged candidate isn’t in the preview');
    assert.equal(v.mayCancel, true, 'an active change can be cancelled by whoever asked');
    assert.equal((await o.view('DC-2')).state, 'queued');
    // Fast-forwarded into main, pushed to the local remote.
    sh(p.dir, 'checkout', '-q', 'main');
    sh(p.dir, 'merge', '-q', '--ff-only', 'dev/DC-1');
    sh(p.dir, 'push', '-q', 'origin', 'main');
    await o.observe();
    v = await o.view('DC-1');
    assert.equal(v.state, 'implemented', v.detail);
    assert.equal(v.revision, c1, 'merged @ the candidate itself (it is on main’s first-parent line)');
    assert.match(v.detail, /found on main by git, no PR/);
    assert.doesNotMatch(JSON.stringify(v), NOT_MERGED);
    assert.equal(v.queue, 'settled');
    assert.deepEqual(o.handed, ['DC-1', 'DC-2'], 'the queue moved to DC-2');
    assert.equal((await o.view('DC-2')).state, 'working');
    // The preview still serves the old main: behind. Rebuilt on the new main: in.
    assert.equal(v.facts.preview.status, 'behind');
    o.preview.served = c1;
    assert.equal((await o.view('DC-1')).facts.preview.status, 'in');
    o.preview.running = false;
    assert.equal((await o.view('DC-1')).facts.preview.status, 'off');
  } finally {
    removeDir(p.root);
  }
});

test('merge commit: DC-1 merged with --no-ff is Implemented at the merge commit, and the queue moves', async () => {
  const p = project();
  try {
    const o = office(p.dir, p.root);
    await o.ask('Show the loan’s due date on the overview');
    await o.ask('Add a filter for overdue loans');
    sh(p.dir, 'checkout', '-q', '-b', 'dev/DC-1');
    const c1 = p.commit('DC-1: due date');
    sh(p.dir, 'push', '-q', 'origin', 'dev/DC-1');
    await o.observe();
    sh(p.dir, 'checkout', '-q', 'main');
    p.commit('something else on main meanwhile');
    sh(p.dir, 'merge', '-q', '--no-ff', '-m', 'Merge dev/DC-1', 'dev/DC-1');
    const m = p.head();
    sh(p.dir, 'push', '-q', 'origin', 'main');
    await o.observe();
    const v = await o.view('DC-1');
    assert.equal(v.state, 'implemented', v.detail);
    assert.equal(v.revision, m, 'the merge commit on main’s first-parent line');
    assert.notEqual(m, c1);
    assert.doesNotMatch(JSON.stringify(v), NOT_MERGED);
    assert.deepEqual(o.handed, ['DC-1', 'DC-2']);
  } finally {
    removeDir(p.root);
  }
});

test('a candidate that is main’s head (committed straight to main, the branch on it) is never "On candidate" or "Not merged"', async () => {
  const p = project();
  try {
    const o = office(p.dir, p.root);
    await o.ask('Show the loan’s due date on the overview');
    await o.ask('Add a filter for overdue loans');
    const c1 = p.commit('DC-1: due date, straight on main');
    sh(p.dir, 'push', '-q', 'origin', 'main');
    sh(p.dir, 'branch', 'dev/DC-1', 'main');
    sh(p.dir, 'push', '-q', 'origin', 'dev/DC-1');
    o.preview.running = true;
    o.preview.served = c1;
    await o.observe();
    const v = await o.view('DC-1');
    assert.deepEqual(v.candidates.map((x) => x.sha), [c1], 'its candidate is main’s head');
    assert.equal(v.state, 'implemented', v.detail);
    assert.equal(v.revision, c1);
    assert.notEqual(v.facts.execution.status, 'candidate');
    assert.doesNotMatch(JSON.stringify(v), NOT_MERGED, 'never "Not merged: the live preview runs main" for a commit on main');
    assert.equal(v.facts.preview.status, 'in', 'the preview serves it');
    assert.deepEqual(o.handed, ['DC-1', 'DC-2']);
  } finally {
    removeDir(p.root);
  }
});

test('a fresh dev/DC-1 with nothing on it yet (still main’s head when it was handed over) is no candidate, so never Implemented', async () => {
  const p = project();
  try {
    const o = office(p.dir, p.root);
    await o.ask('Show the loan’s due date on the overview');
    await o.ask('Add a filter for overdue loans');
    sh(p.dir, 'branch', 'dev/DC-1', 'main');
    sh(p.dir, 'push', '-q', 'origin', 'dev/DC-1');
    await o.observe();
    const v = await o.view('DC-1');
    assert.deepEqual(v.candidates, [], 'the branch has nothing of its own');
    assert.equal(v.state, 'working', v.detail);
    assert.deepEqual(o.handed, ['DC-1'], 'the queue doesn’t move');
    // Its first commit is the candidate.
    sh(p.dir, 'checkout', '-q', 'dev/DC-1');
    const c1 = p.commit('DC-1: due date');
    sh(p.dir, 'push', '-q', 'origin', 'dev/DC-1');
    await o.observe();
    assert.equal((await o.view('DC-1')).revision, c1);
    assert.equal((await o.view('DC-1')).state, 'candidate');
  } finally {
    removeDir(p.root);
  }
});

test('cancelling an active change in a local-only project frees the slot for the next one', async () => {
  const p = project();
  try {
    const o = office(p.dir, p.root);
    await o.ask('Show the loan’s due date on the overview');
    await o.ask('Add a filter for overdue loans');
    sh(p.dir, 'checkout', '-q', '-b', 'dev/DC-1');
    p.commit('DC-1: half done');
    sh(p.dir, 'push', '-q', 'origin', 'dev/DC-1');
    await o.observe();
    assert.equal((await o.view('DC-1')).mayCancel, true);
    const r = await o.svc.cancel(FLOOR, 'DC-1', ALEX);
    assert.notEqual(typeof r, 'string', String(r));
    const v = await o.view('DC-1');
    assert.equal(v.state, 'cancelled');
    assert.match(v.detail, /while the team had it/);
    assert.deepEqual(o.handed, ['DC-1', 'DC-2'], 'the next change started');
  } finally {
    removeDir(p.root);
  }
});

test('a correction (of: DC-1) queued behind DC-1 starts once DC-1 is implemented, or once it is cancelled', async () => {
  for (const how of ['implemented', 'cancelled'] as const) {
    const p = project();
    try {
      const o = office(p.dir, p.root);
      await o.ask('Show the loan’s due date on the overview');
      sh(p.dir, 'checkout', '-q', '-b', 'dev/DC-1');
      p.commit('DC-1: due date');
      sh(p.dir, 'push', '-q', 'origin', 'dev/DC-1');
      await o.observe();
      const fix: DevChange = await o.ask('Something’s wrong: the date shows in the wrong format', { of: 'DC-1' });
      assert.equal(fix.of, 'DC-1');
      assert.equal((await o.view('DC-2')).state, 'queued', 'waits behind DC-1');
      assert.deepEqual(o.handed, ['DC-1']);
      if (how === 'implemented') {
        sh(p.dir, 'checkout', '-q', 'main');
        sh(p.dir, 'merge', '-q', '--ff-only', 'dev/DC-1');
        sh(p.dir, 'push', '-q', 'origin', 'main');
        await o.observe();
        assert.equal((await o.view('DC-1')).state, 'implemented');
      } else {
        const r = await o.svc.cancel(FLOOR, 'DC-1', ALEX);
        assert.notEqual(typeof r, 'string', String(r));
      }
      assert.deepEqual(o.handed, ['DC-1', 'DC-2'], `the correction started after DC-1 was ${how}`);
      assert.equal((await o.view('DC-2')).state, 'working');
    } finally {
      removeDir(p.root);
    }
  }
});
