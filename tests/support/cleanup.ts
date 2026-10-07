// Removing a test's temporary folder on Windows. There a folder can't go while a process still has
// it as its working directory or a file in it open, and the processes a test started (a worker's
// terminal, its pty host) are told to stop by an `after` hook that often runs after the one removing
// the folder. `removeDir` tries now, and when Windows says the folder is still in use, tries again
// once the test file is done (before it exits), for a few seconds, so nothing is left behind and no
// test fails over its own cleanup.
import { rmSync } from 'node:fs';

const later = new Set<string>();
let hooked = false;

const busy = (err: unknown) => ['EPERM', 'EBUSY', 'ENOTEMPTY', 'EACCES'].includes((err as NodeJS.ErrnoException)?.code ?? '');

function sleepSync(ms: number) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function finish(sync: boolean): Promise<void> | void {
  const tryAll = () => {
    for (const dir of [...later]) {
      try {
        rmSync(dir, { recursive: true, force: true });
        later.delete(dir);
      } catch {
        // still in use
      }
    }
  };
  if (sync) {
    for (let i = 0; i < 25 && later.size; i++) {
      tryAll();
      if (later.size) sleepSync(200);
    }
    return;
  }
  return (async () => {
    for (let i = 0; i < 50 && later.size; i++) {
      tryAll();
      if (later.size) await new Promise((r) => setTimeout(r, 200));
    }
  })();
}

/** Removes `dir` now, or as soon as Windows lets go of it (see above). */
export function removeDir(dir: string) {
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 2, retryDelay: 50 });
    return;
  } catch (err) {
    if (!busy(err)) throw err;
  }
  later.add(dir);
  if (hooked) return;
  hooked = true;
  let running: Promise<void> | void;
  process.on('beforeExit', () => {
    if (later.size && !running) running = (finish(false) as Promise<void>).finally(() => (running = undefined));
  });
  process.on('exit', () => finish(true));
}
