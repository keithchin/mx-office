// Agents' git worktrees stay in their project: the PreToolUse hook for Bash every Claude worker on a
// floor gets (bin/worktree-guard.js, through the floor's claude-hooks.json like Studio mode's guard,
// providers/claude.ts) denies `git worktree add` anywhere but the floor's .agent-office/worktrees/, so
// the office sees them and the worktree cleanup (worktree-sweep/) can take them away once merged. The
// shell only starts Node when the payload mentions a worktree at all.

import path from 'node:path';
import { binScript, shq } from './workers/process.js';

/** A path as the hook's shell (sh, or Git Bash on Windows) and Node both take it. */
const shellPath = (p: string) => (process.platform === 'win32' ? p.replace(/\\/g, '/') : p);

/** The PreToolUse entry for Bash (`dataDir` is the floor's .agent-office). Undefined without bin/worktree-guard.js. */
export function worktreeGuardHook(dataDir: string, script = binScript('worktree-guard.js'), node = process.execPath): { matcher: string; hooks: { type: 'command'; command: string; timeout: number }[] } | undefined {
  if (!script) return undefined;
  const allowed = shq(shellPath(path.join(dataDir, 'worktrees')));
  const command = `p=$(cat); case "$p" in *worktree*) printf '%s' "$p" | ${shq(shellPath(node))} ${shq(shellPath(script))} ${allowed} ;; esac`;
  return { matcher: 'Bash', hooks: [{ type: 'command', command, timeout: 10 }] };
}
