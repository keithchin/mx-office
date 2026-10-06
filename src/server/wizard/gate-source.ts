// Where the setup panel reads a toolkit project's gates from: its default branch on GitHub
// (origin/<default>), not whatever branch the floor's folder happens to be on. A floor folder left on
// an old branch showed Stage 0 failing long after main had it signed off (travel-approval, release 5).
// So: the default branch from origin/HEAD (else main, else master), a quiet fetch of it every minute
// and a half at most, PROJECT.md, intake.md, triage.md and index.html read with `git show`, and, since
// the committed index.html is often stale (nothing renders it again after a merge), gate-check run
// afresh whenever origin/<default> moves, in a temporary detached worktree that's removed afterwards
// (at most once every few minutes per floor, one at a time, time-limited). The floor's own folder is
// never written to. With no remote, the panel reads the folder as before (setup.ts).

import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const ENV = { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0' };

function git(args: string[], cwd: string, timeout = 20_000): Promise<string | undefined> {
  return new Promise((resolve) => {
    execFile('git', args, { cwd, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, timeout, env: ENV, windowsHide: true }, (err, out) => resolve(err ? undefined : out));
  });
}

/** The files the setup panel reads. */
export const GATE_FILES = ['PROJECT.md', 'intake.md', 'triage.md', 'index.html'] as const;

/** The project's default branch on origin (main, say), or undefined with no remote. */
export async function defaultBranch(dir: string): Promise<string | undefined> {
  const head = (await git(['symbolic-ref', '-q', 'refs/remotes/origin/HEAD'], dir))?.trim();
  if (head?.startsWith('refs/remotes/origin/')) return head.slice('refs/remotes/origin/'.length);
  for (const b of ['main', 'master']) if ((await git(['rev-parse', '--verify', '-q', `refs/remotes/origin/${b}`], dir)) !== undefined) return b;
  return undefined;
}

export interface BranchInfo {
  /** The default branch (main) and the commit origin/<default> is at. */
  def: string;
  sha: string;
  /** The branch the floor's folder is on ("HEAD" when detached). */
  branch: string;
  /** How many of origin/<default>'s commits the folder's HEAD hasn't got. */
  behind: number;
}

/** Where the folder stands against origin/<default>; undefined when there's no remote default branch. */
export async function branchInfo(dir: string): Promise<BranchInfo | undefined> {
  const def = await defaultBranch(dir);
  if (!def) return undefined;
  const [sha, branch, behind] = await Promise.all([git(['rev-parse', '-q', '--verify', `refs/remotes/origin/${def}^{commit}`], dir), git(['rev-parse', '--abbrev-ref', 'HEAD'], dir), git(['rev-list', '--count', `HEAD..refs/remotes/origin/${def}`], dir)]);
  if (!sha) return undefined;
  return { def, sha: sha.trim(), branch: branch?.trim() || 'HEAD', behind: Number(behind?.trim()) || 0 };
}

/** A file at a commit, or undefined when it isn't there. */
export const showAt = (dir: string, sha: string, file: string) => git(['show', `${sha}:${file}`], dir);

export interface GateFiles {
  /** Each of GATE_FILES as text, when it's there. */
  files: Partial<Record<(typeof GATE_FILES)[number], string>>;
  info: BranchInfo;
  /** gate-check is running on origin/<default> now. */
  regenerating: boolean;
  /** When the index.html read was rendered by the office from origin/<default> (else it's the committed one). */
  renderedAt?: number;
}

/** Runs the toolkit's gate-check over `worktree` (a temporary checkout of origin/<default>), for the floor at `floorDir`. */
export type GateRunner = (worktree: string, floorDir: string) => Promise<void>;

export interface GateSourceOptions {
  /** At most one gate-check per floor this often, unless asked (🔄 Re-check). */
  throttleMs: number;
  /** A fetch of origin/<default> at most this often. */
  fetchMs: number;
  /** A gate-check that takes longer is given up on. */
  timeoutMs: number;
  /** Fetch at all (the tests' repos have a local origin and don't need it). */
  fetch: boolean;
}

const DEFAULTS: GateSourceOptions = { throttleMs: 3 * 60_000, fetchMs: 90_000, timeoutMs: 5 * 60_000, fetch: true };

const fetchedAt = new Map<string, number>();
const fetching = new Map<string, Promise<void>>();

/**
 * A quiet fetch of origin/<default> into `dir`, at most every `everyMs` per folder, shared by everything
 * that reads the default branch (the setup panel here, the 📦 Deliverables scan); resolves when it's done,
 * or at once when it isn't due.
 */
export function fetchDefault(dir: string, def: string, everyMs = DEFAULTS.fetchMs, now = Date.now()): Promise<void> {
  const going = fetching.get(dir);
  if (going) return going;
  if (now - (fetchedAt.get(dir) ?? -Infinity) < everyMs) return Promise.resolve();
  const p = git(['fetch', '--quiet', '--no-tags', 'origin', `+refs/heads/${def}:refs/remotes/origin/${def}`], dir, 60_000).then(() => {
    fetchedAt.set(dir, Date.now());
    fetching.delete(dir);
  });
  fetching.set(dir, p);
  return p;
}

export class GateSource {
  private opts: GateSourceOptions;
  private files = new Map<string, { sha: string; files: GateFiles['files'] }>();
  private rendered = new Map<string, { sha: string; html?: string; at: number }>();
  private running = new Map<string, Promise<void>>();
  private lastRun = new Map<string, number>();

  constructor(
    private run: GateRunner,
    opts: Partial<GateSourceOptions> = {},
    private now: () => number = Date.now,
  ) {
    this.opts = { ...DEFAULTS, ...opts };
  }

  /** A quiet fetch of origin/<default>, at most every fetchMs; resolves when it's done (or at once when it isn't due). */
  fetch(dir: string, def: string): Promise<void> {
    return this.opts.fetch ? fetchDefault(dir, def, this.opts.fetchMs) : Promise.resolve();
  }

  /**
   * The gate files from origin/<default>, with index.html as the office last rendered it there when it
   * has, and a gate-check started when origin/<default> moved since. Undefined with no remote.
   */
  async read(dir: string): Promise<GateFiles | undefined> {
    const info = await branchInfo(dir);
    if (!info) return undefined;
    // Not waited for: the next look sees what it brought.
    void this.fetch(dir, info.def).then(() => undefined);
    let cached = this.files.get(dir);
    if (cached?.sha !== info.sha) {
      const entries = await Promise.all(GATE_FILES.map(async (f) => [f, await showAt(dir, info.sha, f)] as const));
      cached = { sha: info.sha, files: Object.fromEntries(entries.filter(([, t]) => t !== undefined)) };
      this.files.set(dir, cached);
    }
    const r = this.rendered.get(dir);
    if (r?.sha !== info.sha && /^##\s*Decisions/m.test(cached.files['PROJECT.md'] ?? '')) void this.regenerate(dir, info);
    const files = { ...cached.files };
    const fresh = r?.sha === info.sha && r.html !== undefined;
    if (fresh) files['index.html'] = r!.html;
    return { files, info, regenerating: this.running.has(dir), ...(fresh ? { renderedAt: r!.at } : {}) };
  }

  /** Whether a gate-check is running for the floor at `dir`. */
  busy(dir: string): boolean {
    return this.running.has(dir);
  }

  /**
   * Runs gate-check on origin/<default> in a temporary worktree and keeps its index.html. Skipped while
   * one runs (that one is handed back) or, unless `force`, within throttleMs of the last.
   */
  regenerate(dir: string, info: BranchInfo, force = false): Promise<void> | undefined {
    const going = this.running.get(dir);
    if (going) return going;
    if (!force && this.now() - (this.lastRun.get(dir) ?? -Infinity) < this.opts.throttleMs) return undefined;
    this.lastRun.set(dir, this.now());
    const p = this.inWorktree(dir, info.sha, async (tmp) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const late = new Promise<never>((_, reject) => (timer = setTimeout(() => reject(new Error('gate-check took too long')), this.opts.timeoutMs)));
      try {
        await Promise.race([this.run(tmp, dir), late]);
      } finally {
        clearTimeout(timer);
      }
      const html = await readFile(path.join(tmp, 'index.html'), 'utf8').catch(() => undefined);
      this.rendered.set(dir, { sha: info.sha, html, at: this.now() });
    })
      .catch((err: Error) => {
        // Remembered as tried, so it isn't run again until origin/<default> moves (or someone asks).
        if (this.rendered.get(dir)?.sha !== info.sha) this.rendered.set(dir, { sha: info.sha, at: this.now() });
        console.warn(`agent-office: gate-check on origin/${info.def} of ${dir} failed: ${err.message}`);
      })
      .finally(() => this.running.delete(dir));
    this.running.set(dir, p);
    return p;
  }

  /** `go` in a detached worktree of `sha` made under the system's temp folder, removed afterwards whatever happens. */
  private async inWorktree(dir: string, sha: string, go: (tmp: string) => Promise<void>): Promise<void> {
    const tmp = await mkdtemp(path.join(os.tmpdir(), 'ao-gates-'));
    try {
      if ((await git(['worktree', 'add', '--detach', '--force', tmp, sha], dir, 120_000)) === undefined) throw new Error(`couldn't make a worktree of ${sha.slice(0, 8)}`);
      await go(tmp);
    } finally {
      await git(['worktree', 'remove', '--force', '--force', tmp], dir, 60_000);
      await rm(tmp, { recursive: true, force: true }).catch(() => undefined);
      await git(['worktree', 'prune'], dir);
    }
  }
}
