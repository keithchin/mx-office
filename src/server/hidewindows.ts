// No console windows for the programs the office starts on Windows. A console program (git, node, gh,
// a fake agent's shim) started by a process that has no console of its own (the pty host, which the
// office starts detached; an office started from a launcher without a window) gets a new console, and
// with Windows Terminal as the default terminal each one opens as a window of its own ("a lot of
// terminals opening up" during a test run, 2026-10-09: node-pty forking its console-list helper from the
// pty host on every agent it stops). `windowsHide: true` starts them without one.
//
// The office's own calls say so where they're written; this covers every other one, a library's
// included (node-pty's fork): from the moment hideChildWindows() runs, child_process's spawn, execFile,
// exec, fork and their Sync forms default `windowsHide` to true on Windows. A call that says
// `windowsHide: false` (opening Studio Pro, a program with a window of its own) keeps it. Elsewhere it
// does nothing. libuv only starts a child windowless when none of its stdio is inherited, so a program
// run in the office's own terminal (stdio 'inherit') is as before.

import cp from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { promisify } from 'node:util';

const DONE = Symbol.for('agent-office.hide-windows');
const NAMES = ['spawn', 'spawnSync', 'execFile', 'execFileSync', 'exec', 'execSync', 'fork'] as const;

const isOptions = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** `args` (a child_process call's arguments) with `windowsHide: true` in its options, unless they say otherwise. */
export function withWindowsHidden(name: (typeof NAMES)[number], args: unknown[]): unknown[] {
  const out = [...args];
  // exec(command, options?, cb?); the others (file, args?, options?, cb?).
  const from = name === 'exec' || name === 'execSync' ? 1 : Array.isArray(out[1]) ? 2 : 1;
  const at = out.findIndex((v, i) => i > 0 && isOptions(v));
  if (at > 0) {
    const o = out[at] as Record<string, unknown>;
    if (o.windowsHide === undefined) out[at] = { ...o, windowsHide: true };
    return out;
  }
  // No options given: an object of our own, before the callback if there is one.
  while (out.length < from) out.push(undefined);
  out.splice(from, out[from] === undefined ? 1 : 0, { windowsHide: true });
  return out;
}

/** The util.promisify form child_process gives exec and execFile ({ stdout, stderr }, `.child` on the promise), over our wrapper. */
function promised(fn: (...a: unknown[]) => cp.ChildProcess) {
  return (...a: unknown[]) => {
    let child: cp.ChildProcess | undefined;
    const p = new Promise((resolve, reject) => {
      child = fn(...a, (err: (Error & { stdout?: unknown; stderr?: unknown }) | null, stdout: unknown, stderr: unknown) =>
        err ? reject(Object.assign(err, { stdout, stderr })) : resolve({ stdout, stderr }),
      );
    });
    return Object.assign(p, { child });
  };
}

/** From now on in this process (or worker thread), child_process starts Windows children without a window (see above). */
export function hideChildWindows(platform: NodeJS.Platform = process.platform): void {
  if (platform !== 'win32') return;
  const m = cp as unknown as Record<string | symbol, unknown>;
  if (m[DONE]) return;
  m[DONE] = true;
  for (const name of NAMES) {
    const orig = m[name] as (...a: unknown[]) => unknown;
    if (typeof orig !== 'function') continue;
    const wrapped = function (this: unknown, ...a: unknown[]) {
      return orig.apply(this, withWindowsHidden(name, a));
    };
    if (name === 'exec' || name === 'execFile') Object.defineProperty(wrapped, promisify.custom, { value: promised(wrapped as never) });
    m[name] = wrapped;
  }
  // `import { spawn } from 'node:child_process'` sees the wrapped ones too.
  syncBuiltinESMExports();
}

hideChildWindows();
