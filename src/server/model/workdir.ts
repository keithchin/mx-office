// Where mxcli reads a commit, now that the diagrams no longer need it and it's only asked for the
// tree when the app's structure changed, a document's MDL and the documents shown as MDL. A few
// folders under <data>/model/work/ each hold one commit's .mpr and mprcontents/ (never the floor's
// checkout, which people, agents and Studio Pro change under it), and moving one to another commit
// writes only the units that differ (by blob hash, from git: blobs.ts), so a new commit on main costs
// a handful of files instead of a whole copy of the app. A folder in use by an mxcli run is never
// changed under it: a commit waits for a free one.
//
// Each folder keeps `.state.json` (its commit and every file's blob), written last, so a folder
// changed half-way is rewritten whole next time.

import { mkdir, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { GitBlobs, ModelFiles } from './blobs.js';

export const WORK_SLOTS = 3;
/** Files written at once when a folder moves to another commit. */
const WRITE_PARALLEL = 16;

interface Slot {
  dir: string;
  sha: string | null;
  files: Map<string, string> | null;
  users: number;
  used: number;
  moving: Promise<void> | null;
}

/** The files a commit's project is made of: the .mpr and each unit, by path in the folder → blob. */
export function wanted(files: ModelFiles): Map<string, string> {
  const base = path.posix.dirname(files.mpr);
  const prefix = base === '.' ? '' : `${base}/`;
  const out = new Map<string, string>([[files.mpr, files.mprBlob]]);
  for (const [id, blob] of files.units) out.set(`${prefix}mprcontents/${id.slice(0, 2)}/${id.slice(2, 4)}/${id}.mxunit`, blob);
  return out;
}

export class WorkDirs {
  private slots: Slot[];
  private waiting: (() => void)[] = [];
  /** Files written since start, for tests and the perf script. */
  written = 0;

  constructor(root: string, n = WORK_SLOTS) {
    this.slots = Array.from({ length: n }, (_, i) => ({ dir: path.join(root, 'work', String(i)), sha: null, files: null, users: 0, used: 0, moving: null }));
  }

  /** Runs `fn` with the path of commit `sha`'s .mpr on disk, the folder kept as it is until `fn` is done. */
  async use<T>(blobs: GitBlobs, sha: string, files: ModelFiles, fn: (mpr: string, dir: string) => Promise<T>): Promise<T> {
    const slot = await this.acquire(blobs, sha, files);
    try {
      return await fn(path.join(slot.dir, files.mpr), slot.dir);
    } finally {
      slot.users--;
      slot.used = Date.now();
      this.waiting.shift()?.();
    }
  }

  /** What each folder held when the office last stopped. */
  private loaded: Promise<void> | null = null;
  private load(): Promise<void> {
    this.loaded ??= Promise.all(
      this.slots.map(async (slot) => {
        try {
          const s = JSON.parse(await readFile(path.join(slot.dir, '.state.json'), 'utf8')) as { sha: string; files: Record<string, string> };
          if (slot.sha === null && !slot.moving) [slot.sha, slot.files] = [s.sha, new Map(Object.entries(s.files))];
        } catch {
          /* empty, or changed half-way: rewritten when used */
        }
      }),
    ).then(() => undefined);
    return this.loaded;
  }

  private async acquire(blobs: GitBlobs, sha: string, files: ModelFiles): Promise<Slot> {
    await this.load();
    for (;;) {
      const same = this.slots.find((s) => s.sha === sha);
      if (same) {
        same.users++;
        if (same.moving) await same.moving.catch(() => {});
        if (same.sha === sha && same.files) return same;
        same.users--;
        continue;
      }
      // A free folder: the one used last (consecutive commits differ by a few files), an empty one
      // only when every folder that has a commit is busy (two commits read at once).
      const free = this.slots.filter((s) => s.users === 0 && !s.moving).sort((a, b) => Number(!!b.files) - Number(!!a.files) || b.used - a.used)[0];
      if (free) {
        free.users++;
        free.sha = sha;
        free.moving = this.move(free, blobs, sha, files).finally(() => (free.moving = null));
        try {
          await free.moving;
        } catch (err) {
          free.users--;
          free.sha = null;
          free.files = null;
          this.waiting.shift()?.();
          throw err;
        }
        return free;
      }
      await new Promise<void>((r) => this.waiting.push(r));
    }
  }

  private async move(slot: Slot, blobs: GitBlobs, sha: string, files: ModelFiles): Promise<void> {
    const state = path.join(slot.dir, '.state.json');
    const want = wanted(files);
    const have = slot.files;
    slot.files = null;
    await unlink(state).catch(() => {});
    if (!have) await rm(slot.dir, { recursive: true, force: true });
    await mkdir(slot.dir, { recursive: true });
    const write = [...want].filter(([p, b]) => have?.get(p) !== b);
    const gone = have ? [...have.keys()].filter((p) => !want.has(p)) : [];
    for (const p of gone) await unlink(path.join(slot.dir, p)).catch(() => {});
    const dirs = new Set(write.map(([p]) => path.dirname(path.join(slot.dir, p))));
    for (const d of dirs) await mkdir(d, { recursive: true });
    let next = 0;
    const lane = async () => {
      while (next < write.length) {
        const [p, b] = write[next++];
        const data = await blobs.blob(b);
        if (!data) throw new Error(`git has no ${p} for ${sha.slice(0, 12)}`);
        await writeFile(path.join(slot.dir, p), data);
        this.written++;
      }
    };
    await Promise.all(Array.from({ length: Math.min(WRITE_PARALLEL, write.length) }, lane));
    await writeFile(state, JSON.stringify({ sha, files: Object.fromEntries(want) }));
    slot.files = want;
  }
}
