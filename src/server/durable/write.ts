// Writing a whole-file store so a crash, a power cut or a locked file never leaves half of it (store
// safety, 2026-10-17): the text goes to a temporary file of its own in the same folder (<file>.<pid>.<n>.tmp),
// is flushed to the disk (fsync), then renamed over the file, tried again a few times when Windows says the
// file is busy (a virus scanner or the search indexer holding it for a moment). With `bak`, the file as it
// was is copied to <file>.bak first, which read.ts starts from if the file itself is ever lost or corrupt.
// A file the office couldn't read is never written (health.ts): the write throws StoreUnavailableError.
//
// The sync write is for start-up and the office's exit; everything else uses the async one (or a
// BackgroundFile, offloop/save.ts, which writes the same way off the event loop).

import { closeSync, copyFileSync, fsyncSync, mkdirSync, openSync, renameSync, rmSync, writeSync } from 'node:fs';
import { copyFile } from 'node:fs/promises';
import path from 'node:path';
import { writeTextCritical } from '../flow/critical-write.js';
import { assertWritable } from './health.js';
import { codeOf, TRANSIENT } from './read.js';

let seq = 0;
const sleepSync = (ms: number) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

export interface DurableWriteOpts {
  /** Keep the file as it was in <file>.bak before replacing it. */
  bak?: boolean;
  mode?: number;
}

function writeTmpSync(tmp: string, text: string, mode: number) {
  const fd = openSync(tmp, 'w', mode);
  try {
    writeSync(fd, text);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

/** Writes `text` to `file` now, on the event loop (start-up, the office's exit, tests). Throws when it can't. */
export function writeTextDurableSync(file: string, text: string, opts: DurableWriteOpts = {}) {
  assertWritable(file);
  const tmp = `${file}.${process.pid}.${++seq}.tmp`;
  const mode = opts.mode ?? 0o600;
  try {
    try {
      writeTmpSync(tmp, text, mode);
    } catch (err) {
      if (codeOf(err) !== 'ENOENT') throw err;
      mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
      writeTmpSync(tmp, text, mode);
    }
    if (opts.bak) {
      try {
        copyFileSync(file, `${file}.bak`);
      } catch {
        // no file yet (or the copy failed): the write itself matters more
      }
    }
    for (let i = 0; ; i++) {
      try {
        renameSync(tmp, file);
        return;
      } catch (err) {
        if (i >= 5 || !TRANSIENT.has(codeOf(err))) throw err;
        sleepSync(10 * (i + 1));
      }
    }
  } catch (err) {
    rmSync(tmp, { force: true });
    throw err;
  }
}

export function writeJsonDurableSync(file: string, value: unknown, opts: DurableWriteOpts = {}) {
  writeTextDurableSync(file, JSON.stringify(value, null, 2), opts);
}

/** The same off the event loop (flow/critical-write.ts does the fsync and rename). Rejects when it can't. */
export async function writeTextDurable(file: string, text: string, opts: DurableWriteOpts = {}): Promise<void> {
  assertWritable(file);
  if (opts.bak) await copyFile(file, `${file}.bak`).catch(() => undefined);
  await writeTextCritical(file, text);
}

export function writeJsonDurable(file: string, value: unknown, opts: DurableWriteOpts = {}): Promise<void> {
  return writeTextDurable(file, JSON.stringify(value, null, 2), opts);
}

/** Removes a store's file for good, with its backup, so read.ts can't bring it back from there. */
export function removeStoreFileSync(file: string) {
  for (const f of [file, `${file}.bak`]) rmSync(f, { force: true });
}
