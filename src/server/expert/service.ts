// Expert mode's background proof, per project: the session branch taken on attach, an auto-commit a little after
// the session goes idle following a change its hooks reported, and the branch pushed in the background (retried
// with back-off, the error kept for the strip, never a modal). Local git runs one operation at a time per
// repository (git.ts serial); one push at a time per project. Nothing here blocks the server loop: git runs off it.
// The office never types into the session: everything here reads the folder and git.

import type { WorkerInfo } from '../../shared/protocol.js';
import { SESSION_BRANCH, type ProofCommit } from '../../shared/expert-proof.js';
import { autoCommit, type CommitOutcome } from './commit.js';
import { serial, type ProofGit } from './git.js';
import { pushError, type TargetAnswer, type PushTarget } from './push.js';
import { ensureSessionBranch, headOf } from './session.js';

/** The commit waits this long after the session goes idle (a new turn meanwhile cancels it). */
export const IDLE_DEBOUNCE_MS = 4_000;
/** git held the repository (a lock, a merge): looked at again after this, a few times. */
export const HELD_RETRY_MS = 5_000;
const HELD_RETRIES = 12;
/** A failed push is tried again after these (the last repeats). */
export const PUSH_BACKOFF_MS = [30_000, 60_000, 2 * 60_000, 5 * 60_000, 10 * 60_000, 30 * 60_000];

export interface ProofDeps {
  git: ProofGit;
  /** Where the project's session branch goes (push.ts pushTarget). */
  target(floorId: string, dir: string): Promise<TargetAnswer>;
  /** Pushes the branch (push.ts pushBranch); rejects on failure. */
  push(dir: string, t: PushTarget, branch: string): Promise<void>;
  /** Who commits when the repository has no committer of its own. */
  identity(): { name: string; email: string };
  now(): number;
  /** The project's proof changed (a commit, a push): pages look again. */
  changed(floorId: string): void;
  debounceMs?: number;
  heldRetryMs?: number;
  backoffMs?: readonly number[];
}

interface FloorProof {
  id: string;
  dir: string;
  branch: string;
  /** Why the folder isn't on the session branch, while it isn't. */
  branchNote?: string;
  /** HEAD at the last look: a different HEAD now means someone else committed. */
  seen?: string;
  /** A change was reported since the last commit look. */
  touched: boolean;
  working: boolean;
  idleSince: number;
  commit: ProofCommit | null;
  /** The newest sha the remote is known to have. */
  pushed?: string;
  pushing: boolean;
  pushAgain: boolean;
  pushFails: number;
  timer?: NodeJS.Timeout;
  pushTimer?: NodeJS.Timeout;
  heldTries: number;
  /** Auto-commits that failed in a row. */
  commitFails: number;
  attached?: Promise<void>;
}

const IDLE = new Set(['idle', 'done', 'exited', 'offline']);

export class ExpertProofService {
  private floors = new Map<string, FloorProof>();
  private stopped = false;

  constructor(readonly deps: ProofDeps) {}

  private stateOf(id: string, dir: string): FloorProof {
    let s = this.floors.get(id);
    if (!s || s.dir !== dir) {
      if (s) this.clear(s);
      s = { id, dir, branch: '', touched: false, working: false, idleSince: this.deps.now(), commit: null, pushing: false, pushAgain: false, pushFails: 0, heldTries: 0, commitFails: 0 };
      this.floors.set(id, s);
    }
    return s;
  }

  private clear(s: FloorProof) {
    clearTimeout(s.timer);
    clearTimeout(s.pushTimer);
    s.timer = s.pushTimer = undefined;
  }

  /** The session attached or started: the session branch taken (or why not), HEAD noted, the branch pushed. Once per project unless `again`. */
  attach(id: string, dir: string, again = false): Promise<void> {
    const s = this.stateOf(id, dir);
    if (s.attached && !again) return s.attached;
    s.attached = serial(dir, async () => {
      await this.takeBranch(s);
      s.seen = await headOf(this.deps.git, dir);
      await this.readHead(s);
    }).then(
      () => this.afterHead(s),
      (err: Error) => console.error(`agent-office: expert proof couldn't attach ${id}: ${err.message}`),
    );
    return s.attached;
  }

