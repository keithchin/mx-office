// The office's toolkit service: each floor's Toolkit line (which commit it's pinned to or seems to be on,
// what the fork has that's newer and what kind of change it is, the fork against Maurits' upstream), the
// fork fetched off the event loop at most every six hours or when someone asks, never on a page load,
// and the Update toolkit previews and updates (jobs.ts). One per office (office.ts makes it).

import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { kindsSummary, type ToolkitStatus } from '../../shared/toolkit.js';
import { defaultBranch } from '../wizard/gate-source.js';
import { detect } from './detect.js';
import { git, gitRun, remoteDefault, revParse } from './git.js';
import { useBook } from './index.js';
import { commitInfo, commitsIn, countIn, ensurePin, isRepo, latestCommit, pinDir, pinEdits } from './pins.js';
import { folderRecord, PinBook, previousOf, PROJECT_FILE, recordOf, type BookEntry } from './record.js';

/** The fork is fetched at most this often by the clock; 🔄 Check now asks sooner. */
export const FETCH_EVERY_MS = 6 * 60 * 60_000;
/** One Check now a minute at most. */
const FETCH_ASK_MS = 60_000;
/** A floor's status is worked out again after this (or at once after a fetch or an update). */
const STATUS_TTL_MS = 30_000;
const LIST_MAX = 30;

export interface PinFloor {
  id: string;
  dir: string;
  name: string;
}

export interface ServiceOptions {
  /** The office's shared toolkit clone (looked up each time: 🔌 Connections › Paths can change it). */
  root(): string;
  /** <data>/toolkit-pins.json; none in tests that don't want one. */
  bookFile?: string;
  now?: () => number;
}

export class ToolkitService {
  readonly book: PinBook;
  private now: () => number;
  private cache = new Map<string, { at: number; view: Promise<ToolkitStatus> }>();
  private fetching?: Promise<void>;
  private askedAt = 0;

  constructor(readonly opts: ServiceOptions) {
    this.book = new PinBook(opts.bookFile);
    this.now = opts.now ?? Date.now;
    useBook(this.book);
  }

  get root() {
    return this.opts.root();
  }

  /** Forgets a floor's status (all floors' when none is named). */
  invalidate(floor?: string) {
    if (floor) this.cache.delete(floor);
    else this.cache.clear();
  }

  get isFetching() {
    return !!this.fetching;
  }

  /**
   * Fetches the fork (origin, and upstream when the clone has that remote; nothing is ever pushed or added),
   * when the last fetch is older than FETCH_EVERY_MS, or `asked` and the last ask was over a minute ago.
   */
  fetch(asked = false): Promise<void> {
    if (this.fetching) return this.fetching;
    const since = this.now() - (this.book.fetchedAt ?? 0);
    if (asked ? this.now() - this.askedAt < FETCH_ASK_MS : since < FETCH_EVERY_MS) return Promise.resolve();
    if (asked) this.askedAt = this.now();
    const root = this.root;
    this.fetching = (async () => {
      if (!(await isRepo(root))) return;
      const remotes = (await git(['remote'], root))?.split('\n').map((r) => r.trim()) ?? [];
      for (const r of ['origin', 'upstream'].filter((x) => remotes.includes(x))) {
        const res = await gitRun(['-c', 'http.lowSpeedLimit=1000', '-c', 'http.lowSpeedTime=15', 'fetch', '--quiet', '--no-tags', '--prune', r], root, 120_000);
        if (!res.ok) console.warn(`agent-office: fetching the toolkit's ${r} failed: ${res.err.slice(0, 200)}`);
      }
      this.book.fetchedAt = this.now();
    })()
      .catch(() => undefined)
      .finally(() => {
        this.fetching = undefined;
        this.invalidate();
      });
    return this.fetching;
  }

  /** The newest toolkit commit for a new project or an update (pins.ts latestCommit). */
  latest(root = this.root) {
    return latestCommit(root);
  }

  /** The floor's pin: the office's book, else the record committed on its default branch, else in its folder (then remembered in the book). */
  async pinOf(floor: PinFloor): Promise<BookEntry | undefined> {
    const had = this.book.get(floor.id);
    if (had) return had;
    const def = await defaultBranch(floor.dir).catch(() => undefined);
    const committed = def ? recordOf(await git(['show', `refs/remotes/origin/${def}:${PROJECT_FILE}`], floor.dir)) : undefined;
    const rec = committed ?? folderRecord(floor.dir);
    if (!rec) return undefined;
    const e: BookEntry = { commit: rec.commit, floorDir: floor.dir, at: this.now(), previous: previousOf(rec) };
    this.book.set(floor.id, e);
    return e;
  }

