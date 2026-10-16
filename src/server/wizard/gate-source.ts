// Where the office reads a toolkit project's gates from: its default branch on GitHub (origin/<default>),
// not whatever branch the floor's folder happens to be on. A floor folder left on an old branch showed
// Stage 0 failing long after main had it signed off (travel-approval, release 5). So: the default branch
// from origin/HEAD (else main, else master), a quiet fetch of it every minute and a half at most,
// PROJECT.md, intake.md, triage.md and index.html read with `git show`, and gate-check run by the office
// itself whenever origin/<default> moves, in a temporary detached worktree that's removed afterwards.
//
// The committed index.html and PROJECT.md's "Current stage" line are readouts nobody re-renders after a
// merge: a migration project's said Stage 2 while main had Stage 4 signed off (release 56). So the verdicts the
// office shows are its own gate-check's, kept per commit, with when it ran; a run that fails is said
// (the last good one kept and marked stale with its time), never swapped silently for the committed
// dashboard. The temporary checkout's index.html is removed before the run, so a gate-check that dies
// before writing its dashboard can't pass the committed one off as fresh. Runs start when origin/<default>
// moves (the fetches' originNews) or when someone reads the gates; at most one per floor at a time, at
// most once every few minutes per floor (longer after a failure), a few at once across the office,
// time-limited, off the event loop. The floor's own folder is never written to, nothing is committed.
// With no remote, the panel reads the folder as before (setup.ts).

import { execFileOff } from '../offloop/exec.js';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { signal } from '../incidents/signals.js';
import { onOriginNews, originNews } from '../floor-sync/bus.js';
import { stageVerdicts } from '../summary/project.js';
import { verdictsFromOutput, type StageCheck, type VerdictRow } from '../../shared/stage-derive.js';