  private async takeBranch(s: FloorProof) {
    const r = await ensureSessionBranch(this.deps.git, s.dir);
    s.branch = r.branch;
    if (r.ok) delete s.branchNote;
    else s.branchNote = r.why;
  }

  /** A worker's update on an Expert project: the session's turns (agents in the project folder itself). */
  onWorker(id: string, dir: string, w: WorkerInfo) {
    if (this.stopped || w.kind !== 'agent' || w.worktree) return;
    const s = this.stateOf(id, dir);
    void this.attach(id, dir);
    if (w.status === 'working' || w.status === 'starting') {
      if (!s.working) s.working = true;
      // A tool that may write (an edit, a script, a build): only reading or the web isn't a change.
      if (w.status === 'working' && w.action !== 'read' && w.action !== 'web') s.touched = true;
      clearTimeout(s.timer);
      s.timer = undefined;
      return;
    }
    if (!IDLE.has(w.status)) return;
    if (s.working) {
      s.working = false;
      s.idleSince = this.deps.now();
    }
    if (s.touched) this.soon(s);
  }

  /** Something else reported a model or code change (a toolkit script, the session screen). */
  noteChange(id: string, dir: string) {
    const s = this.stateOf(id, dir);
    s.touched = true;
    if (!s.working) this.soon(s);
  }

  private soon(s: FloorProof, ms = this.deps.debounceMs ?? IDLE_DEBOUNCE_MS) {
    if (this.stopped) return;
    clearTimeout(s.timer);
    s.timer = setTimeout(() => {
      s.timer = undefined;
      void this.check(s.id);
    }, ms);
    s.timer.unref?.();
  }

  /** One commit look now (the debounce's, or a test's). */
  async check(id: string): Promise<CommitOutcome | undefined> {
    const s = this.floors.get(id);
    if (!s || this.stopped) return undefined;
    await this.attach(s.id, s.dir);
    if (s.working) return undefined;
    s.touched = false;
    const out = await serial(s.dir, async () => {
      if (s.branch !== SESSION_BRANCH) await this.takeBranch(s);
      const r = await autoCommit(this.deps.git, s.dir, s.seen, this.deps.identity);
      if (r.kind === 'committed') s.seen = r.sha;
      else if (r.kind === 'moved' || r.kind === 'clean') s.seen = r.head;
      else if (r.kind === 'off-branch') s.branch = r.branch;
      await this.readHead(s);
      return r;
    });
    if (out.kind === 'busy' && s.heldTries < HELD_RETRIES) {
      s.heldTries++;
      s.touched = true;
      this.soon(s, this.deps.heldRetryMs ?? HELD_RETRY_MS);
    } else s.heldTries = 0;
    // A commit that didn't go (a hook, signing): kept for the strip and tried again later, with the push's back-off.
    if (out.kind === 'error') {
      if (s.commit) s.commit = { ...s.commit, error: out.error };
      s.commitFails++;
      const backoff = this.deps.backoffMs ?? PUSH_BACKOFF_MS;
      s.touched = true;
      this.soon(s, backoff[Math.min(s.commitFails - 1, backoff.length - 1)]);
    } else if (out.kind === 'committed') {
      s.commitFails = 0;
      if (s.commit?.error && s.commit.push !== 'failed' && s.commit.push !== 'off') {
        const { error: _e, ...rest } = s.commit;
        s.commit = rest;
      }
    }
    this.afterHead(s);
    return out;
  }

  /**
   * Commits what's pending now, whatever HEAD did since the last look (Lock in: its checks must see everything):
   * the same commit path as the auto-commit (never an amend, the project's hooks apply), then pushed as usual.
   */
  async commitNow(id: string, dir: string): Promise<CommitOutcome> {
    const s = this.stateOf(id, dir);
    await this.attach(id, dir);
    clearTimeout(s.timer);
    s.timer = undefined;
    s.touched = false;
    const out = await serial(dir, async () => {
      if (s.branch !== SESSION_BRANCH) await this.takeBranch(s);
      const r = await autoCommit(this.deps.git, dir, undefined, this.deps.identity);
      if (r.kind === 'committed') s.seen = r.sha;
      else if (r.kind === 'moved' || r.kind === 'clean') s.seen = r.head;
      await this.readHead(s);
      return r;
    });
    this.afterHead(s);
    return out;
  }

