// Starting things for the workers: which shell, where a command is, how to run one without
// blocking the office, and the install's own bin/ scripts and the commands that run them.
import { accessSync, chmodSync, constants, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { access } from 'node:fs/promises';
import { execFile, execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const WIN = process.platform === 'win32';

/** A script in bin/ of the install this office runs from (src/server/workers under tsx, dist/server/server/workers built). */
/** binScript's finds: the install doesn't move while the office runs, and each look is a few existsSync calls. */
const scripts = new Map<string, string | undefined>();

export function binScript(name: string): string | undefined {
  if (scripts.has(name)) return scripts.get(name);
  const found = findBinScript(name);
  scripts.set(name, found);
  return found;
}

function findBinScript(name: string): string | undefined {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  // One level deeper than server/ itself, so five tries reach the same folders four did from there.
  for (let i = 0; i < 5; i++, dir = path.dirname(dir)) {
    const file = path.join(dir, 'bin', name);
    if (existsSync(file)) return file;
  }
  return undefined;
}

/** The shell workers get when none is configured: $SHELL on Unix, cmd.exe on Windows. */
export function defaultShell(): string {
  return process.env.SHELL || (WIN ? process.env.COMSPEC || 'cmd.exe' : '/bin/bash');
}

/** How to have the default shell run one command line. */
export function shellRun(line: string): string[] {
  return WIN && !process.env.SHELL ? ['/d', '/s', '/c', line] : ['-l', '-i', '-c', line];
}

/**
 * Where a command was found lately, by the command and the PATH it was looked up on. Looking means an
 * accessSync per PATH folder and extension: on a loaded Windows machine (the virus scanner) that held the
 * event loop 60–200 ms, and the analyzer, every floor's worker manager, the judge, the live apps and the
 * Firm each look for claude as they start (the journey's project making, 2026-10-08). A find is trusted
 * for a minute, then checked with one access call (still there: trusted again); a miss (mxcli or psql
 * where they aren't installed) is answered from the last look while a new one runs off the event loop
 * (resolveCommandSoon), so only the very first look at a command walks PATH on the loop.
 */
const found = new Map<string, { at: number; path: string | null; looking?: boolean }>();
const FOUND_MS = 60_000;
const MISSED_MS = 10_000;
const keyOf = (cmd: string) => [cmd, process.env.PATH, process.env.PATHEXT, process.env.SHELL].join('\0');
const hasDir = (cmd: string) => cmd.includes('/') || (WIN && cmd.includes('\\'));

export function resolveCommand(cmd: string): string | null {
  const key = keyOf(cmd);
  const hit = found.get(key);
  if (hit && Date.now() - hit.at < (hit.path ? FOUND_MS : MISSED_MS)) return hit.path;
  if (hit?.path) {
    try {
      accessSync(hit.path, constants.X_OK);
      hit.at = Date.now();
      return hit.path;
    } catch {
      // gone: look again
    }
  } else if (hit) {
    void resolveCommandSoon(cmd);
    return null;
  }
  const p = lookUp(cmd);
  if (found.size > 200) found.clear();
  found.set(key, { at: Date.now(), path: p });
  return p;
}

/**
 * Looks `cmd` up off the event loop (fs/promises over PATH) into resolveCommand's cache. The warm-up does
 * this for the commands the office looks for, so their first synchronous look is a cache hit. Where only
 * the login shell would find it (Unix, nothing on PATH), what was known is kept.
 */
export async function resolveCommandSoon(cmd: string): Promise<void> {
  const key = keyOf(cmd);
  const had = found.get(key);
  if (had?.looking) return;
  if (had) had.looking = true;
  try {
    const exts = WIN && !path.extname(cmd) ? (process.env.PATHEXT || '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean) : [''];
    const usable = async (p: string): Promise<string | null> => {
      for (const ext of exts) if (await access(p + ext, constants.X_OK).then(() => true, () => false)) return p + ext;
      return null;
    };
    let p: string | null = null;
    if (hasDir(cmd)) {
      const f = await usable(cmd);
      p = f && path.resolve(f);
    } else {
      for (const dir of (process.env.PATH || '').split(path.delimiter)) if (dir && (p = await usable(path.join(dir, cmd)))) break;
      if (!p && !(WIN && !process.env.SHELL)) {
        // Only the login shell might know (lookUp's last resort): keep what was known.
        if (had) had.at = Date.now();
        return;
      }
    }
    if (found.size > 200) found.clear();
    found.set(key, { at: Date.now(), path: p });
  } finally {
    if (had) had.looking = false;
  }
}

function lookUp(cmd: string): string | null {
  // Windows runs files by extension: `claude` is really claude.exe / claude.cmd. An npm shim with
  // no extension is a sh script the console can't run, so only take it when asked for by name.
  const exts = WIN && !path.extname(cmd) ? (process.env.PATHEXT || '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean) : [''];
  const usable = (p: string): string | null => {
    for (const ext of exts) {
      try {
        accessSync(p + ext, constants.X_OK);
        return p + ext;
      } catch {
        // keep looking
      }
    }
    return null;
  };
  if (cmd.includes('/') || (WIN && cmd.includes('\\'))) {
    const found = usable(cmd);
    return found && path.resolve(found);
  }
  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    if (!dir) continue;
    const found = usable(path.join(dir, cmd));
    if (found) return found;
  }
  if (WIN && !process.env.SHELL) return null;
  try {
    const found = execFileSync(defaultShell(), ['-l', '-i', '-c', `command -v ${shq(cmd)}`], { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] })
      .trim()
      .split('\n')
      .pop();
    if (found && found.startsWith('/')) return found;
  } catch {
    // fall through
  }
  return null;
}

/** Runs a command without blocking the office (with `env`: as someone else); rejects with the last lines of its stderr. */
export function run(cmd: string, args: string[], cwd: string, timeout = 30_000, env?: Record<string, string>): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { cwd, encoding: 'utf8', timeout, maxBuffer: 4 * 1024 * 1024, env }, (err, stdout, stderr) => {
      if (err) reject(new Error((stderr || err.message).trim().split('\n').filter(Boolean).slice(-2).join(' ') || `${cmd} failed`));
      else resolve(stdout.trim());
    });
  });
}

