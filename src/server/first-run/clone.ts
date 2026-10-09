// First-run setup's Toolkit step: cloning the mxcli project toolkit. git runs off the event loop
// (offloop/exec.ts spawnOff) with no prompts (GIT_TERMINAL_PROMPT=0, so a private repository fails
// instead of waiting for a password nobody can type), and what it prints is handed on a line at a time
// (git's \r progress too) for the page to show as it comes. One clone at a time.

import { existsSync, readdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { cloneUrlProblem, type CloneEvent } from '../../shared/first-run.js';
import { spawnOff } from '../offloop/exec.js';
import { toolkitProblem } from '../connections/paths.js';
import { redactor } from '../wizard/admin-token.js';

let busy = false;

const untilde = (s: string) => s.replace(/^~(?=$|[\\/])/, os.homedir());

/** Where a clone may go: a full path to a folder that isn't there yet, or is empty. */
export function cloneDirProblem(raw: string): { dir?: string; problem?: string } {
  const text = untilde(raw.trim().replace(/^"|"$/g, ''));
  if (!text || !path.isAbsolute(text)) return { problem: 'Use a full path for the toolkit folder, like ~/mendix-toolkit' };
  const dir = path.resolve(text);
  if (existsSync(dir)) {
    try {
      if (readdirSync(dir).length) return { problem: `${dir} isn’t empty: pick it as an existing folder instead, or another one` };
    } catch {
      return { problem: `${dir} is there and isn’t a folder` };
    }
  }
  return { dir };
}

export interface CloneDeps {
  spawn: typeof spawnOff;
  /** Whether the clone is the toolkit (bin/init-project.sh): undefined when it is. */
  check: (dir: string) => string | undefined;
  timeoutMs: number;
}

/**
 * Clones `url` into `rawDir`, telling `emit` each line git prints and how it ended. Resolves with the
 * folder when it worked and is the toolkit, else undefined (the last event says why).
 */
export async function cloneToolkit(url: string, rawDir: string, emit: (e: CloneEvent) => void, deps: Partial<CloneDeps> = {}): Promise<string | undefined> {
  const d: CloneDeps = { spawn: spawnOff, check: toolkitProblem, timeoutMs: 10 * 60_000, ...deps };
  const fail = (error: string) => (emit({ t: 'done', ok: false, error }), undefined);
  const bad = cloneUrlProblem(url);
  if (bad) return fail(bad);
  const { dir, problem } = cloneDirProblem(rawDir);
  if (!dir) return fail(problem!);
  if (busy) return fail('A clone is already running');
  busy = true;
  const hide = redactor([]);
  try {
    const code = await new Promise<number | null>((resolve) => {
      const child = d.spawn('git', ['clone', '--progress', '--', url.trim(), dir], { env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never' }, windowsHide: true });
      let tail = '';
      const take = (chunk: string | Uint8Array) => {
        tail += String(chunk);
        const parts = tail.split(/\r\n|\r|\n/);
        tail = parts.pop() ?? '';
        for (const p of parts) if (p.trim()) emit({ t: 'line', text: hide(p.trim()).slice(0, 300) });
      };
      child.on('stdout', take);
      child.on('stderr', take);
      const timer = setTimeout(() => child.kill(), d.timeoutMs);
      child.on('error', (e: Error) => emit({ t: 'line', text: e.message }));
      child.on('close', (c: number | null) => {
        clearTimeout(timer);
        if (tail.trim()) emit({ t: 'line', text: hide(tail.trim()).slice(0, 300) });
        resolve(c);
      });
    });
    if (code !== 0) return fail(`git clone failed${code === null ? ' (stopped)' : ` (exit ${code})`}: check the URL, and that this machine can reach it`);
    const notToolkit = d.check(dir);
    if (notToolkit) return fail(notToolkit);
    emit({ t: 'done', ok: true, dir });
    return dir;
  } finally {
    busy = false;
  }
}