const ENV = { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0' };

function git(args: string[], cwd: string, timeout = 20_000): Promise<string | undefined> {
  return new Promise((resolve) => {
    execFileOff('git', args, { cwd, maxBuffer: 8 * 1024 * 1024, timeout, env: ENV, windowsHide: true }, (err, out) => resolve(err ? undefined : out));
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
  /** Each of GATE_FILES as text, when it's there (index.html: the office's own check's, when it has one). */
  files: Partial<Record<(typeof GATE_FILES)[number], string>>;
  info: BranchInfo;
  /** gate-check is running on origin/<default> now. */
  regenerating: boolean;
  /** When the index.html read was rendered by the office from origin/<default>'s head (else it's older or committed). */
  renderedAt?: number;
  /** Where the verdicts came from and how fresh they are (shared/stage-derive.ts). */
  check: StageCheck;
}

/** Runs the toolkit's gate-check over `worktree` (a temporary checkout of origin/<default>), for the floor at `floorDir`; resolves with what it printed. */
export type GateRunner = (worktree: string, floorDir: string) => Promise<string | void>;

export interface GateSourceOptions {
  /** At most one gate-check per floor this often, unless asked (🔄 Re-check). */
  throttleMs: number;
  /** After a failed run, not again for this long (unless origin moves or someone asks). */
  failMs: number;
  /** A fetch of origin/<default> at most this often. */
  fetchMs: number;
  /** A gate-check that takes longer is given up on. */
  timeoutMs: number;
  /** Fetch at all (the tests' repos have a local origin and don't need it). */
  fetch: boolean;
  /** At most this many gate-checks at once across the office (each is a bash and a worktree). */
  concurrency: number;
}

const DEFAULTS: GateSourceOptions = { throttleMs: 3 * 60_000, failMs: 10 * 60_000, fetchMs: 90_000, timeoutMs: 5 * 60_000, fetch: true, concurrency: 2 };

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
  const p = git(['fetch', '--quiet', '--no-tags', 'origin', `+refs/heads/${def}:refs/remotes/origin/${def}`], dir, 60_000).then((out) => {
    fetchedAt.set(dir, Date.now());
    fetching.delete(dir);
    // The floor sync looks whether the folder can follow (floor-sync/); the gate source re-derives the stage.
    if (out !== undefined) originNews(dir);
  });
  fetching.set(dir, p);
  return p;
}

/** One gate-check the office ran on one commit. */
export interface GateRun {
  sha: string;
  at: number;
  /** The dashboard it wrote (absent when it printed its verdicts but wrote none). */
  html?: string;
  verdicts: VerdictRow[];
}

/** The office's gate-checks of a floor: the good ones by commit (the latest few), and the last failure. */
interface FloorRuns {
  good: GateRun[];
  failed?: { sha: string; at: number; error: string };
}

const KEEP_RUNS = 4;

/** A dashboard of `verdicts` in the shape stageVerdicts reads (for a run that printed its verdicts but wrote no index.html). */
export function dashboardOf(verdicts: readonly VerdictRow[]): string {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `<table>${verdicts.map((v) => `<tr><td>${esc(v.id)}</td><td>${esc(v.title ?? v.id)}</td><td>${esc(v.status)}</td><td>${esc(v.detail ?? '')}</td></tr>`).join('')}</table>`;
}

/** A queue of gate-check slots shared by every floor. */
class Slots {
  private active = 0;
  private waiting: (() => void)[] = [];
  constructor(private max: () => number) {}
  async run<T>(go: () => Promise<T>): Promise<T> {
    if (this.active >= this.max()) await new Promise<void>((r) => this.waiting.push(r));
    this.active++;
    try {
      return await go();
    } finally {
      this.active--;
      this.waiting.shift()?.();
    }
  }
}

export class GateSource {
  private opts: GateSourceOptions;
  private files = new Map<string, { sha: string; files: GateFiles['files'] }>();
  private checkedFiles = new Map<string, { sha: string; files: GateFiles['files'] }>();
  private runs = new Map<string, FloorRuns>();
  private running = new Map<string, Promise<void>>();
  private lastRun = new Map<string, number>();
  private looking = new Set<string>();
  private slots: Slots;
  /** Stops hearing originNews (tests). */
  readonly stop: () => void;

  constructor(
    private run: GateRunner,
    opts: Partial<GateSourceOptions> = {},
    private now: () => number = Date.now,
  ) {
    this.opts = { ...DEFAULTS, ...opts };
    this.slots = new Slots(() => Math.max(1, this.opts.concurrency));
    // Main moved (a fetch brought something): re-derive, for the floors whose gates were read before.
    this.stop = onOriginNews((dir, news) => {
      if (news !== 'fetched' || !this.files.has(dir) || this.looking.has(dir)) return;
      this.looking.add(dir);
      void this.read(dir, false)
        .catch(() => undefined)
        .finally(() => this.looking.delete(dir));
    });
  }

  /** A quiet fetch of origin/<default>, at most every fetchMs; resolves when it's done (or at once when it isn't due). */
  fetch(dir: string, def: string): Promise<void> {
    return this.opts.fetch ? fetchDefault(dir, def, this.opts.fetchMs) : Promise.resolve();
  }

  /**
   * The gate files from origin/<default>, with index.html from the office's own latest good check (marked
   * stale when that was of an older commit) and a gate-check started when origin/<default>'s head hasn't
   * been checked yet. Undefined with no remote.
   */
  async read(dir: string, fetch = true): Promise<GateFiles | undefined> {
    const info = await branchInfo(dir);
    if (!info) return undefined;
    // Not waited for: the next look sees what it brought.
    if (fetch) void this.fetch(dir, info.def).then(() => undefined);
    const cached = await this.filesAt(dir, info.sha, this.files);
    const toolkit = /^##\s*Decisions/m.test(cached['PROJECT.md'] ?? '');
    const r = this.runs.get(dir);
    const good = r?.good[0];
    if (toolkit && good?.sha !== info.sha) void this.regenerate(dir, info);
    // Stale: every file as of the commit that was checked, so what's shown is one commit's word, not a mix.
    const files = { ...(good && good.sha !== info.sha ? await this.filesAt(dir, good.sha, this.checkedFiles) : cached) };
    const failed = r?.failed && r.failed.at >= (good?.at ?? -Infinity) ? r.failed : undefined;
    const base: StageCheck = { source: 'committed', branch: info.def, sha: info.sha, running: this.running.has(dir), ...(failed ? { error: failed.error, errorAt: failed.at } : {}) };
    if (!good) return { files, info, regenerating: this.running.has(dir), check: base };
    files['index.html'] = good.html ?? dashboardOf(good.verdicts);
    const fresh = good.sha === info.sha;
    const check: StageCheck = { ...base, source: 'office', sha: good.sha, at: good.at, ...(fresh ? {} : { stale: true, head: info.sha }) };
    return { files, info, regenerating: this.running.has(dir), ...(fresh ? { renderedAt: good.at } : {}), check };
  }

  /** The gate files at `sha`, read once per commit into `cache` (one commit per floor). */
  private async filesAt(dir: string, sha: string, cache: Map<string, { sha: string; files: GateFiles['files'] }>): Promise<GateFiles['files']> {
    const hit = cache.get(dir);
    if (hit?.sha === sha) return hit.files;
    const entries = await Promise.all(GATE_FILES.map(async (f) => [f, await showAt(dir, sha, f)] as const));
    const files: GateFiles['files'] = Object.fromEntries(entries.filter(([, t]) => t !== undefined));
    cache.set(dir, { sha, files });
    return files;
  }

  /** index.html as gate-check rendered it from exactly `sha` (not committed anywhere), when the office has checked that commit. */
  renderedAt(dir: string, sha: string): { html: string; at: number } | undefined {
    const g = this.runs.get(dir)?.good.find((x) => x.sha === sha);
    return g ? { html: g.html ?? dashboardOf(g.verdicts), at: g.at } : undefined;
  }

  /** Whether a gate-check is running (or queued) for the floor at `dir`. */
  busy(dir: string): boolean {
    return this.running.has(dir);
  }

  /**
   * Runs gate-check on origin/<default> in a temporary worktree and keeps its verdicts for that commit.
   * Skipped while one runs (that one is handed back) or, unless `force`, within throttleMs of the last
   * (failMs after a failure of the same commit).
   */
  regenerate(dir: string, info: BranchInfo, force = false): Promise<void> | undefined {
    const going = this.running.get(dir);
    if (going) return going;
    const failedHere = this.runs.get(dir)?.failed?.sha === info.sha;
    const wait = failedHere ? Math.max(this.opts.failMs, this.opts.throttleMs) : this.opts.throttleMs;
    if (!force && this.now() - (this.lastRun.get(dir) ?? -Infinity) < wait) return undefined;
    this.lastRun.set(dir, this.now());
    const p = this.slots
      .run(() => this.inWorktree(dir, info.sha, (tmp) => this.checkIn(tmp, dir, info.sha)))
      .catch((err: Error) => {
        const runs = this.runsOf(dir);
        runs.failed = { sha: info.sha, at: this.now(), error: err.message };
        console.warn(`agent-office: gate-check on origin/${info.def} of ${dir} failed: ${err.message}`);
        signal({ kind: 'gate-check.failed', floorDir: dir, message: err.message });
      })
      .finally(() => this.running.delete(dir));
    this.running.set(dir, p);
    return p;
  }

  private runsOf(dir: string): FloorRuns {
    let r = this.runs.get(dir);
    if (!r) this.runs.set(dir, (r = { good: [] }));
    return r;
  }

  /** gate-check over the temporary checkout `tmp` of `sha`: its fresh dashboard, else the verdicts it printed; a run that gave neither failed. */
  private async checkIn(tmp: string, dir: string, sha: string): Promise<void> {
    // The checkout brought the committed dashboard: gone first, so only one gate-check writes now is read.
    await rm(path.join(tmp, 'index.html'), { force: true });
    let timer: ReturnType<typeof setTimeout> | undefined;
    const late = new Promise<never>((_, reject) => (timer = setTimeout(() => reject(new Error(`gate-check took longer than ${Math.round(this.opts.timeoutMs / 1000)} s`)), this.opts.timeoutMs)));
    let said: string | void;
    try {
      said = await Promise.race([this.run(tmp, dir), late]);
    } finally {
      clearTimeout(timer);
    }
    const html = await readFile(path.join(tmp, 'index.html'), 'utf8').catch(() => undefined);
    const fromHtml = html ? stageVerdicts(html).filter((v) => /^[P0-7]$/.test(v.id)) : [];
    const verdicts = fromHtml.length ? stageVerdicts(html!) : verdictsFromOutput(typeof said === 'string' ? said : '');
    if (!verdicts.some((v) => /^[P0-7]$/.test(v.id))) {
      const tail = typeof said === 'string' ? said.trim().split('\n').slice(-2).join(' ').slice(0, 200) : '';
      throw new Error(`gate-check gave no stage verdicts (no dashboard written, none in its output)${tail ? `: ${tail}` : ''}`);
    }
    const runs = this.runsOf(dir);
    runs.good = [{ sha, at: this.now(), ...(fromHtml.length ? { html } : {}), verdicts }, ...runs.good.filter((g) => g.sha !== sha)].slice(0, KEEP_RUNS);
    if (runs.failed?.sha === sha) runs.failed = undefined;
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
