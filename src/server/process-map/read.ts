// Reading a process map and what it is drawn from, at one place the deliverables scan found it: a folder
// (the floor's folder with no remote, a team member's worktree) or a commit (origin/<default>, an office
// branch). Read-only, never running the toolkit; every read is async (git through offloop/exec.ts) and
// kept: a commit's answers forever (bounded), a folder's by each file's size and time.

import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { insideCheckout } from '../changes.js';
import { execFileOff } from '../offloop/exec.js';
import { blobOnBranch, treeAt } from '../deliverables/git.js';
import type { Source } from '../deliverables/content.js';
import { mapInputs, type MapTimes } from '../../shared/process-map.js';

/** A place resolved: a folder, or a commit of a repository. */
export type Place = { dir: string } | { repo: string; sha: string };

/** A checkout's files can be written a moment apart: a source this little newer than the map isn't "newer". */
export const FOLDER_SLACK_MS = 2000;

const ENV = { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0' };
const git = (args: string[], cwd: string): Promise<string | undefined> =>
  new Promise((resolve) => execFileOff('git', args, { cwd, timeout: 20_000, env: ENV, windowsHide: true, maxBuffer: 1024 * 1024 }, (err, out) => resolve(err ? undefined : out)));

const SHA = /^[0-9a-f]{40,64}$/i;
function bound<K, V>(m: Map<K, V>, max: number) {
  while (m.size > max) m.delete(m.keys().next().value!);
}

/** A deliverables source (content.ts's) as a place: a branch name is resolved to its commit. */
export async function placeOf(src: Source): Promise<Place | undefined> {
  if ('dir' in src) return { dir: src.dir };
  if (SHA.test(src.branch)) return { repo: src.repo, sha: src.branch.toLowerCase() };
  const sha = (await git(['rev-parse', '-q', '--verify', `${src.branch}^{commit}`], src.repo))?.trim();
  return sha && SHA.test(sha) ? { repo: src.repo, sha } : undefined;
}

export const placeKey = (p: Place) => ('dir' in p ? `dir:${path.resolve(p.dir)}` : `git:${path.resolve(p.repo)}@${p.sha}`);

// ---------- times ----------

const commitTimes = new Map<string, Promise<number | undefined>>();
/** When `pathspec` last changed at the commit, ms (its last commit's time); undefined when it isn't there. */
function lastChange(repo: string, sha: string, pathspec: string): Promise<number | undefined> {
  const key = `${repo}\0${sha}\0${pathspec}`;
  let p = commitTimes.get(key);
  if (!p) {
    p = git(['log', '-1', '--format=%ct', sha, '--', pathspec], repo).then((out) => {
      const n = Number(out?.trim());
      return out?.trim() && Number.isFinite(n) ? n * 1000 : undefined;
    });
    commitTimes.set(key, p);
    bound(commitTimes, 4000);
  }
  return p;
}

async function mtime(dir: string, rel: string): Promise<number | undefined> {
  try {
    const s = await stat(path.join(dir, rel));
    return s.isFile() ? s.mtimeMs : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The map's time and its inputs' at `place`: in a folder their files' own times (as the toolkit's gate
 * reads them), at a commit the last commit that changed each. Undefined when the map isn't there.
 */
export async function mapTimes(place: Place, mapPath: string): Promise<MapTimes | undefined> {
  const inp = mapInputs(mapPath);
  if ('dir' in place) {
    const map = await mtime(place.dir, mapPath);
    if (map === undefined) return undefined;
    let names: string[] = [];
    try {
      names = (await readdir(path.join(place.dir, inp.wireframes))).filter((n) => /\.html$/i.test(n));
    } catch {
      // no wireframes folder
    }
    const [model, anchors, ...wf] = await Promise.all([mtime(place.dir, inp.model), mtime(place.dir, inp.anchors), ...names.map((n) => mtime(place.dir, `${inp.wireframes}/${n}`))]);
    const wfTimes = wf.filter((t): t is number => t !== undefined);
    return { map, model, anchors, wireframe: wfTimes.length ? Math.max(...wfTimes) : undefined, wireframes: wfTimes.length };
  }
  const tree = await treeAt(place.repo, place.sha);
  const has = (p: string) => tree.some((t) => t.path === p);
  if (!has(mapPath)) return undefined;
  const prefix = `${inp.wireframes}/`;
  const wireframes = tree.filter((t) => t.path.startsWith(prefix) && !t.path.slice(prefix.length).includes('/') && /\.html$/i.test(t.path)).length;
  const [map, model, anchors, wireframe] = await Promise.all([
    lastChange(place.repo, place.sha, mapPath),
    has(inp.model) ? lastChange(place.repo, place.sha, inp.model) : undefined,
    has(inp.anchors) ? lastChange(place.repo, place.sha, inp.anchors) : undefined,
    wireframes ? lastChange(place.repo, place.sha, `:(glob)${inp.wireframes}/*.html`) : undefined,
  ]);
  if (map === undefined) return undefined;
  return { map, model, anchors, wireframe, wireframes };
}

// ---------- bytes ----------

/**
 * What `fn` makes of a text file at `place` (at most `max` bytes, else undefined), kept by the file's
 * version (its size and time in a folder, the commit in git), so only the answer is kept,
 * never the bytes. `sig` changes when the file does.
 */
async function readWith<T>(cache: Map<string, Promise<T | undefined>>, place: Place, rel: string, max: number, fn: (text: string) => T): Promise<{ value: T; sig: string } | undefined> {
  let sig: string;
  let load: () => Promise<string | undefined>;
  if ('dir' in place) {
    const abs = await insideCheckout(place.dir, rel);
    if (!abs) return undefined;
    try {
      const s = await stat(abs);
      if (!s.isFile() || s.size > max) return undefined;
      sig = `${abs}\0${s.size}\0${s.mtimeMs}`;
    } catch {
      return undefined;
    }
    load = () => readFile(abs, 'utf8').catch(() => undefined);
  } else {
    sig = `${place.repo}\0${place.sha}\0${rel}`;
    load = () => blobOnBranch(place.repo, place.sha, rel, max).then((b) => b?.toString('utf8'));
  }
  let p = cache.get(sig);
  if (!p) {
    p = load().then((t) => (t === undefined ? undefined : fn(t)));
    cache.set(sig, p);
    bound(cache, 300);
  }
  const value = await p;
  return value === undefined ? undefined : { value, sig };
}

const parsed = new Map<string, Promise<unknown>>();
/** A JSON file at `place`, parsed (undefined when it isn't there, is too big or isn't JSON). */
export function readJson(place: Place, rel: string, max: number): Promise<{ value: unknown; sig: string } | undefined> {
  return readWith(parsed, place, rel, max, (t) => {
    try {
      return JSON.parse(t.replace(/^﻿/, '')) as unknown;
    } catch {
      return undefined;
    }
  });
}

const marks = new Map<string, Promise<boolean | undefined>>();
/** Whether a file at `place` contains `mark` (the BRD report's map frame). */
export async function fileHas(place: Place, rel: string, mark: string, max: number): Promise<boolean> {
  return (await readWith(marks, place, rel, max, (t) => t.includes(mark)))?.value ?? false;
}
