// Where a record is (Slice 1B-2): a working copy (not committed), a commit on a branch, or merged into main,
// each part its own field: the file's path, the commit whose tree holds the recorded content, and the
// file's blob in that commit (`git rev-parse <commit>:<path>`, never confused with the commit). Merged is
// "the commit is reachable from origin/<default>" (`git merge-base --is-ancestor`), local git only: no
// fetch, no GitHub. Every git runs off the event loop (asks/sources.ts git, offloop/exec.ts). What can't
// change is cached for the process (a commit's file, a blob id, whether one commit is in another); what
// can (a folder's HEAD, where origin/<default> is) is cached for one Locator, made per scan or collection.

import { defaultBranch } from '../wizard/gate-source.js';
import { catFiles, git } from '../asks/sources.js';
import type { RecordedLocation } from '../../shared/followthrough.js';

const KEPT = 500;
const texts = new Map<string, Promise<string | undefined>>();
const blobs = new Map<string, Promise<string | undefined>>();
const ancestry = new Map<string, Promise<boolean>>();

function remember<T>(m: Map<string, Promise<T>>, key: string, make: () => Promise<T>): Promise<T> {
  let p = m.get(key);
  if (!p) {
    p = make();
    m.set(key, p);
    while (m.size > KEPT) m.delete(m.keys().next().value!);
  }
  return p;
}

const lf = (s: string) => s.replace(/\r\n?/g, '\n');

/** A file at a commit, as text (undefined when it isn't there). */
export const textAt = (dir: string, sha: string, path: string) => remember(texts, `${sha}:${path}`, async () => (await catFiles(dir, [`${sha}:${path}`]))[0]);

/** The file's blob id at a commit. */
export const blobAt = (dir: string, sha: string, path: string) => remember(blobs, `${sha}:${path}`, async () => (await git(['rev-parse', '--verify', '-q', `${sha}:${path}`], dir))?.trim() || undefined);

/** Whether commit `sha` is reachable from commit `into`. */
export const isAncestor = (dir: string, sha: string, into: string) => (sha === into ? Promise.resolve(true) : remember(ancestry, `${sha}>${into}`, async () => (await git(['merge-base', '--is-ancestor', sha, into], dir)) !== undefined));

/** Where a place's copy was read from (asks/sources.ts Place, or a questions folder). */
export interface Where {
  kind: 'checkout' | 'worktree' | 'branch';
  who?: string;
  dir?: string;
  sha?: string;
  branch?: string;
}

export interface MainRef {
  name: string;
  sha: string;
}

/** One scan's (or one collection's) look at where records are. */
export class Locator {
  private main?: Promise<MainRef | undefined>;
  private heads = new Map<string, Promise<{ sha: string; branch?: string } | undefined>>();

  constructor(readonly floorDir: string) {}

  /** origin/<default> and the commit it's at, when the project has one (no fetch). */
  mainRef(): Promise<MainRef | undefined> {
    return (this.main ??= (async () => {
      const name = await defaultBranch(this.floorDir).catch(() => undefined);
      if (!name) return undefined;
      const sha = (await git(['rev-parse', '--verify', '-q', `refs/remotes/origin/${name}`], this.floorDir))?.trim();
      return sha ? { name, sha } : undefined;
    })());
  }

  /** A folder's HEAD commit and the branch it's on. */
  head(dir: string) {
    let p = this.heads.get(dir);
    if (!p) {
      p = git(['rev-parse', 'HEAD', '--abbrev-ref', 'HEAD'], dir).then((out) => {
        const [sha, branch] = (out ?? '').split('\n').map((s) => s.trim());
        return /^[0-9a-f]{40}$/.test(sha ?? '') ? { sha, ...(branch && branch !== 'HEAD' ? { branch } : {}) } : undefined;
      });
      this.heads.set(dir, p);
    }
    return p;
  }

  /** A commit's location: merged into main when origin/<default> reaches it, else on `branch`. */
  async committed(dir: string, sha: string, path: string, branch: string | undefined, who?: string): Promise<RecordedLocation> {
    const main = await this.mainRef();
    const blobId = await blobAt(dir, sha, path);
    const merged = !!main && (await isAncestor(dir, sha, main.sha));
    return { path, commitSha: sha, ...(blobId ? { blobId } : {}), where: merged ? 'merged-into-main' : 'committed-on-branch', ...(merged ? { branch: main!.name } : branch ? { branch } : {}), ...(who ? { who } : {}) };
  }

  /**
   * Where a block of text found in `path` at `place` is: main's own copy first (origin/<default> holds those
   * exact lines: merged), then the branch's commit, or the folder's HEAD when its committed file has them,
   * else the working copy.
   */
  async locateBlock(place: Where, path: string, block: string): Promise<RecordedLocation> {
    const want = lf(block);
    const main = await this.mainRef();
    if (main) {
      const t = await textAt(this.floorDir, main.sha, path);
      if (t !== undefined && lf(t).includes(want)) return this.committed(this.floorDir, main.sha, path, main.name, place.who);
    }
    if (place.sha) return this.committed(this.floorDir, place.sha, path, place.branch?.replace(/^origin\//, ''), place.who);
    if (place.dir) {
      const h = await this.head(place.dir);
      if (h) {
        const t = await textAt(place.dir, h.sha, path);
        if (t !== undefined && lf(t).includes(want)) return this.committed(place.dir, h.sha, path, h.branch ?? place.branch, place.who);
      }
    }
    return { path, where: 'working-copy', ...(place.who ? { who: place.who } : {}) };
  }

  /** Where a BRD read from a folder is: its working copy when changed there, else the folder's HEAD commit. */
  async locateFile(dir: string, rel: string, committed: boolean, who?: string): Promise<RecordedLocation> {
    if (!committed) return { path: rel, where: 'working-copy', ...(who ? { who } : {}) };
    const h = await this.head(dir);
    if (!h) return { path: rel, where: 'working-copy', ...(who ? { who } : {}) };
    return this.committed(dir, h.sha, rel, h.branch, who);
  }
}
