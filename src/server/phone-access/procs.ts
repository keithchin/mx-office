// The tunnel CLIs as child processes: a short command that answers and exits (`run`), and one that keeps
// going (`spawn`: `devtunnel host`, `cloudflared tunnel run`). Both are interfaces, so the tests hand in
// fakes and never start a real CLI or open a real tunnel. Never through a shell: arguments go as they are.

import { spawn as nodeSpawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** A running CLI: what it prints (stdout and stderr together), when it ends, and how to stop it. */
export interface Proc {
  onOutput(fn: (text: string) => void): void;
  onExit(fn: (code: number | null) => void): void;
  kill(): void;
}

export interface Procs {
  /** Starts a long-running CLI. */
  spawn(cmd: string, args: readonly string[]): Proc;
  /** Runs a short one to its end (or `timeoutMs`), with everything it printed. */
  run(cmd: string, args: readonly string[], timeoutMs?: number): Promise<{ code: number | null; out: string }>;
  /** Where a tool is on this machine, if it is. */
  find(tool: 'devtunnel' | 'cloudflared'): string | undefined;
}

/** Where each CLI usually is on Windows when it isn't on PATH (cloudflared's MSI, winget's links). */
function knownPlaces(tool: 'devtunnel' | 'cloudflared', env: NodeJS.ProcessEnv): string[] {
  const local = env.LOCALAPPDATA ?? path.join(os.homedir(), 'AppData', 'Local');
  if (tool === 'cloudflared') return [path.join(env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)', 'cloudflared', 'cloudflared.exe'), path.join(env.ProgramFiles ?? 'C:\\Program Files', 'cloudflared', 'cloudflared.exe')];
  return [path.join(local, 'Microsoft', 'WinGet', 'Links', 'devtunnel.exe'), path.join(local, 'Microsoft', 'DevTunnels', 'devtunnel.exe')];
}

/** The tool on PATH, else where its installer usually puts it. AGENT_OFFICE_DEVTUNNEL / _CLOUDFLARED point elsewhere. */
export function findTool(tool: 'devtunnel' | 'cloudflared', env: NodeJS.ProcessEnv = process.env): string | undefined {
  const override = env[`AGENT_OFFICE_${tool.toUpperCase()}`];
  if (override) return existsSync(override) ? override : undefined;
  const exts = process.platform === 'win32' ? ['.exe', '.cmd', ''] : [''];
  for (const dir of (env.PATH ?? env.Path ?? '').split(path.delimiter).filter(Boolean)) {
    for (const ext of exts) {
      const f = path.join(dir, tool + ext);
      if (existsSync(f)) return f;
    }
  }
  return knownPlaces(tool, env).find((f) => existsSync(f));
}

const KEEP_CHARS = 64 * 1024;

export const systemProcs: Procs = {
  spawn(cmd, args) {
    // .cmd shims can't be started without a shell on Windows; the CLIs here are real .exe files.
    const child = nodeSpawn(cmd, [...args], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: process.env });
    const outs: ((t: string) => void)[] = [];
    const exits: ((c: number | null) => void)[] = [];
    const emit = (b: Buffer) => outs.forEach((f) => f(b.toString('utf8')));
    child.stdout?.on('data', emit);
    child.stderr?.on('data', emit);
    let done = false;
    const end = (code: number | null) => {
      if (done) return;
      done = true;
      exits.forEach((f) => f(code));
    };
    child.on('exit', (code) => end(code));
    child.on('error', (err) => {
      outs.forEach((f) => f(`\n${err.message}\n`));
      end(-1);
    });
    return {
      onOutput: (fn) => void outs.push(fn),
      onExit: (fn) => void exits.push(fn),
      kill: () => void (done || child.kill()),
    };
  },
  run(cmd, args, timeoutMs = 60_000) {
    return new Promise((resolve) => {
      let out = '';
      const p = this.spawn(cmd, args);
      const timer = setTimeout(() => p.kill(), timeoutMs);
      p.onOutput((t) => (out = (out + t).slice(-KEEP_CHARS)));
      p.onExit((code) => {
        clearTimeout(timer);
        resolve({ code, out });
      });
    });
  },
  find: (tool) => findTool(tool),
};