  /** Records a floor's pin in the book (an update, a rollback, a new project). */
  setPin(floor: PinFloor, commit: string, previous?: string) {
    this.book.set(floor.id, { commit, floorDir: floor.dir, at: this.now(), previous });
    this.invalidate(floor.id);
  }

  /** The floor's Toolkit line; shared for STATUS_TTL_MS, worked out off the event loop. */
  status(floor: PinFloor): Promise<ToolkitStatus> {
    const hit = this.cache.get(floor.id);
    if (hit && this.now() - hit.at < STATUS_TTL_MS) return hit.view;
    const view = this.compute(floor);
    this.cache.set(floor.id, { at: this.now(), view });
    view.catch(() => this.cache.get(floor.id)?.view === view && this.cache.delete(floor.id));
    return view;
  }

  private async compute(floor: PinFloor): Promise<ToolkitStatus> {
    const root = this.root;
    const base: ToolkitStatus = { floor: floor.id, git: false, state: 'unknown', source: 'none', runsFrom: root, newer: { count: 0, commits: [], summary: '' }, fetchedAt: this.book.fetchedAt, fetching: this.isFetching, problems: [] };
    if (!(await isRepo(root))) return { ...base, problems: [`The toolkit folder ${root} isn't a git clone, so projects can't be pinned to a commit of it.`] };
    const out: ToolkitStatus = { ...base, git: true };
    const pin = await this.pinOf(floor);
    let sha: string | undefined;
    if (pin) {
      const full = await revParse(root, pin.commit);
      sha = full ?? pin.commit;
      out.state = 'pinned';
      out.source = 'record';
      out.previous = pin.previous;
      const dir = pinDir(root, sha);
      out.runsFrom = dir;
      if (!full) out.problems.push(`The pinned commit ${pin.commit.slice(0, 12)} isn't in the toolkit clone: 🔄 Check now fetches it.`);
      else if (!existsSync(dir)) void ensurePin(root, sha).catch(() => undefined);
      else {
        const edited = await pinEdits(dir);
        if (edited.length) out.problems.push(`${edited.length} file${edited.length === 1 ? '' : 's'} in the read-only pin ${dir} ${edited.length === 1 ? 'was' : 'were'} edited (${edited.slice(0, 3).join(', ')}): the project isn't running the commit it records.`);
      }
    } else {
      const register = await readFile(path.join(floor.dir, 'PROJECT.md'), 'utf8').catch(() => undefined);
      const d = await detect(root, floor.dir, register);
      out.source = d.source;
      out.detail = d.detail;
      if (d.sha) {
        sha = d.sha;
        out.state = 'detected';
      }
    }
    if (sha) out.commit = { sha, ...(await commitInfo(root, sha)) };
    const latest = await this.latest(root);
    if (latest) out.latest = { sha: latest.sha, branch: latest.branch, date: (await commitInfo(root, latest.sha)).date };
    if (sha && latest && sha !== latest.sha) {
      const all = await commitsIn(root, `${sha}..${latest.sha}`, 200);
      out.newer = { count: all.length < 200 ? all.length : await countIn(root, `${sha}..${latest.sha}`), commits: all.slice(0, LIST_MAX), summary: kindsSummary(all) };
    }
    out.upstream = await this.upstream(root, latest?.sha);
    return out;
  }

  /** The fork against an `upstream` remote, when the clone has one. */
  private async upstream(root: string, tip: string | undefined): Promise<ToolkitStatus['upstream']> {
    if (!tip || !(await git(['remote'], root))?.split('\n').includes('upstream')) return undefined;
    const branch = await remoteDefault(root, 'upstream');
    if (!branch) return undefined;
    const ref = `refs/remotes/upstream/${branch}`;
    const url = await git(['remote', 'get-url', 'upstream'], root);
    return { remote: 'upstream', branch, behind: await countIn(root, `${tip}..${ref}`), ahead: await countIn(root, `${ref}..${tip}`), ...(url ? { url } : {}) };
  }
}
