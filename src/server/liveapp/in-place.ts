// The live app in place (Expert mode, app.ts `inPlace`): the project folder itself is built and run, the session's
// working copy as it is, uncommitted changes included, the way one runs `mxcli run --watch` in one's own folder.
// No checkout of main, no fetch, no auto-refresh: mxcli's watch sees the model change and reloads the running app,
// and the office only reads what it says (hot.ts watchLine) to mark the served reload. This module is what app.ts
// needs to say which commit the folder is on.

import { execFileOff } from '../offloop/exec.js';
import type { LiveUpdate } from '../../shared/protocol.js';

const git = (args: string[], cwd: string) =>
  new Promise<string>((resolve) => {
    execFileOff('git', args, { cwd, timeout: 15_000, windowsHide: true, env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0' } }, (err, stdout) => resolve(err ? '' : String(stdout).trim()));
  });

/** The folder's branch, HEAD commit and its subject (a folder with no commit yet says so with zeros). */
export async function floorHead(dir: string): Promise<{ branch?: string; sha: string; subject?: string }> {
  const [branch, line] = await Promise.all([git(['symbolic-ref', '--quiet', '--short', 'HEAD'], dir), git(['log', '-1', '--format=%H%x00%s'], dir)]);
  const [sha, subject] = line.split('\0');
  return { ...(branch ? { branch } : {}), sha: /^[0-9a-f]{40}$/.test(sha ?? '') ? sha : '0'.repeat(40), ...(subject ? { subject: subject.slice(0, 300) } : {}) };
}

/** How a reload mxcli's watch applied by itself reads on the page ("Updated in 3 s (hot reload)"). */
export function watchedUpdate(at: number, secs: number | undefined, how: 'reload' | 'restart'): LiveUpdate {
  const ms = Math.round((secs ?? 0) * 1000);
  return { mode: how === 'reload' ? 'hot' : 'restart', reason: 'a model change in the project folder', ok: true, at, totalMs: ms, phases: [{ name: 'apply', ms }] };
}
