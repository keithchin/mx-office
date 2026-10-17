// What the office knows about its own stores' files being unreadable (store safety, 2026-10-17): a file
// it couldn't read (locked by a virus scanner or the search indexer past the retries, or refused) is kept
// in a "read failed" state in which every durable writer refuses to write it (write.ts, flow/critical-write.ts,
// flow/store.ts writeJsonAtomic, offloop/save.ts), so a store that started without its data can't save that
// emptiness over the real file. A file whose content was corrupt was moved aside first (read.ts) and is
// only reported. Each problem is told to whoever listens (incidents/store-health.ts raises the incident
// that Needs you shows); with nobody listening yet (the stores are read before the incidents are
// installed) they're kept here and handed over when someone starts listening.
//
// A seam with no imports of the office's own, so any store may use it.

import path from 'node:path';

export type StoreProblemKind = 'locked' | 'corrupt' | 'recovered';

export interface StoreProblem {
  file: string;
  kind: StoreProblemKind;
  /** The error in a person's words ("EBUSY: resource busy or locked", "Unexpected end of JSON input"). */
  error: string;
  /** Where the unreadable content was kept (corrupt only). */
  aside?: string;
  /** What was lost, or where the store started from instead, in words. */
  lost?: string;
  at: number;
}

/** A write the office refused because it couldn't read the file first (the store would have overwritten it). */
export class StoreUnavailableError extends Error {
  readonly code = 'ESTOREUNREAD';
  constructor(
    readonly file: string,
    readonly reason: string,
  ) {
    super(`The office couldn't read ${file} (${reason}); it won't write to it until it can`);
    this.name = 'StoreUnavailableError';
  }
}

const key = (file: string) => {
  const p = path.resolve(file);
  return process.platform === 'win32' ? p.toLowerCase() : p;
};

const problems: StoreProblem[] = [];
const blocked = new Map<string, StoreProblem>();
type Listener = (p: StoreProblem) => void;
const listeners = new Set<Listener>();
const PROBLEMS_KEPT = 200;

/** Records a problem and tells whoever listens; a lock also blocks the file's writes (blockWrites). */
export function noteStoreProblem(p: Omit<StoreProblem, 'at'> & { at?: number }): StoreProblem {
  const full: StoreProblem = { ...p, at: p.at ?? Date.now() };
  problems.push(full);
  if (problems.length > PROBLEMS_KEPT) problems.splice(0, problems.length - PROBLEMS_KEPT);
  if (full.kind === 'locked') blocked.set(key(full.file), full);
  const how = full.kind === 'locked' ? "it won't write to it until it can" : full.aside ? `kept it as ${full.aside}` : 'recovered it';
  console.error(`agent-office: couldn't read ${full.file} (${full.error}); ${how}${full.lost ? `. ${full.lost}` : ''}`);
  for (const fn of listeners) {
    try {
      fn(full);
    } catch (err) {
      console.error(`agent-office: store health: ${(err as Error).message}`);
    }
  }
  return full;
}

/** Every problem so far (newest last), for a listener that starts late and for the tests. */
export function storeProblems(): readonly StoreProblem[] {
  return problems;
}

/** Hears every problem from now on, and those already noted (replayed first). Returns the way to stop. */
export function onStoreProblem(fn: Listener, replay = true): () => void {
  if (replay) for (const p of [...problems]) fn(p);
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** The problem that blocks writes to `file`, if one does. */
export function writeBlocked(file: string): StoreProblem | undefined {
  return blocked.size ? blocked.get(key(file)) : undefined;
}

/** Throws StoreUnavailableError when `file` couldn't be read and so mustn't be written. */
export function assertWritable(file: string) {
  const b = writeBlocked(file);
  if (b) throw new StoreUnavailableError(file, b.error);
}

/** The file was read after all: writes may go ahead again. */
export function unblockWrites(file: string) {
  if (blocked.delete(key(file))) console.error(`agent-office: ${file} can be read again; writes to it go ahead`);
}

/** Forgets everything (tests). */
export function resetStoreHealth() {
  problems.length = 0;
  blocked.clear();
  listeners.clear();
}
