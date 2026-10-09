// Fake agents and fake gh for the tests are `#!/usr/bin/env node` scripts, which Windows can't run by
// themselves. `runnable(file)` makes such a script runnable where the office would look for it: on
// Windows, `<file>.exe` beside it, a tiny shim that runs `node <file> <args…>` (a .cmd wrapper won't
// do: cmd.exe cuts a multi-line prompt argument at its first line, and the office starts agents
// without a shell). Elsewhere it only makes the script executable.
//
// The shim is compiled once (with the .NET Framework's csc, which every Windows has) into the temp
// folder, and each `<file>.exe` is a hard link to it, so the virus scanner checks one file, once.
import { execFileSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, linkSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';

export const isWin = process.platform === 'win32';

// The shim's source, beside this file.
const SHIM_CS = readFileSync(fileURLToPath(new URL('./shim.cs', import.meta.url)), 'utf8');

let compiled: string | undefined;

function csc(): string {
  const root = path.join(process.env.WINDIR ?? 'C:\\Windows', 'Microsoft.NET');
  for (const fw of ['Framework64', 'Framework']) {
    const p = path.join(root, fw, 'v4.0.30319', 'csc.exe');
    if (existsSync(p)) return p;
  }
  throw new Error('no csc.exe (.NET Framework 4) to build the test shim with');
}

/** The compiled shim, made once per version of its source (shared by test files running at once). */
function shimExe(): string {
  if (compiled) return compiled;
  const dir = path.join(os.tmpdir(), 'agent-office-test-shim');
  const exe = path.join(dir, `shim-${createHash('sha256').update(SHIM_CS).digest('hex').slice(0, 12)}.exe`);
  if (!existsSync(exe)) {
    mkdirSync(dir, { recursive: true });
    const tmp = path.join(dir, `build-${process.pid}-${Date.now()}`);
    mkdirSync(tmp, { recursive: true });
    writeFileSync(path.join(tmp, 'shim.cs'), SHIM_CS);
    execFileSync(csc(), ['/nologo', '/optimize', `/out:${path.join(tmp, 'shim.exe')}`, path.join(tmp, 'shim.cs')], { stdio: 'pipe', windowsHide: true });
    try {
      renameSync(path.join(tmp, 'shim.exe'), exe);
    } catch {
      // Another test file built it first.
    }
    rmSync(tmp, { recursive: true, force: true });
  }
  // The shim finds node through this (the tests' own node, whatever PATH a test sets).
  process.env.TEST_SHIM_NODE ??= process.execPath;
  return (compiled = exe);
}

/** Makes the node script at `file` runnable as a command (see above). Returns `file`. */
export function runnable(file: string): string {
  if (!isWin) {
    chmodSync(file, 0o755);
    return file;
  }
  const exe = `${file}.exe`;
  rmSync(exe, { force: true });
  try {
    linkSync(shimExe(), exe);
  } catch {
    copyFileSync(shimExe(), exe);
  }
  return file;
}
