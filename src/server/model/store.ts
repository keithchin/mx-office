// Where the Model tab keeps what it read, under <data dir>/model/:
//
//   snap/<sha>/   the project at one commit (the .mpr and mprcontents/ only, from `git archive`), so
//                 mxcli reads a copy nobody is writing to: not the floor's checkout, which people,
//                 agents and Studio Pro change under it, and never anything the office then writes.
//   cache/<sha>/  each answer as JSON (the tree, one file per document), so a commit is read once.
//
// A commit never changes, so nothing here goes stale; the oldest commits are let go when there are
// more than SNAP_MAX snapshots or the cache passes CACHE_MAX_BYTES. Two asks for the same thing at
// once share one read (`once`).

import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { execFileOffP } from '../offloop/exec.js';

export const SNAP_MAX = 12;
export const CACHE_MAX_BYTES = 200 * 1024 * 1024;

const GIT_ENV = { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0' };
export type GitRun = (args: string[], cwd: string) => Promise<string>;
export const gitOff: GitRun = async (args, cwd) => (await execFileOffP('git', ['-c', 'core.longpaths=true', ...args], { cwd, env: GIT_ENV, timeout: 120_000, maxBuffer: 32 * 1024 * 1024 })).stdout;

export interface Snapshot {
  sha: string;
  dir: string;
  /** The .mpr's path in the snapshot. */
  mpr: string;
}

/** The .mpr a commit has: at the top, or one folder down (as liveapp/checkout.ts's findMpr). */
export function mprIn(files: string[]): string | undefined {
  const mprs = files.filter((f) => /\.mpr$/i.test(f) && f.split('/').length <= 2 && !f.split('/').some((p) => p.startsWith('.')));
  return mprs.sort((a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b))[0];
}

export const SHA = /^[0-9a-f]{7,64}$/;

export class ModelStore {
  private inflight = new Map<string, Promise<unknown>>();
  readonly root: string;

  constructor(dataDir: string, private git: GitRun = gitOff) {
    this.root = path.join(dataDir, 'model');
  }

  /** Shares one run of `fn` between everyone asking for `key` while it runs. */
  once<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const running = this.inflight.get(key) as Promise<T> | undefined;
    if (running) return running;
    const p = fn().finally(() => this.inflight.delete(key));
    this.inflight.set(key, p);
    return p;
  }

  /** The project at `sha`, taken out of `repoDir`'s history the first time it's asked for. */
  snapshot(repoDir: string, sha: string): Promise<Snapshot> {
    if (!SHA.test(sha)) return Promise.reject(new Error(`not a commit: ${sha}`));
    return this.once(`snap:${sha}`, async () => {
      const dir = path.join(this.root, 'snap', sha);
      const ok = path.join(dir, '.ok');
      try {
        const mpr = (await readFile(ok, 'utf8')).trim();
        const now = new Date();
        await utimes(ok, now, now).catch(() => {});
        return { sha, dir, mpr: path.join(dir, mpr) };
      } catch {
        /* not taken out yet */
      }
      const files = (await this.git(['ls-tree', '-r', '--name-only', sha], repoDir)).split('\n').map((l) => l.trim()).filter(Boolean);
      const mpr = mprIn(files);
      if (!mpr) throw new Error('no Mendix project (.mpr) in this commit');
      const base = path.posix.dirname(mpr);
      const contents = base === '.' ? 'mprcontents' : `${base}/mprcontents`;
      const want = [mpr, ...(files.some((f) => f.startsWith(`${contents}/`)) ? [contents] : [])];
      // Taken out straight into its folder; `.ok`, written last, says it's whole (renaming a folder
      // just written fails on Windows while the virus scanner looks at it).
      await rm(dir, { recursive: true, force: true });
      await mkdir(dir, { recursive: true });
      try {
        const tar = path.join(dir, '.snap.tar');
        await this.git(['archive', '--format=tar', '-o', tar, sha, '--', ...want], repoDir);
        await execFileOffP('tar', ['-xf', '.snap.tar'], { cwd: dir, timeout: 120_000 });
        await rm(tar, { force: true });
        await writeFile(ok, mpr);
      } catch (err) {
        await rm(dir, { recursive: true, force: true }).catch(() => {});
        throw err;
      }
      void this.prune();
      return { sha, dir, mpr: path.join(dir, mpr) };
    });
  }

  private cacheFile(sha: string, key: string): string {
    const safe = key.replace(/[^\w.-]+/g, '_').slice(0, 80);
    const h = createHash('sha1').update(key).digest('hex').slice(0, 10);
    return path.join(this.root, 'cache', sha, `${safe}-${h}.json`);
  }

  /** `fn`'s answer for (sha, key), from the cache when it was worked out before. */
  cached<T>(sha: string, key: string, fn: () => Promise<T>): Promise<T> {
    const file = this.cacheFile(sha, key);
    return this.once(`cache:${sha}:${key}`, async () => {
      try {
        return JSON.parse(await readFile(file, 'utf8')) as T;
      } catch {
        /* not worked out yet */
      }
      const value = await fn();
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, JSON.stringify(value));
      return value;
    });
  }

  /** Lets go of the oldest snapshots past SNAP_MAX and the oldest commits' answers past CACHE_MAX_BYTES. */
  async prune(): Promise<void> {
    const byAge = async (dir: string) => {
      const names = await readdir(dir).catch(() => [] as string[]);
      const out: { p: string; at: number; size: number }[] = [];
      for (const n of names) {
        const p = path.join(dir, n);
        const s = await stat(p).catch(() => null);
        if (!s?.isDirectory()) continue;
        let size = 0;
        let at = s.mtimeMs;
        for (const f of await readdir(p).catch(() => [] as string[])) {
          const fs = await stat(path.join(p, f)).catch(() => null);
          if (fs?.isFile()) {
            size += fs.size;
            at = Math.max(at, fs.mtimeMs);
          }
        }
        out.push({ p, at, size });
      }
      return out.sort((a, b) => b.at - a.at);
    };
    const snaps = await byAge(path.join(this.root, 'snap'));
    for (const s of snaps.slice(SNAP_MAX)) await rm(s.p, { recursive: true, force: true }).catch(() => {});
    let total = 0;
    for (const c of await byAge(path.join(this.root, 'cache'))) {
      total += c.size;
      if (total > CACHE_MAX_BYTES) await rm(c.p, { recursive: true, force: true }).catch(() => {});
    }
  }
}
