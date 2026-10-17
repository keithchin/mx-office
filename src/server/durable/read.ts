// Reading a whole-file JSON store safely (store safety, 2026-10-17). Before this, most stores read any
// failure as "start empty", and their next save made the emptiness permanent: a virus scanner holding
// floors.json for a moment at start-up lost every project. Here only a missing file (ENOENT) is empty:
//
// - locked or refused (EBUSY, EPERM, EACCES, a Windows UNKNOWN): tried again a few times with a growing
//   pause; still failing, or any other error, the file is put in the "read failed" state (health.ts: every
//   durable writer refuses to write it, and an incident says so) and StoreUnavailableError is thrown, so
//   the store starts without its data but can never save that over the file;
// - corrupt (not JSON, or empty): the file is moved aside to <file>.corrupt-<time>, never deleted, and the
//   store starts from the newest backup or temporary file beside it that is whole (<file>.bak, a write's
//   <file>.tmp / .tmp-bg / .<pid>.<n>.tmp), else empty; the incident names the aside file and says which;
// - missing, but a backup or temporary file is there (a crash between a write and its rename, or the file
//   removed by hand): the store starts from it, put back as the file, and that is reported too.
//
// The sync reader is for the stores read once at start-up; the async one for those read lazily per floor.

import { copyFileSync, readFileSync, readdirSync, renameSync, statSync } from 'node:fs';
import { copyFile, readFile, readdir, rename, stat } from 'node:fs/promises';
import path from 'node:path';
import { noteStoreProblem, StoreUnavailableError, unblockWrites, writeBlocked } from './health.js';

export type JsonRead = { state: 'ok'; value: unknown; recoveredFrom?: string } | { state: 'missing'; aside?: string };

export const TRANSIENT = new Set(['EBUSY', 'EPERM', 'EACCES', 'UNKNOWN']);
/** The pauses between tries of a locked read: about 0.8 s in all. */
export const READ_RETRY_MS = [25, 50, 100, 200, 400];

/** A test's way to make reads of some files fail (an EBUSY that never clears, say); undefined lets them through. */
let fault: ((file: string) => NodeJS.ErrnoException | undefined) | undefined;
export function injectReadFault(fn: typeof fault) {
  fault = fn;
}
export function readFault(file: string): NodeJS.ErrnoException | undefined {
  return fault?.(file);
}

export const codeOf = (err: unknown) => (err as NodeJS.ErrnoException)?.code ?? '';
const describe = (err: unknown) => (err as Error)?.message ?? String(err);
const sleepSync = (ms: number) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const stamp = () => new Date().toISOString().replace(/[:.]/g, '-');

/** <file>.corrupt-<time>: where unreadable content is kept. */
export const asideName = (file: string) => `${file}.corrupt-${stamp()}`;

/** The files beside `file` a crashed or earlier write may have left: its backup and its temporary files. */
export function isLeftover(base: string, name: string): boolean {
  if (!name.startsWith(`${base}.`)) return false;
  const rest = name.slice(base.length + 1);
  return rest === 'bak' || rest === 'tmp' || rest === 'tmp-bg' || /^\d+\.\d+\.tmp$/.test(rest);
}

/** Parses JSON, an empty file counting as corrupt. */
function parse(text: string): { ok: true; value: unknown } | { ok: false; error: string } {
  if (!text.trim()) return { ok: false, error: 'the file is empty' };
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch (err) {
    return { ok: false, error: describe(err) };
  }
}

function locked(file: string, err: unknown): never {
  const error = describe(err);
  noteStoreProblem({ file, kind: 'locked', error });
  throw new StoreUnavailableError(file, error);
}

function ok(file: string, value: unknown, recoveredFrom?: string): JsonRead {
  if (writeBlocked(file)) unblockWrites(file);
  return { state: 'ok', value, ...(recoveredFrom ? { recoveredFrom } : {}) };
}

// ---- sync ---------------------------------------------------------------------------------------------

function readTextSync(file: string): string | undefined {
  for (let i = 0; ; i++) {
    try {
      const f = fault?.(file);
      if (f) throw f;
      return readFileSync(file, 'utf8');
    } catch (err) {
      if (codeOf(err) === 'ENOENT') return undefined;
      if (!TRANSIENT.has(codeOf(err)) || i >= READ_RETRY_MS.length) locked(file, err);
      sleepSync(READ_RETRY_MS[i]);
    }
  }
}

/** The newest whole leftover beside `file`, put back as the file. */
function recoverSync(file: string): { value: unknown; from: string } | undefined {
  const dir = path.dirname(file);
  const base = path.basename(file);
  let names: string[];
  try {
    names = readdirSync(dir).filter((n) => isLeftover(base, n));
  } catch {
    return undefined;
  }
  const found = names
    .map((n) => {
      try {
        return { n, at: statSync(path.join(dir, n)).mtimeMs };
      } catch {
        return { n, at: 0 };
      }
    })
    .sort((a, b) => b.at - a.at);
  for (const { n } of found) {
    const from = path.join(dir, n);
    let text: string;
    try {
      text = readFileSync(from, 'utf8');
    } catch {
      continue;
    }
    const p = parse(text);
    if (!p.ok) continue;
    try {
      if (n.endsWith('.bak')) copyFileSync(from, file);
      else renameSync(from, file);
    } catch {
      // Used from memory; the store's next save writes the file.
    }
    return { value: p.value, from };
  }
  return undefined;
}

