// Disk load for the busy office (PERF_BUSY_LOAD=<n>): n processes that write, rename and read small
// .js files in a folder of the test office as fast as they can, so the virus scanner is busy the way it
// is on a machine with builds running (the live office's laptop with three Mendix builds, 2026-10-08),
// and every file the office opens waits behind it. A synchronous read or write on the office's event
// loop then shows up as a block in the busy check, every run, not only when the machine happens to be
// loaded.
//
//   startDiskLoad(dir, n) → stop()        (the busy suite)
//   node scripts/perf/diskload.mjs <dir>   (one hammer; what startDiskLoad runs n of)
import { fork } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SELF = fileURLToPath(import.meta.url);

/** Starts `n` hammers in `dir` (made if missing). Returns what stops them; they also stop when this process ends. */
export function startDiskLoad(dir, n) {
  fs.mkdirSync(dir, { recursive: true });
  const kids = Array.from({ length: n }, (_, i) => fork(SELF, [path.join(dir, `load${i}`)], { stdio: 'ignore' }));
  return () => {
    for (const k of kids) k.kill();
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === SELF) {
  const dir = process.argv[2];
  fs.mkdirSync(dir, { recursive: true });
  const buf = Buffer.alloc(64 * 1024, 'x');
  // Ends with its parent: the IPC channel closes when the busy suite exits, however it exits.
  process.on('disconnect', () => process.exit(0));
  const step = () => {
    for (let i = 0; i < 50; i++) {
      const f = path.join(dir, `f${i % 400}.js`);
      try {
        fs.writeFileSync(`${f}.tmp`, buf);
        fs.renameSync(`${f}.tmp`, f);
        fs.readFileSync(f);
      } catch {
        // a file the scanner holds: the next one
      }
    }
    setImmediate(step);
  };
  step();
}
