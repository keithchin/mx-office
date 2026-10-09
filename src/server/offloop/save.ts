// A file the office saves often, written without blocking the event loop. On Windows a synchronous write
// and rename can take a few hundred ms on a loaded machine (the virus scanner looks at every write; the
// busy office check, 2026-10-08, caught the Ledger's usage.json at 0.4–1 s, the roster at 140 ms, the
// analyzer's classes at 300 ms). write() hands the text to libuv's thread pool (a temporary file, then
// renamed over the real one), one write at a time, a newer text replacing one not yet written; flush()
// writes what's still due at once, synchronously, for the office's exit and the tests, and a background
// write from before it never lands over it.

import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

export class BackgroundFile {
  private due: string | undefined;
  /** The last text handed to write(): what flush() writes when a background write of it is still out. */
  private latest: string | undefined;
  private running = false;
  private syncs = 0;
  private idle: Promise<void> = Promise.resolve();

  constructor(
    readonly file: string,
    private opts: { mode?: number; mkdir?: boolean; onError?: (err: unknown) => void } = {},
  ) {}

  /** Writes `text` soon, in the background. Resolves once nothing is left to write. */
  write(text: string): Promise<void> {
    this.due = text;
    this.latest = text;
    if (!this.running) this.idle = this.drain();
    return this.idle;
  }

  /** Writes whatever is still due (or `text`) now, synchronously. */
  flush(text?: string) {
    const t = text ?? this.due ?? (this.running ? this.latest : undefined);
    this.due = undefined;
    this.syncs++;
    if (t === undefined) return;
    try {
      if (this.opts.mkdir) mkdirSync(path.dirname(this.file), { recursive: true, mode: 0o700 });
      writeFileSync(`${this.file}.tmp`, t, { mode: this.opts.mode ?? 0o600 });
      renameSync(`${this.file}.tmp`, this.file);
    } catch (err) {
      this.opts.onError?.(err); // disk issues shouldn't take the office down
    }
  }

  /** What the file will hold once the writes still out land (undefined when none is). */
  pending(): string | undefined {
    return this.due ?? (this.running ? this.latest : undefined);
  }

  /** Drops what's still to be written: a write still out doesn't land (the file is being removed). */
  cancel() {
    this.due = undefined;
    this.latest = undefined;
    this.syncs++;
  }

  /** Resolves once the background writes are done (tests). */
  settled(): Promise<void> {
    return this.idle;
  }

  private async drain() {
    this.running = true;
    try {
      while (this.due !== undefined) {
        const text = this.due;
        this.due = undefined;
        const gen = this.syncs;
        const tmp = `${this.file}.tmp-bg`;
        try {
          if (this.opts.mkdir) await mkdir(path.dirname(this.file), { recursive: true, mode: 0o700 });
          await writeFile(tmp, text, { mode: this.opts.mode ?? 0o600 });
          // Flushed or cancelled meanwhile: what's there is newer, or is to go.
          if (gen === this.syncs) await renameRetrying(tmp, this.file);
          else await rm(tmp, { force: true });
        } catch (err) {
          this.opts.onError?.(err);
        }
      }
    } finally {
      this.running = false;
    }
  }
}

/**
 * A rename over a file something else has open for a moment (on Windows the virus scanner or the search
 * indexer) fails with EPERM, EBUSY or EACCES: tried again a few times, a few ms apart (as flow/store.ts
 * writeJsonAtomic does in place).
 */
async function renameRetrying(from: string, to: string) {
  for (let i = 0; ; i++) {
    try {
      return await rename(from, to);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (i >= 5 || (code !== 'EPERM' && code !== 'EBUSY' && code !== 'EACCES')) throw err;
      await new Promise((r) => setTimeout(r, 5 * (i + 1)));
    }
  }
}
