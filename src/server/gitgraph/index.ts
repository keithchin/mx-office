// The Git tab's branch graph (GET /api/git, see shared/gitgraph.ts): asks the floor's checkout for its
// default branch, its history and every branch, and puts them together with the floor's workers and
// pull requests (parse.ts). origin is fetched at most once a minute per floor, never holding up the
// answer for long and never failing it. Each branch's counts are kept by commit, so a refresh only asks
// git about branches that moved.

import { execFileOff } from '../offloop/exec.js';
import type { GitBranch, GitGraph } from '../../shared/gitgraph.js';
import type { GhPull, WorkerInfo } from '../../shared/protocol.js';
import { defaultFromSymref, finish, LOG_FORMAT, mergeRefs, parseCounts, parseLog, parseRefs, pick, REF_FORMAT, type Candidate } from './parse.js';

/** origin is fetched at most this often per floor. */
export const FETCH_EVERY_MS = 60_000;
/** How long an answer waits on a fetch before going ahead with what's here. */
const FETCH_WAIT_MS = 4000;
const FETCH_TIMEOUT_MS = 30_000;
const GIT_TIMEOUT_MS = 15_000;
/** An answer this recent is given again rather than asking git. */
const FRESH_MS = 3000;
/** The default branch's commits the graph shows. */
const HISTORY = 30;
/** Branches asked about at once. */
const PARALLEL = 6;
const MEMO_MAX = 2000;

/** What the graph needs of a floor. */
export interface GraphFloor {
  id: string;
  dir: string;
  workers: { list(): WorkerInfo[] };
  github: { pulls: { items: GhPull[] } };
}

export type Git = (args: string[], cwd: string, timeout?: number) => Promise<string>;

/** Runs git with `args` (no shell) in `cwd`; a non-zero exit throws with git's message. */
export const runGit: Git = (args, cwd, timeout = GIT_TIMEOUT_MS) =>
  new Promise((resolve, reject) => {
    // Started off the event loop (offloop/exec.ts): the Git and Model tabs ask for the graph on every
    // look, and each git start on the main thread held it 10 to 350 ms on Windows.
    execFileOff('git', args, { cwd, maxBuffer: 16 * 1024 * 1024, timeout, windowsHide: true, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0' } }, (err, stdout, stderr) => {
      if (err) return reject(new Error(String(stderr || err.message).trim().split('\n').pop() || 'git failed'));
      resolve(stdout);
    });
  });

interface Fetched {
  at: number;
  error?: string;
  running?: Promise<void>;
}

export class GitGraphs {
  private fetched = new Map<string, Fetched>();
  private memo = new Map<string, { ahead: number; behind: number; fork?: string; commits?: number }>();
  private recent = new Map<string, { at: number; graph: Promise<GitGraph> }>();

  constructor(private git: Git = runGit) {}

  graph(floor: GraphFloor): Promise<GitGraph> {
    const r = this.recent.get(floor.id);
    if (r && Date.now() - r.at < FRESH_MS) return r.graph;
    const graph = this.build(floor);
    this.recent.set(floor.id, { at: Date.now(), graph });
    graph.catch(() => this.recent.delete(floor.id));
    return graph;
  }

  private async build(floor: GraphFloor): Promise<GitGraph> {
    const dir = floor.dir;
    await this.fetch(floor.id, dir);
    const defaultBranch = await this.defaultBranch(dir);
    const remote = await this.has(dir, `refs/remotes/origin/${defaultBranch}`);
    const defaultRef = remote ? `origin/${defaultBranch}` : defaultBranch;
    const [refs, merged, log] = await Promise.all([
      this.git(['for-each-ref', '--sort=-committerdate', `--format=${REF_FORMAT}`, 'refs/heads', 'refs/remotes/origin'], dir),
      this.git(['for-each-ref', `--merged=${defaultRef}`, '--format=%(refname)', 'refs/heads', 'refs/remotes/origin'], dir),
      this.git(['log', '--first-parent', `-n${HISTORY}`, `--format=${LOG_FORMAT}`, defaultRef, '--'], dir),
    ]);
    const history = parseLog(log);
    const head = history[0]?.sha ?? '';
    const { chosen, hidden } = pick({
      tips: mergeRefs(parseRefs(refs), defaultBranch),
      reachable: new Set(merged.split('\n').map((l) => l.trim()).filter(Boolean)),
      history,
      workers: floor.workers.list(),
      pulls: floor.github.pulls.items,
      now: Date.now(),
    });
    const branches = await pool(chosen, PARALLEL, (c) => this.branch(dir, head, defaultRef, c));
    const f = this.fetched.get(floor.id);
    return { floor: floor.id, defaultBranch, defaultRef, history, branches, hidden, fetchedAt: f?.at || undefined, fetchError: f?.error, at: Date.now() };
  }

