#!/usr/bin/env node
// worktree-guard: Claude Code's PreToolUse hook for Bash on every worker of a floor
// (src/server/worktree-guard.ts writes it into the floor's claude-hooks.json). It denies
// `git worktree add <path>` when <path> isn't inside the floor's .agent-office/worktrees/, and says the
// exact path to use instead: worktrees agents made in a temp folder or next to the project were
// invisible to the office and never cleaned up. Everything else runs. Plain Node, no build step, no
// dependencies; the decision is pure and exported for the tests.
//
//   node worktree-guard.js <allowed dir>    (the PreToolUse payload on stdin)

import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { simpleCommands } from './studio-guard.js';

const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;
/** git's own options that take a value as the next word. */
const GIT_VALUE_OPTS = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace', '--exec-path', '--config-env']);
/** `git worktree add` options that take a value as the next word. */
const ADD_VALUE_OPTS = new Set(['-b', '-B', '--reason']);

/**
 * Every `git worktree add` in a command line, with the folder it names and the folder it's relative
 * to (after any `cd` before it, and git's own -C).
 */
export function worktreeAdds(line, cwd) {
  const out = [];
  let here = cwd;
  for (const raw of simpleCommands(line)) {
    const words = raw.slice();
    while (words.length && ASSIGNMENT.test(words[0])) words.shift();
    if (!words.length) continue;
    if (words[0] === 'cd') {
      if (words[1] && words[1] !== '-') here = { base: here, rel: words[1] };
      continue;
    }
    if (!/^git(\.exe)?$/i.test(path.basename(words[0].replace(/\\/g, '/')))) continue;
    let at = here;
    let i = 1;
    while (i < words.length && words[i].startsWith('-')) {
      if (words[i] === '-C') at = { base: at, rel: words[i + 1] ?? '.' };
      i += GIT_VALUE_OPTS.has(words[i]) ? 2 : 1;
    }
    if (words[i] !== 'worktree' || words[i + 1] !== 'add') continue;
    let target;
    for (let j = i + 2; j < words.length; j++) {
      const w = words[j];
      if (w === '--') {
        target = words[j + 1];
        break;
      }
      if (ADD_VALUE_OPTS.has(w)) {
        j++;
        continue;
      }
      if (w.startsWith('-')) continue;
      target = w;
      break;
    }
    if (target !== undefined) out.push({ target, cwd: at });
  }
  return out;
}

/** Whether paths here are Windows paths (C:\ or C:/), to resolve and compare them that way. */
const isWinPath = (p) => /^[A-Za-z]:[\\/]/.test(p);

/** Git Bash's /c/Users/… (and /cygdrive/c/…) as C:/Users/…, for a Windows office. */
function fromMsys(p) {
  const m = /^\/(?:cygdrive\/)?([A-Za-z])(\/.*|$)/.exec(p);
  return m ? `${m[1].toUpperCase()}:${m[2] || '/'}` : p;
}

/** A folder as written, made absolute: `~` expanded, Git Bash paths turned into Windows ones, relative to `cwd`. Undefined when it can't be told ($VARS, $(…)). */
export function resolveTarget(raw, cwd, win, home = os.homedir()) {
  const p = path[win ? 'win32' : 'posix'];
  const one = (base, rel) => {
    if (/[$`]/.test(rel) || /^~[^/\\]/.test(rel)) return undefined;
    let r = rel.replace(/^~(?=$|[\\/])/, home);
    if (win) r = fromMsys(r);
    return p.resolve(base, r);
  };
  const dirOf = (c) => {
    if (typeof c === 'string') return win ? p.resolve(fromMsys(c)) : p.resolve(c);
    const base = dirOf(c.base);
    return base === undefined ? undefined : one(base, c.rel);
  };
  const base = dirOf(cwd);
  return base === undefined ? undefined : one(base, raw);
}

export function inside(dir, target, win) {
  const p = path[win ? 'win32' : 'posix'];
  const rel = win ? p.relative(dir.toLowerCase(), target.toLowerCase()) : p.relative(dir, target);
  return rel !== '' && !rel.startsWith('..') && !p.isAbsolute(rel);
}

/** What the agent is told, with the path it should use. */
export function denyReason(allowed, target, raw) {
  const name = (target ? path.basename(target.replace(/\\/g, '/')) : path.basename(String(raw).replace(/\\/g, '/'))).replace(/[^\w.-]+/g, '-') || 'my-worktree';
  const use = `${allowed.replace(/\\/g, '/')}/${name}`;
  return `This office keeps git worktrees inside the project: ${allowed.replace(/\\/g, '/')}/. Use git worktree add "${use}" (same branch options) instead of ${raw}. Worktrees in a temp folder or next to the project are invisible to the office and never cleaned up; ones in that folder are removed for you once their branch is merged.`;
}

/**
 * The hook's decision on one PreToolUse payload: undefined to let it run, or why it's denied.
 * `allowed` is the floor's .agent-office/worktrees folder.
 */
export function decide(payload, allowed, home = os.homedir()) {
  if (!allowed || payload?.tool_name !== 'Bash') return undefined;
  const command = payload?.tool_input?.command;
  if (typeof command !== 'string' || !command.includes('worktree')) return undefined;
  const win = isWinPath(allowed);
  const cwd = typeof payload.cwd === 'string' && payload.cwd ? payload.cwd : process.cwd();
  const root = win ? path.win32.resolve(allowed) : path.posix.resolve(allowed);
  for (const add of worktreeAdds(command, cwd)) {
    const target = resolveTarget(add.target, add.cwd, win, home);
    if (target && inside(root, target, win)) continue;
    return { target, reason: denyReason(root, target, add.target) };
  }
  return undefined;
}

async function main() {
  let body = '';
  for await (const c of process.stdin) body += c;
  let payload;
  try {
    payload = JSON.parse(body || '{}');
  } catch {
    return;
  }
  const d = decide(payload, process.argv[2]);
  if (!d) return;
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: d.reason } }));
}

const self = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === self) {
  main().catch(() => undefined);
}
