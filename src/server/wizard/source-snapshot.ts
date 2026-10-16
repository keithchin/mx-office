// The imported snapshot of a source folder (wizard/source-folder.ts walks it, wizard/source-step.ts calls
// this at setup): what the project's sources/legacy/<name>/ holds is defined by a manifest of relative
// paths, sizes and sha256 hashes, written beside it as sources/legacy/<name>.manifest.json (git-ignored
// with the snapshot). A Retry never carries on from an earlier copy: every import copies into a fresh
// staging folder, checks it, and only then swaps it in, so a completed snapshot holds exactly the
// manifest's files, nothing more and nothing less, with those bytes.
//
// Beside the snapshot, all dot-named and git-ignored with it:
//   .<name>.staging/ and .<name>.staging.manifest.json   the import being made
//   .<name>.previous/ and .<name>.previous.manifest.json the completed snapshot being replaced, while the swap runs
//   .<name>.import.json                                  the operation record: { phase: 'copying' | 'publishing' }
// An import that stops (a crash, a kill, an error) is found by its record on the next run: one stopped
// while copying is thrown away (the previous snapshot, if any, was never touched); one stopped while
// publishing had a complete, checked staging folder, and its swap is finished. Nothing half-copied is
// ever renamed into place.
//
// The source is only read (opened read-only, never written), with the scan's rules (source-folder.ts:
// skipped folders, secrets-like and large files, links and junctions never followed, the caps). A file
// whose size or modified time differs before and after its copy is copied again (a few times, then the
// import stops); at the end the source is walked and hashed again against the manifest, and any
// difference stops the import with the paths that changed. Everything is fs/promises and streams, so a
// large tree never holds the event loop; progress is reported at most once a second.