export function shq(s: string) {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

/**
 * Writes the office-queue and office-workers commands into the data dir's bin/, each running its
 * script in bin/ with the office's own node, and returns that directory. Rewritten on every start,
 * so after an upgrade they run the new install's scripts.
 */
/** The data dirs whose commands this office already wrote (every floor's worker manager asks, as it opens). */
const commandsWritten = new Map<string, string | undefined>();

export function writeOfficeCommands(dataDir: string): string | undefined {
  if (commandsWritten.has(dataDir)) return commandsWritten.get(dataDir);
  const out = writeCommands(dataDir);
  commandsWritten.set(dataDir, out);
  return out;
}

function writeCommands(dataDir: string): string | undefined {
  const dir = path.join(dataDir, 'bin');
  let wrote = false;
  for (const [name, what] of [['office-queue', "Agent Office's task queue, for the board agents"], ['office-workers', "Agent Office's workers, for every worker"]]) {
    const script = binScript(`${name}.js`);
    if (!script) continue;
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const file = path.join(dir, name);
    writeFileSync(file, `#!/bin/sh\n# ${what} (see bin/${name}.js).\nexec ${shq(process.execPath)} ${shq(script)} "$@"\n`, { mode: 0o700 });
    chmodSync(file, 0o700);
    // cmd.exe and PowerShell find it by PATHEXT; Git Bash (Claude Code's shell there) runs the sh one.
    if (WIN) writeFileSync(`${file}.cmd`, `@"${process.execPath}" "${script}" %*\r\n`);
    wrote = true;
  }
  return wrote ? dir : undefined;
}
