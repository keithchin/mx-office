// Whether the gh the office would really start is a test's fake: test mode never lets Delete project or
// Cancel & undo delete a GitHub repository with anything else. It has to be the program execFile('gh')
// starts, not what a PATHEXT lookup finds: on Windows libuv looks for the name as given, then with .com
// and .exe, never a .cmd or .bat shim. A test office with a gh.cmd fake ahead of the real gh.exe on PATH
// passed the old check (resolveCommand found the shim) while the real gh.exe ran, with whatever GitHub
// token the environment had (2026-10-11).

import { statSync } from 'node:fs';
import path from 'node:path';
import { isTestPath } from '../testmode.js';

const isFile = (p: string) => {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
};

/** The file execFile(`cmd`) would start, looked up as libuv does (no shell, no PATHEXT); undefined when none. */
export function executableOf(cmd: string, env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): string | undefined {
  const win = platform === 'win32';
  const p = win ? path.win32 : path.posix;
  const key = Object.keys(env).find((k) => k.toUpperCase() === 'PATH') ?? 'PATH';
  const dirs = (env[key] ?? '').split(win ? ';' : ':').map((d) => d.replace(/^"|"$/g, '')).filter(Boolean);
  // A name without an extension is only ever tried with .com and .exe (libuv's search_path).
  const names = win ? (p.extname(cmd) ? [cmd] : [`${cmd}.com`, `${cmd}.exe`]) : [cmd];
  // libuv on Windows looks in the current folder first, as CreateProcess does.
  for (const d of win ? [process.cwd(), ...dirs] : dirs) for (const n of names) if (isFile(p.join(d, n))) return p.resolve(d, n);
  return undefined;
}

/** The gh the office starts is a test's fake (in a test office's folder, or named fake). */
export function ghIsFake(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): boolean {
  const gh = executableOf('gh', env, platform);
  return !!gh && (isTestPath(gh) || /fake/i.test(path.basename(path.dirname(gh))) || /fake/i.test(path.basename(gh)));
}