  /** The session branch's newest commit into s.commit (its push state kept when it's the same commit). */
  private async readHead(s: FloorProof) {
    const info = await this.headInfo(s.dir);
    if (!info) s.commit = null;
    // Not on the session branch: nothing is committed or pushed, and the strip says why.
    else if (s.branch !== SESSION_BRANCH) s.commit = { ...info, push: 'off', error: s.branchNote ?? `Not on ${SESSION_BRANCH}` };
    else if (s.commit?.sha !== info.sha || s.commit.push === 'off') s.commit = { ...info, push: s.pushed === info.sha ? 'ok' : 'pending' };
  }

  private async headInfo(dir: string): Promise<{ sha: string; message: string; at: number } | undefined> {
    const out = await this.deps.git(['log', '-1', '--format=%H%x00%s%x00%ct', 'HEAD'], dir).catch(() => '');
    const [sha, message, ct] = out.trim().split('\0');
    return sha ? { sha, message: (message ?? '').slice(0, 200), at: (Number(ct) || 0) * 1000 } : undefined;
  }

  private afterHead(s: FloorProof) {
    this.deps.changed(s.id);
    if (s.commit && s.branch === SESSION_BRANCH && s.commit.sha !== s.pushed) void this.pushNow(s.id);
  }

  /** Pushes the session branch now, unless a push is under way (then once more after it). */
  async pushNow(id: string): Promise<void> {
    const s = this.floors.get(id);
    if (!s || this.stopped) return;
    if (s.pushing) {
      s.pushAgain = true;
      return;
    }
    s.pushing = true;
    clearTimeout(s.pushTimer);
    s.pushTimer = undefined;
    try {
      do {
        s.pushAgain = false;
        const sha = s.commit?.sha;
        if (!sha || s.branch !== SESSION_BRANCH) return;
        const t = await serial(s.dir, () => this.deps.target(s.id, s.dir));
        if ('off' in t) {
          if (s.commit) s.commit = { ...s.commit, push: 'off', error: t.off };
          this.deps.changed(s.id);
          return;
        }
        try {
          await this.deps.push(s.dir, t, SESSION_BRANCH);
          s.pushed = sha;
          s.pushFails = 0;
          if (s.commit?.sha === sha) {
            const { error: _e, ...rest } = s.commit;
            s.commit = { ...rest, push: 'ok' };
          } else s.pushAgain = true;
        } catch (err) {
          s.pushFails++;
          if (s.commit) s.commit = { ...s.commit, push: 'failed', error: pushError(err) };
          const backoff = this.deps.backoffMs ?? PUSH_BACKOFF_MS;
          const wait = backoff[Math.min(s.pushFails - 1, backoff.length - 1)];
          if (!this.stopped) {
            s.pushTimer = setTimeout(() => void this.pushNow(s.id), wait);
            s.pushTimer.unref?.();
          }
          s.pushAgain = false;
        }
        this.deps.changed(s.id);
      } while (s.pushAgain && !this.stopped);
    } finally {
      s.pushing = false;
    }
  }

  /** What the strip shows of the branch and the commit; undefined before the project's first look. */
  proof(id: string): { branch: string; commit: ProofCommit | null; working: boolean; idleSince: number } | undefined {
    const s = this.floors.get(id);
    return s && { branch: s.branch, commit: s.commit, working: s.working, idleSince: s.idleSince };
  }

  /** Lets go of a project (deleted). */
  forget(id: string) {
    const s = this.floors.get(id);
    if (s) this.clear(s);
    this.floors.delete(id);
  }

  stop() {
    this.stopped = true;
    for (const s of this.floors.values()) this.clear(s);
  }
}
