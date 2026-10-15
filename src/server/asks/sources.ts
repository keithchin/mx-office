// Where the team's words are, besides main: the floor's own folder, each agent's worktree and the local
// branch heads (office/* and the team's worktree branches, the remote-tracking copies of office/* too).
// Journals, handoffs, standups and PROJECT.md often sit there for days before a pull request brings them
// to main (a Coordinator's branch was 78 commits ahead, 2026-10-13), so the asks the office surfaces are
// read from all of them. Local git only, every git started off the event loop (offloop/exec.ts), files
// in a folder read through node:fs/promises; branch reads cached by the branch's commit.

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { execFileOff } from '../offloop/exec.js';
import { officeBranches, safeBranch } from '../deliverables/git.js';

const ENV = { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0' };

export function git(args: string[], cwd: string, input?: string): Promise<string | undefined> {
  return new Promise((resolve) => {
    execFileOff('git', args, { cwd, maxBuffer: 64 * 1024 * 1024, timeout: 30_000, env: ENV, windowsHide: true, ...(input !== undefined ? { input } : {}) }, (err, out) => resolve(err ? undefined : out));
  });
}

/** Someone on the floor whose copy is read: a worker with its worktree and branch, and its team role. */
export interface AskPerson {
  name: string;
  role?: string;
  /** Its worktree, absolute, and the branch it's on. */
  dir?: string;
  branch?: string;
}

/** One place a file was read from. */
export interface Place {
  kind: 'checkout' | 'worktree' | 'branch';
  /** Whose copy it is ("Ada"), or the branch's name when nobody's. */
  who: string;
  role?: string;
  branch?: string;
  /** A folder (checkout, worktree). */
  dir?: string;
  /** A branch's commit. */
  sha?: string;
  /** Its last commit, ms (branches). */
  at?: number;
}

/** How reading one file went: there (ok), not there (missing: a negative read), or couldn't tell (failed: a git error, an unreadable file). */
export type ReadOutcome = 'ok' | 'missing' | 'failed';

export interface Read {
  place: Place;
  /** Path → text, for the files asked for that are there. */
  files: Map<string, string>;
  /** Each file asked for: ok, missing or failed. A failed read is never taken as "not there" (decision cards, D02). */
  outcome: Map<string, ReadOutcome>;
}

/** Whether any read of `files` (all of them when not given) failed. */
export const anyFailed = (reads: readonly Read[], files?: readonly string[]) => reads.some((r) => [...(r.outcome ?? [])].some(([f, o]) => o === 'failed' && (!files || files.includes(f))));

/** The places to read on a floor: its folder, its people's worktrees, and the local branch heads nobody has checked out. */
export async function placesOf(floorDir: string, people: readonly AskPerson[]): Promise<Place[]> {
  const out: Place[] = [{ kind: 'checkout', who: 'the project folder', dir: floorDir }];
  const branches = new Set<string>();
  for (const p of people) {
    if (!p.dir) continue;
    out.push({ kind: 'worktree', who: p.name, ...(p.role ? { role: p.role } : {}), dir: p.dir, ...(p.branch ? { branch: p.branch } : {}) });
    if (p.branch) branches.add(p.branch);
  }
  const wanted = people.map((p) => p.branch).filter((b): b is string => !!b && safeBranch(b));
  for (const b of await officeBranches(floorDir, wanted)) {
    const name = b.name.replace(/^origin\//, '');
    // A branch checked out in a worktree is read from the worktree (its newest words, committed or not).
    if (branches.has(name) || branches.has(b.name)) continue;
    branches.add(name);
    const owner = people.find((p) => p.branch === name);
    out.push({ kind: 'branch', who: owner?.name ?? name, ...(owner?.role ? { role: owner.role } : {}), branch: b.name, sha: b.sha, at: b.at });
  }
  return out;
}

const branchReads = new Map<string, Map<string, string>>();
const KEPT = 600;

/** `files` from each place: a folder's from the disk, every branch's in one `git cat-file --batch`. */
export async function readEverywhere(floorDir: string, places: readonly Place[], files: readonly string[]): Promise<Read[]> {
  const out: Read[] = [];
  const ask: { place: Place; file: string }[] = [];
  const reads = new Map<Place, Map<string, string>>();
  const outcomes = new Map<Place, Map<string, ReadOutcome>>();
  for (const place of places) {
    const got = new Map<string, string>();
    const how = new Map<string, ReadOutcome>();
    reads.set(place, got);
    outcomes.set(place, how);
    if (place.dir) {
      await Promise.all(files.map(async (f) => {
        try {
          got.set(f, await readFile(path.join(place.dir!, f), 'utf8'));
          how.set(f, 'ok');
        } catch (err) {
          // Not there (the file, or a worktree that's gone: the lost-worktree row says so) is a negative read; anything else is a failed one.
          const code = (err as NodeJS.ErrnoException)?.code;
          how.set(f, code === 'ENOENT' || code === 'ENOTDIR' ? 'missing' : 'failed');
        }
      }));
    } else if (place.sha) {
      for (const f of files) {
        const hit = branchReads.get(`${place.sha}:${f}`);
        if (hit) {
          for (const [k, v] of hit) got.set(k, v);
          how.set(f, hit.has(f) ? 'ok' : 'missing');
        } else ask.push({ place, file: f });
      }
    }
  }
  if (ask.length) {
    const texts = await catFilesRead(floorDir, ask.map((a) => `${a.place.sha}:${a.file}`));
    ask.forEach((a, i) => {
      const t = texts ? texts[i] : undefined;
      if (!texts) return void outcomes.get(a.place)!.set(a.file, 'failed');
      const m = new Map<string, string>(t !== undefined ? [[a.file, t]] : []);
      branchReads.set(`${a.place.sha}:${a.file}`, m);
      outcomes.get(a.place)!.set(a.file, t !== undefined ? 'ok' : 'missing');
      if (t !== undefined) reads.get(a.place)!.set(a.file, t);
    });
    while (branchReads.size > KEPT) branchReads.delete(branchReads.keys().next().value!);
  }
  for (const place of places) out.push({ place, files: reads.get(place)!, outcome: outcomes.get(place)! });
  return out;
}

/** Each `<rev>:<path>` as text (undefined when missing or over 2 MB), in one cat-file --batch. */
export async function catFiles(dir: string, specs: readonly string[], maxBytes = 2 * 1024 * 1024): Promise<(string | undefined)[]> {
  return (await catFilesRead(dir, specs, maxBytes)) ?? specs.map(() => undefined);
}

/** catFiles, or undefined when git itself failed (so nothing it was asked for can be called missing). */
export async function catFilesRead(dir: string, specs: readonly string[], maxBytes = 2 * 1024 * 1024): Promise<(string | undefined)[] | undefined> {
  const res: (string | undefined)[] = specs.map(() => undefined);
  if (!specs.length) return res;
  const outText = await git(['cat-file', '--batch'], dir, specs.join('\n') + '\n');
  if (outText === undefined) return undefined;
  if (!outText) return res;
  const buf = Buffer.from(outText, 'utf8');
  let at = 0;
  for (let i = 0; i < specs.length; i++) {
    const nl = buf.indexOf(0x0a, at);
    if (nl < 0) break;
    const head = buf.subarray(at, nl).toString('utf8');
    at = nl + 1;
    const m = /^[0-9a-f]+ (\w+) (\d+)$/.exec(head);
    if (!m) continue; // "<spec> missing"
    const size = Number(m[2]);
    if (m[1] === 'blob' && size <= maxBytes) res[i] = buf.subarray(at, at + size).toString('utf8');
    at += size + 1;
  }
  return res;
}