function moveAsideSync(file: string): string {
  const aside = asideName(file);
  for (let i = 0; ; i++) {
    try {
      renameSync(file, aside);
      return aside;
    } catch (err) {
      if (!TRANSIENT.has(codeOf(err)) || i >= READ_RETRY_MS.length) {
        // Can't move it: copy it, so the store's next save can't lose it.
        copyFileSync(file, aside);
        return aside;
      }
      sleepSync(READ_RETRY_MS[i]);
    }
  }
}

/** Reads `file` as JSON (see the top of this file). Throws StoreUnavailableError when it can't be read. */
export function readJsonStoreSync(file: string): JsonRead {
  const text = readTextSync(file);
  if (text === undefined) {
    const r = recoverSync(file);
    if (!r) return { state: 'missing' };
    noteStoreProblem({ file, kind: 'recovered', error: 'the file was missing', lost: `Started from ${path.basename(r.from)}, left by an earlier write` });
    return ok(file, r.value, r.from);
  }
  const p = parse(text);
  if (p.ok) return ok(file, p.value);
  let aside: string;
  try {
    aside = moveAsideSync(file);
  } catch (err) {
    locked(file, err);
  }
  const r = recoverSync(file);
  noteStoreProblem({ file, kind: 'corrupt', error: p.error, aside, lost: r ? `Started from ${path.basename(r.from)}; anything saved after it is lost` : 'Nothing whole was left beside it, so it started empty' });
  return r ? ok(file, r.value, r.from) : { state: 'missing', aside };
}

// ---- async --------------------------------------------------------------------------------------------

async function readText(file: string): Promise<string | undefined> {
  for (let i = 0; ; i++) {
    try {
      const f = fault?.(file);
      if (f) throw f;
      return await readFile(file, 'utf8');
    } catch (err) {
      if (codeOf(err) === 'ENOENT') return undefined;
      if (!TRANSIENT.has(codeOf(err)) || i >= READ_RETRY_MS.length) locked(file, err);
      await sleep(READ_RETRY_MS[i]);
    }
  }
}

async function recover(file: string): Promise<{ value: unknown; from: string } | undefined> {
  const dir = path.dirname(file);
  const base = path.basename(file);
  let names: string[];
  try {
    names = (await readdir(dir)).filter((n) => isLeftover(base, n));
  } catch {
    return undefined;
  }
  if (!names.length) return undefined;
  const found = await Promise.all(names.map(async (n) => ({ n, at: await stat(path.join(dir, n)).then((s) => s.mtimeMs, () => 0) })));
  for (const { n } of found.sort((a, b) => b.at - a.at)) {
    const from = path.join(dir, n);
    const text = await readFile(from, 'utf8').catch(() => undefined);
    if (text === undefined) continue;
    const p = parse(text);
    if (!p.ok) continue;
    await (n.endsWith('.bak') ? copyFile(from, file) : rename(from, file)).catch(() => undefined);
    return { value: p.value, from };
  }
  return undefined;
}

async function moveAside(file: string): Promise<string> {
  const aside = asideName(file);
  for (let i = 0; ; i++) {
    try {
      await rename(file, aside);
      return aside;
    } catch (err) {
      if (!TRANSIENT.has(codeOf(err)) || i >= READ_RETRY_MS.length) {
        await copyFile(file, aside);
        return aside;
      }
      await sleep(READ_RETRY_MS[i]);
    }
  }
}

/** The same, off the event loop. Rejects with StoreUnavailableError when the file can't be read. */
export async function readJsonStore(file: string): Promise<JsonRead> {
  const text = await readText(file);
  if (text === undefined) {
    const r = await recover(file);
    if (!r) return { state: 'missing' };
    noteStoreProblem({ file, kind: 'recovered', error: 'the file was missing', lost: `Started from ${path.basename(r.from)}, left by an earlier write` });
    return ok(file, r.value, r.from);
  }
  const p = parse(text);
  if (p.ok) return ok(file, p.value);
  let aside: string;
  try {
    aside = await moveAside(file);
  } catch (err) {
    locked(file, err);
  }
  const r = await recover(file);
  noteStoreProblem({ file, kind: 'corrupt', error: p.error, aside, lost: r ? `Started from ${path.basename(r.from)}; anything saved after it is lost` : 'Nothing whole was left beside it, so it started empty' });
  return r ? ok(file, r.value, r.from) : { state: 'missing', aside };
}

/**
 * For a store that reads a file lazily into a cached promise: `revive` gets the value, or undefined when
 * the file is missing (or was corrupt and nothing whole was beside it). When it can't be read the promise
 * rejects and `forget` drops it from the cache, so the next use reads again rather than starting empty.
 */
export function loadJson<T>(file: string, revive: (v: unknown) => T, forget?: () => void): Promise<T> {
  return readJsonStore(file).then(
    (r) => revive(r.state === 'ok' ? r.value : undefined),
    (err) => {
      forget?.();
      throw err;
    },
  );
}

/**
 * A drop-in for `JSON.parse(readFileSync(file, 'utf8'))` in a store whose catch starts it with its defaults:
 * the value (or the one recovered beside a corrupt file, which was moved aside); otherwise it throws, an
 * ENOENT error when there's nothing (the catch's "none yet"), StoreUnavailableError when the file couldn't
 * be read (the catch starts with the defaults, but its writes are refused, so they can't replace the file).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function parseStoreSync(file: string): any {
  const r = readJsonStoreSync(file);
  if (r.state === 'ok') return r.value;
  throw Object.assign(new Error(`ENOENT: no such file or directory, open '${file}'`), { code: 'ENOENT' });
}

/** The value read, or `fallback` when the file is missing (a corrupt one already moved aside). */
export const valueOr = <T>(r: JsonRead, fallback: T): unknown => (r.state === 'ok' ? r.value : fallback);