  /** One branch's counts and fork point, kept by the commits they were worked out from. */
  private async branch(dir: string, head: string, defaultRef: string, c: Candidate): Promise<GitBranch> {
    const key = `${dir}|${head}|${c.sha}|${c.mergedBy ?? ''}`;
    let counts = this.memo.get(key);
    if (!counts) {
      try {
        const lr = parseCounts(await this.git(['rev-list', '--left-right', '--count', `${defaultRef}...${c.sha}`], dir));
        counts = { ...lr };
        if (c.reachable && c.mergedBy) {
          // On the default branch already: where it left is where it left the merge's first parent.
          const fork = (await this.git(['merge-base', `${c.mergedBy}^1`, c.sha], dir)).trim();
          counts.fork = fork || undefined;
          if (fork) counts.commits = Number.parseInt((await this.git(['rev-list', '--count', `${fork}..${c.sha}`], dir)).trim(), 10) || 0;
        } else {
          counts.fork = (await this.git(['merge-base', defaultRef, c.sha], dir)).trim() || undefined;
        }
      } catch {
        // Unrelated history or a ref gone mid-way: the branch without its counts.
        counts = { ahead: 0, behind: 0 };
      }
      if (this.memo.size > MEMO_MAX) this.memo.clear();
      this.memo.set(key, counts);
    }
    return finish(c, counts);
  }

  /** origin/HEAD's branch, else main or master if there is one, else whatever is checked out. */
  private async defaultBranch(dir: string): Promise<string> {
    const sym = await this.git(['symbolic-ref', '--quiet', 'refs/remotes/origin/HEAD'], dir).catch(() => '');
    const named = defaultFromSymref(sym);
    if (named) return named;
    for (const b of ['main', 'master']) if ((await this.has(dir, `refs/heads/${b}`)) || (await this.has(dir, `refs/remotes/origin/${b}`))) return b;
    return (await this.git(['rev-parse', '--abbrev-ref', 'HEAD'], dir).catch(() => 'main')).trim() || 'main';
  }

  private has(dir: string, ref: string): Promise<boolean> {
    return this.git(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], dir).then(
      () => true,
      () => false,
    );
  }

  /** Fetches origin if it's been a minute, waiting a few seconds at most; a failure is only noted. */
  private async fetch(floorId: string, dir: string): Promise<void> {
    let f = this.fetched.get(floorId);
    if (!f) this.fetched.set(floorId, (f = { at: 0 }));
    if (!f.running && Date.now() - f.at >= FETCH_EVERY_MS) {
      const mine = f;
      mine.at = Date.now();
      mine.running = this.git(['remote'], dir)
        .then((out) => (out.split('\n').some((l) => l.trim() === 'origin') ? this.git(['fetch', '--prune', '--quiet', 'origin'], dir, FETCH_TIMEOUT_MS) : ''))
        .then(
          () => void (mine.error = undefined),
          (err: Error) => void (mine.error = err.message),
        )
        .finally(() => {
          mine.at = Date.now();
          mine.running = undefined;
        });
    }
    if (f.running) await Promise.race([f.running, new Promise((r) => setTimeout(r, FETCH_WAIT_MS))]);
  }
}

/** `fn` over `items`, `n` at a time, in order. */
export async function pool<T, R>(items: readonly T[], n: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const lane = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, lane));
  return out;
}

const offices = new WeakMap<object, GitGraphs>();

/** The office's one GitGraphs (by its config, as summaryOf does). */
export function gitGraphsOf(ctx: { cfg: object }): GitGraphs {
  let g = offices.get(ctx.cfg);
  if (!g) offices.set(ctx.cfg, (g = new GitGraphs()));
  return g;
}