import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { lstat, mkdir, opendir, readFile, realpath, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { SourceFolder } from '../../shared/source-folder.js';
import { writeJsonCritical } from '../flow/critical-write.js';
import { DEFAULT_CAPS, inside, samePath, walk, type SourceCaps, type WalkedFile } from './source-folder.js';

export const MANIFEST_VERSION = 1;

export interface ManifestEntry {
  /** Relative to the snapshot, forward slashes. */
  path: string;
  size: number;
  sha256: string;
}

export interface SnapshotManifest {
  version: typeof MANIFEST_VERSION;
  name: string;
  /** The source folder it was imported from (on the office's machine). */
  source: string;
  importedAt: string;
  files: number;
  bytes: number;
  skipped: SourceFolder['skipped'];
  /** sha256 over the entries (`<sha256> <size> <path>\n` each, in path order): the snapshot's identity. */
  sha256: string;
  entries: ManifestEntry[];
}

/** Where a snapshot at `dest` keeps its manifest, its staging folder, the one it replaces and its operation record. */
export function snapshotPaths(dest: string) {
  const parent = path.dirname(dest);
  const base = path.basename(dest);
  const at = (n: string) => path.join(parent, n);
  return {
    dir: dest,
    manifest: at(`${base}.manifest.json`),
    staging: at(`.${base}.staging`),
    stagingManifest: at(`.${base}.staging.manifest.json`),
    previous: at(`.${base}.previous`),
    previousManifest: at(`.${base}.previous.manifest.json`),
    op: at(`.${base}.import.json`),
  };
}
type Paths = ReturnType<typeof snapshotPaths>;

interface ImportRecord {
  phase: 'copying' | 'publishing';
  source: string;
  startedAt: string;
  pid: number;
}

/** Where a test stops or changes things: before/after a file's bytes are copied, before the swap, between its renames. */
export type SnapshotPoint = 'copy' | 'copied' | 'publish' | 'swap';

export interface SnapshotProgress {
  phase: 'copying' | 'checking';
  files: number;
  totalFiles: number;
  bytes: number;
  totalBytes: number;
}

export interface SnapshotOptions {
  caps?: SourceCaps;
  /** The snapshot's name in the manifest (defaults to the folder's own name). */
  name?: string;
  now?: () => Date;
  /** At most once a second, and at the end of each phase. */
  onProgress?: (p: SnapshotProgress) => void;
  /** Something worth a line in the log: a file copied again, an interrupted import recovered. */
  onNote?: (line: string) => void;
  /** Tests only: called at each point (may throw, to stand for a crash there, or change the source). */
  at?: (point: SnapshotPoint, rel?: string) => void | Promise<void>;
  /** How many times one file is copied when it keeps changing (default 3). */
  tries?: number;
}

export interface SnapshotResult {
  files: number;
  bytes: number;
  skipped: SourceFolder['skipped'];
  manifest: SnapshotManifest;
  /** Whether a completed snapshot was there before and was replaced. */
  replaced: boolean;
  /** What an earlier, interrupted import left and what was done about it. */
  recovered?: string;
}

/** A problem with the source or the copy the person can act on; the staging folder is cleared. */
export class SnapshotError extends Error {}

const exists = (p: string) => lstat(p).then(() => true, () => false);
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
const BUSY = new Set(['EPERM', 'EBUSY', 'EACCES']);

/** rename, tried again for a moment when Windows reports the folder busy (a virus scanner, the indexer). */
async function move(from: string, to: string): Promise<void> {
  for (let i = 0; ; i++) {
    try {
      return await rename(from, to);
    } catch (err) {
      if (i >= 8 || !BUSY.has((err as NodeJS.ErrnoException).code ?? '')) throw err;
      await pause(25 * (i + 1));
    }
  }
}

const gone = (p: string) => rm(p, { recursive: true, force: true, maxRetries: 3 });

/** The entries' own digest: the manifest's `sha256`. */
export function entriesDigest(entries: ManifestEntry[]): string {
  const h = createHash('sha256');
  for (const e of entries) h.update(`${e.sha256} ${e.size} ${e.path}\n`);
  return h.digest('hex');
}

/** sha256 and length of a file, streamed. */
async function hashFile(file: string): Promise<{ sha256: string; size: number }> {
  const h = createHash('sha256');
  let size = 0;
  for await (const chunk of createReadStream(file) as AsyncIterable<Buffer>) {
    h.update(chunk);
    size += chunk.length;
  }
  return { sha256: h.digest('hex'), size };
}

async function readRecord(file: string): Promise<ImportRecord | undefined> {
  try {
    const r = JSON.parse(await readFile(file, 'utf8')) as ImportRecord;
    return r && (r.phase === 'copying' || r.phase === 'publishing') ? r : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Swaps the checked staging folder and its manifest in: each final one (when there) to its .previous
 * name, the staged one to the final name, then the previous ones and the record are removed. Safe to run
 * again from any point it stopped at, as long as the record says publishing (the staged copy was complete).
 */
async function publish(p: Paths, at?: SnapshotOptions['at']): Promise<void> {
  for (const [staged, final, prev] of [
    [p.staging, p.dir, p.previous],
    [p.stagingManifest, p.manifest, p.previousManifest],
  ] as const) {
    if (!(await exists(staged))) continue; // already moved by a run that stopped after it
    if (await exists(final)) {
      await gone(prev);
      await move(final, prev);
    }
    await at?.('swap');
    await move(staged, final);
  }
  await gone(p.previous);
  await gone(p.previousManifest);
  await rm(p.op, { force: true });
}

/** Clears what an import left while copying: the staging folder, its manifest and the record. The completed snapshot stays. */
async function discard(p: Paths): Promise<void> {
  await gone(p.staging);
  await gone(p.stagingManifest);
  await rm(p.op, { force: true });
}

/**
 * Finds an import that stopped before it finished and settles it: one stopped while copying is thrown
 * away, one stopped while publishing is finished. Returns what it did, or undefined when there was nothing.
 */
export async function recoverSnapshot(dest: string): Promise<string | undefined> {
  const p = snapshotPaths(dest);
  const rec = await readRecord(p.op);
  if (rec?.phase === 'publishing') {
    await publish(p);
    return 'an earlier import had stopped while swapping in its checked copy: that swap was finished first';
  }
  const leftovers = rec !== undefined || (await exists(p.op)) || (await exists(p.staging)) || (await exists(p.stagingManifest));
  await discard(p);
  // A .previous with no record: the swap finished and only its clean-up was missed. With no snapshot left, it is the snapshot.
  if (await exists(p.previous)) {
    if (!(await exists(p.dir))) {
      await move(p.previous, p.dir);
      if ((await exists(p.previousManifest)) && !(await exists(p.manifest))) await move(p.previousManifest, p.manifest);
    } else await gone(p.previous);
  }
  await gone(p.previousManifest);
  return leftovers ? 'an earlier import had stopped while copying: its partial copy was thrown away (the completed snapshot, if any, was never touched)' : undefined;
}

/** Copies one file into `to`, hashing what it copies; again when it changed meanwhile. */
async function copyOne(root: string, rel: string, to: string, opts: SnapshotOptions): Promise<ManifestEntry & { mtimeMs: number }> {
  const abs = path.join(root, ...rel.split('/'));
  const tries = Math.max(1, opts.tries ?? 3);
  for (let attempt = 1; ; attempt++) {
    const b = await lstat(abs).catch(() => undefined);
    if (!b) throw new SnapshotError(`${rel} disappeared while the folder was being copied: stop whatever is changing the source folder, then Retry`);
    if (!b.isFile()) throw new SnapshotError(`${rel} is no longer a plain file (a link or a folder took its place): links are never followed. Fix the source folder, then Retry`);
    // A folder on its way swapped for a link or junction since the walk: never read through it.
    const real = await realpath(abs).catch(() => undefined);
    if (real === undefined) throw new SnapshotError(`${rel} disappeared while the folder was being copied: stop whatever is changing the source folder, then Retry`);
    if (!samePath(real, abs)) throw new SnapshotError(`${rel} is now reached through a link or junction: links are never followed. Fix the source folder, then Retry`);
    await opts.at?.('copy', rel);
    const h = createHash('sha256');
    let size = 0;
    const tap = new Transform({
      transform(chunk: Buffer, _enc, cb) {
        h.update(chunk);
        size += chunk.length;
        cb(null, chunk);
      },
    });
    try {
      await pipeline(createReadStream(abs, { flags: 'r' }), tap, createWriteStream(to));
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code ?? '';
      if (!['ENOENT', 'EBUSY', 'EPERM', 'EACCES'].includes(code)) throw err;
      throw new SnapshotError(`${rel} couldn’t be read (${code}): another program may have it locked or be changing it. Close it, then Retry`);
    }
    await opts.at?.('copied', rel);
    const a = await lstat(abs).catch(() => undefined);
    if (a?.isFile() && a.size === b.size && a.mtimeMs === b.mtimeMs && size === b.size) return { path: rel, size, sha256: h.digest('hex'), mtimeMs: b.mtimeMs };
    if (attempt >= tries) throw new SnapshotError(`${rel} kept changing while it was being copied: stop whatever is writing to the source folder (an editor, a build, a sync client), then Retry. The completed snapshot, if any, is unchanged`);
    opts.onNote?.(`${rel} changed while it was being copied: copying it again`);
  }
}

/** Every entry under `dir` (files, and anything else as a problem), relative with forward slashes. */
async function listTree(dir: string): Promise<{ files: string[]; odd: string[] }> {
  const out = { files: [] as string[], odd: [] as string[] };
  const visit = async (d: string, rel: string): Promise<void> => {
    for await (const e of await opendir(d)) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) await visit(path.join(d, e.name), r);
      else if (e.isFile()) out.files.push(r);
      else out.odd.push(r);
    }
  };
  await visit(dir, '');
  return out;
}

/**
 * Checks a snapshot folder against a manifest: exactly its files (nothing extra, nothing missing, no
 * links), each with its size and sha256. Returns the problems found (none when it matches).
 */
export async function checkAgainst(dir: string, manifest: Pick<SnapshotManifest, 'entries' | 'sha256'>, onFile?: (size: number) => void): Promise<string[]> {
  const problems: string[] = [];
  if (entriesDigest(manifest.entries) !== manifest.sha256) problems.push('the manifest’s own digest doesn’t match its entries');
  const tree = await listTree(dir);
  const want = new Map(manifest.entries.map((e) => [e.path, e]));
  for (const f of tree.odd) problems.push(`${f}: not a plain file`);
  for (const f of tree.files) if (!want.has(f)) problems.push(`${f}: not in the manifest`);
  const have = new Set(tree.files);
  for (const e of manifest.entries) {
    if (!have.has(e.path)) {
      problems.push(`${e.path}: missing`);
      continue;
    }
    const got = await hashFile(path.join(dir, ...e.path.split('/')));
    if (got.size !== e.size || got.sha256 !== e.sha256) problems.push(`${e.path}: its bytes don’t match the manifest`);
    onFile?.(e.size);
  }
  return problems;
}

/** Whether the completed snapshot at `dest` is exactly what its manifest says (re-hashing every file). */
export async function verifySnapshot(dest: string): Promise<{ ok: boolean; problems: string[]; manifest?: SnapshotManifest }> {
  const p = snapshotPaths(dest);
  if (await exists(p.op)) return { ok: false, problems: ['an import was interrupted: Retry the setup step to finish or redo it'] };
  let manifest: SnapshotManifest;
  try {
    manifest = JSON.parse(await readFile(p.manifest, 'utf8')) as SnapshotManifest;
  } catch {
    return { ok: false, problems: ['no manifest: this snapshot was made before manifests (or by hand), so what it holds isn’t recorded'] };
  }
  if (!(await exists(p.dir))) return { ok: false, problems: ['the snapshot folder is missing'], manifest };
  const problems = await checkAgainst(p.dir, manifest);
  return { ok: problems.length === 0, problems, manifest };
}

const sameFile = (a: WalkedFile, b: WalkedFile) => a.size === b.size && a.mtimeMs === b.mtimeMs;

/**
 * Imports `src` as the snapshot at `dest` (see the top of this file). Throws a SnapshotError when the
 * source changed or the copy doesn't check out (nothing is published; the completed snapshot, if any,
 * stays), a CapError-like Error past the caps (nothing is written at all).
 */
export async function importSnapshot(src: string, dest: string, opts: SnapshotOptions = {}): Promise<SnapshotResult> {
  const caps = opts.caps ?? DEFAULT_CAPS;
  const now = opts.now ?? (() => new Date());
  const p = snapshotPaths(dest);
  const root = await realpath(src);
  if (inside(dest, root) || inside(root, dest)) throw new Error('The snapshot can’t be inside the source folder, nor the source folder inside the snapshot');
  const recovered = await recoverSnapshot(dest);
  if (recovered) opts.onNote?.(recovered);
  // Looked at in full first, so a folder over the caps writes nothing at all.
  const first = await walk(root, caps);
  const totalFiles = first.files.length;
  const totalBytes = first.bytes;
  const record: ImportRecord = { phase: 'copying', source: src, startedAt: now().toISOString(), pid: process.pid };
  await mkdir(path.dirname(dest), { recursive: true });
  await writeJsonCritical(p.op, record);
  let said = 0;
  const progress = (phase: SnapshotProgress['phase'], files: number, bytes: number, end = false) => {
    if (!opts.onProgress || (!end && Date.now() - said < 1000)) return;
    said = Date.now();
    opts.onProgress({ phase, files, totalFiles, bytes, totalBytes });
  };
  try {
    await gone(p.staging);
    await gone(p.stagingManifest);
    await mkdir(p.staging, { recursive: true });
    const made = new Set<string>([p.staging]);
    const copied: (ManifestEntry & { mtimeMs: number })[] = [];
    let bytes = 0;
    for (const f of first.files.slice().sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))) {
      const to = path.join(p.staging, ...f.path.split('/'));
      const parent = path.dirname(to);
      if (!made.has(parent)) {
        await mkdir(parent, { recursive: true });
        made.add(parent);
      }
      const e = await copyOne(root, f.path, to, opts);
      copied.push(e);
      bytes += e.size;
      progress('copying', copied.length, bytes);
    }
    progress('copying', copied.length, bytes, true);
    // The source again: the same files, each as it was copied, and the same bytes (an edit that kept the
    // size and the modified time is caught by the hash).
    const after = await walk(root, caps).catch((err: Error) => {
      throw new SnapshotError(`The source folder changed while it was being copied: ${err.message}`);
    });
    const was = new Map(copied.map((e) => [e.path, e]));
    const changed = new Set<string>();
    for (const f of after.files) {
      const e = was.get(f.path);
      if (!e || !sameFile(e, f)) changed.add(f.path);
    }
    const still = new Set(after.files.map((f) => f.path));
    for (const e of copied) if (!still.has(e.path)) changed.add(e.path);
    let checked = 0;
    let checkedBytes = 0;
    if (!changed.size) {
      for (const e of copied) {
        const got = await hashFile(path.join(root, ...e.path.split('/'))).catch(() => undefined);
        if (!got || got.size !== e.size || got.sha256 !== e.sha256) changed.add(e.path);
        checked++;
        checkedBytes += e.size;
        progress('checking', checked, checkedBytes);
      }
    }
    if (changed.size) {
      const list = [...changed].sort();
      throw new SnapshotError(`The source folder changed while it was being copied (${list.slice(0, 5).join(', ')}${list.length > 5 ? ` and ${list.length - 5} more` : ''}): stop whatever is writing to it (an editor, a build, a sync client), then Retry. The completed snapshot, if any, is unchanged`);
    }
    const entries = copied.map(({ path: rel, size, sha256 }) => ({ path: rel, size, sha256 }));
    const manifest: SnapshotManifest = { version: MANIFEST_VERSION, name: opts.name ?? path.basename(dest), source: src, importedAt: now().toISOString(), files: entries.length, bytes, skipped: first.skipped, sha256: entriesDigest(entries), entries };
    // The staged copy itself: exactly the manifest's files, with its bytes.
    const problems = await checkAgainst(p.staging, manifest);
    progress('checking', totalFiles, totalBytes, true);
    if (problems.length) throw new SnapshotError(`The copy didn’t match what was read (${problems.slice(0, 3).join('; ')}): Retry`);
    await writeJsonCritical(p.stagingManifest, manifest);
    await opts.at?.('publish');
    const replaced = await exists(p.dir);
    await writeJsonCritical(p.op, { ...record, phase: 'publishing' });
    try {
      await publish(p, opts.at);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (!code || !BUSY.has(code)) throw err;
      throw new Error(`The checked copy couldn’t be swapped into ${path.basename(dest)}/ (${code}): a program may have a file in it open (an editor, a terminal, the virus scanner). Close it, then Retry: the checked copy is kept and swapped in first`);
    }
    return { files: entries.length, bytes, skipped: first.skipped, manifest, replaced, ...(recovered ? { recovered } : {}) };
  } catch (err) {
    // A problem the person can act on clears the partial copy now; anything else (a crash) is left for recoverSnapshot.
    if (err instanceof SnapshotError && (await readRecord(p.op))?.phase === 'copying') await discard(p).catch(() => undefined);
    throw err;
  }
}

/** The setup's name for it (source-step.ts): `src` imported as the snapshot at `dest`, within `caps`. */
export function copySourceFolder(src: string, dest: string, caps: SourceCaps = DEFAULT_CAPS, opts: Omit<SnapshotOptions, 'caps'> = {}): Promise<SnapshotResult> {
  return importSnapshot(src, dest, { ...opts, caps });
}

/** Whether a snapshot is there at `dest`, and whether it has a manifest (made by this module). */
export async function snapshotState(dest: string): Promise<'none' | 'interrupted' | 'unrecorded' | 'recorded'> {
  const p = snapshotPaths(dest);
  if (await exists(p.op)) return 'interrupted';
  if (!(await stat(dest).then((s) => s.isDirectory(), () => false))) return 'none';
  return (await exists(p.manifest)) ? 'recorded' : 'unrecorded';
}
