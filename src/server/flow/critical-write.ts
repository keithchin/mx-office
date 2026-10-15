// The acknowledged critical write: a narrow, awaitable JSON write that tells its caller when it didn't
// work, for the few records the office must not lose or half-write (the setup's operation records,
// shared/setup-operations.ts). Everything else (checkpoints, caches) keeps the store's background
// writes (store.ts), which only log a failure, because it can be worked out again.
//
// How: the JSON goes to <file>.<pid>.<n>.tmp, which is flushed to the disk (fsync) and closed, then
// renamed over <file> (tried again a few times when Windows reports the file busy for a moment), then the
// folder is flushed too where the platform lets a folder be opened and synced (best effort: Windows
// usually refuses, and that is not reported as a failure). Any failure before the rename rejects the
// promise and leaves the old file as it was; the temporary file is removed.
//
// DURABILITY: process-crash safe. Once the promise resolves, the new content is in the file and survives
// the office's process stopping at any moment (a crash, a kill, a restart); a crash before it resolves
// leaves either the old content or the new, never half of either. Power loss or an operating-system crash
// is NOT claimed: the file's data is fsynced, but the rename's directory entry is only flushed where the
// platform allows it (not on Windows), and the disk's own write cache is beyond the office's reach.

import { promises as nodeFs } from 'node:fs';
import path from 'node:path';

/** The few file operations the write uses: node:fs/promises, or a test's (to make one fail with EACCES or ENOSPC). */
export interface CriticalFs {
  open(file: string, flags: string, mode?: number): Promise<{ writeFile(data: string): Promise<void>; sync(): Promise<void>; close(): Promise<void> }>;
  rename(from: string, to: string): Promise<void>;
  mkdir(dir: string, opts: { recursive: true; mode?: number }): Promise<unknown>;
  rm(file: string, opts: { force: true }): Promise<void>;
}

export const DURABILITY = 'process-crash safe (file fsynced before an atomic rename; directory fsync best effort; power loss not claimed)';

let seq = 0;
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
const BUSY = new Set(['EPERM', 'EBUSY', 'EACCES']);

/** Writes `value` as JSON to `file`; resolves once it's there, rejects (and leaves the old file) when it isn't. */
export function writeJsonCritical(file: string, value: unknown, fs: CriticalFs = nodeFs as unknown as CriticalFs): Promise<void> {
  return writeTextCritical(file, JSON.stringify(value, null, 2), fs);
}

/** The same for text already made (the roster file's critical flush, roster/store.ts). */
export async function writeTextCritical(file: string, text: string, fs: CriticalFs = nodeFs as unknown as CriticalFs): Promise<void> {
  const dir = path.dirname(file);
  const tmp = `${file}.${process.pid}.${++seq}.tmp`;
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  try {
    const h = await fs.open(tmp, 'w', 0o600);
    try {
      await h.writeFile(text);
      await h.sync();
    } finally {
      await h.close();
    }
    for (let i = 0; ; i++) {
      try {
        await fs.rename(tmp, file);
        break;
      } catch (err) {
        if (i >= 5 || !BUSY.has((err as NodeJS.ErrnoException).code ?? '')) throw err;
        await pause(10 * (i + 1));
      }
    }
  } catch (err) {
    await fs.rm(tmp, { force: true }).catch(() => undefined);
    throw err;
  }
  // The rename's directory entry: flushed where a folder can be opened and synced (not on Windows, usually).
  try {
    const d = await fs.open(dir, 'r');
    try {
      await d.sync();
    } finally {
      await d.close();
    }
  } catch {
    // best effort, see DURABILITY
  }
}
