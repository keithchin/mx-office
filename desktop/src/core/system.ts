// What the app checks before it starts an office, and where it writes: the system Node (on PATH, or
// MX_OFFICE_NODE / --node), new enough; the office checkout and its build (bin/agent-office.js and
// dist/server/server/cli.js, what `npm start` runs); the office's log in its data folder, kept to a size,
// and its last lines for the crash screen; the port, free or not. Node only, no Electron.

import { execFile } from 'node:child_process';
import { closeSync, existsSync, openSync, readFileSync, readSync, renameSync, statSync, fstatSync, mkdirSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';

/** The oldest Node the office runs on (scripts/start-office.ps1 asks the same). */
export const NODE_MIN = '22.5.0';

/** The first `name` on PATH (with PATHEXT's extensions on Windows), or undefined. */
export function findOnPath(name: string, env: Record<string, string | undefined>, platform: string = process.platform, exists: (f: string) => boolean = existsSync): string | undefined {
  const win = platform === 'win32';
  const sep = win ? ';' : ':';
  const dirs = (env.PATH ?? env.Path ?? '').split(sep).filter(Boolean);
  const exts = win ? ['.exe', ...(env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD').split(';').map((e) => e.toLowerCase()).filter((e) => e && e !== '.exe')] : [''];
  for (const d of dirs) {
    for (const e of exts) {
      const f = path.join(d.replace(/^"|"$/g, ''), name + e);
      if (exists(f)) return f;
    }
  }
  return undefined;
}

/** Whether version `v` ("v22.11.0", "24.1.0") is at least `min`. */
export function atLeast(v: string, min: string = NODE_MIN): boolean {
  const a = v.replace(/^v/, '').split('.').map((x) => parseInt(x, 10) || 0);
  const b = min.split('.').map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < 3; i++) if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0);
  return true;
}

/** A Node's version, by running it; undefined when it doesn't run. */
export function nodeVersion(node: string): Promise<string | undefined> {
  return new Promise((resolve) => {
    // A .cmd shim needs a shell on Windows; node.exe doesn't.
    execFile(node, ['-p', 'process.versions.node'], { timeout: 15_000, windowsHide: true, shell: /\.(cmd|bat)$/i.test(node) }, (err, out) => resolve(err ? undefined : String(out).trim() || undefined));
  });
}

export type Problem =
  | { kind: 'no-node' }
  | { kind: 'old-node'; node: string; version: string }
  | { kind: 'no-checkout'; tried: string[] }
  | { kind: 'not-built'; dir: string };

/** Whether `dir` is an office checkout (its package.json is agent-office's). */
export function isOfficeDir(dir: string, read: (f: string) => string = (f) => readFileSync(f, 'utf8')): boolean {
  try {
    return JSON.parse(read(path.join(dir, 'package.json'))).name === 'agent-office';
  } catch {
    return false;
  }
}

/**
 * The office checkout: the one given, else the one remembered, else the first agent-office package at or
 * above any of `near` (the app's own folder: desktop/ in a checkout, or a packaged app kept inside one).
 */
export function findOfficeDir(o: { given?: string; remembered?: string; near: string[] }, isOffice: (d: string) => boolean = (d) => isOfficeDir(d)): { dir?: string; tried: string[] } {
  const tried: string[] = [];
  for (const d of [o.given, o.remembered]) {
    if (!d) continue;
    tried.push(d);
    if (isOffice(d)) return { dir: d, tried };
  }
  for (const start of o.near) {
    let d = path.resolve(start);
    for (let i = 0; i < 8; i++) {
      if (!tried.includes(d)) tried.push(d);
      if (isOffice(d)) return { dir: d, tried };
      const up = path.dirname(d);
      if (up === d) break;
      d = up;
    }
  }
  return { tried };
}

/** What `npm start` runs, and the build it needs. */
export const officeEntry = (dir: string) => path.join(dir, 'bin', 'agent-office.js');
export const isBuilt = (dir: string, exists: (f: string) => boolean = existsSync) => exists(officeEntry(dir)) && exists(path.join(dir, 'dist', 'server', 'server', 'cli.js'));

/** The office's log, in its data folder. */
export const logFileOf = (dataDir: string) => path.join(dataDir, 'desktop-office.log');
export const LOG_MAX_BYTES = 5 * 1024 * 1024;

/** Opens the log to append to (the last one moved to .1 once it's over LOG_MAX_BYTES); returns its fd. */
export function openLog(file: string): number {
  mkdirSync(path.dirname(file), { recursive: true });
  try {
    if (statSync(file).size > LOG_MAX_BYTES) renameSync(file, `${file}.1`);
  } catch {
    // no log yet
  }
  return openSync(file, 'a');
}

/** The last `lines` lines of a file (from its last 64 KB), or ''. */
export function tailOf(file: string, lines = 40): string {
  let fd: number | undefined;
  try {
    fd = openSync(file, 'r');
    const size = fstatSync(fd).size;
    const len = Math.min(size, 64 * 1024);
    const buf = Buffer.alloc(len);
    readSync(fd, buf, 0, len, size - len);
    return lastLines(buf.toString('utf8'), lines);
  } catch {
    return '';
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

/** The last `n` non-empty-at-the-end lines of a text. */
export function lastLines(text: string, n: number): string {
  return text.replace(/\s+$/, '').split(/\r?\n/).slice(-n).join('\n');
}

/** Whether something accepts connections on the port (127.0.0.1). */
export function portOpen(port: number, host = '127.0.0.1', timeoutMs = 800): Promise<boolean> {
  return new Promise((resolve) => {
    const s = net.connect({ port, host });
    const done = (v: boolean) => {
      s.destroy();
      resolve(v);
    };
    s.setTimeout(timeoutMs, () => done(false));
    s.once('connect', () => done(true));
    s.once('error', () => done(false));
  });
}
