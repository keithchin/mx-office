// Folder trust for Claude Code. The first time Claude Code runs in a folder it asks "Do you trust the
// files in this folder?" and waits; on a new floor every agent's terminal sat on that screen until
// someone clicked each one (2026-10-08). The answer lives in Claude Code's config file
// (`~/.claude.json`, or `<CLAUDE_CONFIG_DIR>/.claude.json` for an account's own sign-in) as
// `projects["C:/path/to/folder"].hasTrustDialogAccepted = true`, keyed by the folder with forward
// slashes on Windows. Claude Code looks up the repository's main checkout there (for a worktree, the
// checkout its .git file points back to), then the folders from where it runs up to that worktree's
// own top. So trusting a floor's checkout covers the worktrees the office makes under it; a folder
// trusted higher up (outside the repository) doesn't.
//
// The office marks the floors it manages trusted, and nothing else: the wizard's new floor (in the
// office's own config) and each floor a Claude worker is about to start on (in the config that worker
// uses). Claude Code rewrites this file too, so the read and write are back to back (no await in
// between), the write goes to a temporary file renamed over it, nothing is written when the folder is
// already trusted, and a file that can't be parsed is left alone. Test offices and test folders never
// touch a real config (isolated()).

import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { isTestPath } from './testmode.js';

/** The Claude Code config file a Claude started with `env` reads its trust from (Claude Code's own rule). */
export function claudeConfigFile(env: NodeJS.ProcessEnv = process.env): string {
  const dir = env.CLAUDE_CONFIG_DIR;
  // A very old install kept it in <config dir>/.config.json, and Claude Code still prefers that one when it's there.
  const legacy = path.join(dir || path.join(os.homedir(), '.claude'), '.config.json');
  if (existsSync(legacy)) return legacy;
  return path.join(dir || os.homedir(), '.claude.json');
}

/** A folder as Claude Code keys it in `projects`: absolute, forward slashes on Windows. */
export function trustKey(dir: string, platform: NodeJS.Platform = process.platform): string {
  const abs = path.resolve(dir);
  return platform === 'win32' ? abs.replaceAll('\\', '/') : abs;
}

const sameKey = (a: string, b: string, platform: NodeJS.Platform) => (platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b);

/**
 * Whether `config` (a parsed Claude Code config) trusts `dir` itself, or with `ancestors` one of the
 * folders above it (a floor's checkout trusted covers its worktrees). Drive letters and case don't
 * matter on Windows.
 */
export function trusts(config: any, dir: string, { ancestors = false, platform = process.platform }: { ancestors?: boolean; platform?: NodeJS.Platform } = {}): boolean {
  const projects = config?.projects;
  if (!projects || typeof projects !== 'object') return false;
  const keys = Object.keys(projects).filter((k) => projects[k]?.hasTrustDialogAccepted === true);
  if (!keys.length) return false;
  let at = trustKey(dir, platform);
  for (;;) {
    if (keys.some((k) => sameKey(k.replace(/\/+$/, ''), at, platform))) return true;
    if (!ancestors) return false;
    const up = platform === 'win32' ? path.win32.dirname(at).replaceAll('\\', '/') : path.posix.dirname(at);
    if (up === at) return false;
    at = up;
  }
}

/** A temporary folder or a test office's. */
const throwaway = (p: string) => {
  const tmp = path.resolve(os.tmpdir()).toLowerCase();
  const abs = path.resolve(p).toLowerCase();
  return isTestPath(p) || abs === tmp || abs.startsWith(tmp + path.sep);
};

/** A test folder is only ever trusted in a test config: tests and test offices never write the real one. */
export const isolated = (file: string, dir: string) => !throwaway(dir) || throwaway(file);

export type TrustResult = 'trusted' | 'already' | 'skipped' | 'unreadable' | 'failed';

/**
 * Marks `dirs` trusted in the Claude Code config `file`: read, change only `projects[<dir>]`'s
 * hasTrustDialogAccepted, write to a temporary file and rename it over. 'already' (nothing written)
 * when each was trusted by its own key; 'unreadable' (nothing written) when the file is there but
 * isn't a JSON object; a missing file is made. Never throws.
 */
export function trustFolders(file: string, dirs: string[], platform: NodeJS.Platform = process.platform): TrustResult {
  const want = dirs.filter((d) => isolated(file, d));
  if (!want.length) return 'skipped';
  // Trusted this run already: no need to read the file again at every start.
  if (want.every((d) => seen.has(`${file}|${trustKey(d, platform)}`))) return 'already';
  const r = writeTrust(file, want, platform);
  if (r === 'trusted' || r === 'already') for (const d of want) seen.add(`${file}|${trustKey(d, platform)}`);
  return r;
}

/** Folders (by config file) trusted, or seen trusted, this run. */
const seen = new Set<string>();

/** Forgets what trustFolders saw (tests). */
export function forgetTrust() {
  seen.clear();
}

function writeTrust(file: string, want: string[], platform: NodeJS.Platform): TrustResult {
  let text: string | undefined;
  try {
    text = readFileSync(file, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') return 'unreadable';
  }
  let config: any = {};
  if (text !== undefined && text.trim()) {
    try {
      config = JSON.parse(text);
    } catch {
      return 'unreadable';
    }
    if (!config || typeof config !== 'object' || Array.isArray(config)) return 'unreadable';
  }
  const keys = want.map((d) => trustKey(d, platform)).filter((k) => config.projects?.[k]?.hasTrustDialogAccepted !== true);
  if (!keys.length) return 'already';
  if (config.projects !== undefined && (typeof config.projects !== 'object' || config.projects === null || Array.isArray(config.projects))) return 'unreadable';
  config.projects ??= {};
  for (const k of keys) {
    const was = config.projects[k];
    config.projects[k] = { ...(was && typeof was === 'object' ? was : {}), hasTrustDialogAccepted: true };
  }
  const tmp = `${file}.${process.pid}.${Date.now()}.agent-office.tmp`;
  try {
    writeFileSync(tmp, JSON.stringify(config, null, 2), { mode: 0o600 });
    try {
      renameSync(tmp, file);
    } catch {
      // Windows: Claude Code has it open right now. A moment later is fine.
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
      renameSync(tmp, file);
    }
    return 'trusted';
  } catch (err) {
    rmSync(tmp, { force: true });
    console.warn(`agent-office: couldn't mark ${keys.join(', ')} trusted in ${file}: ${(err as Error).message}`);
    return 'failed';
  }
}

/** Marks a floor the office manages trusted for the Claude that starts with `env` (the office's own, or an account's). */
export function trustFloor(dir: string, env: NodeJS.ProcessEnv = process.env): TrustResult {
  return trustFolders(claudeConfigFile(env), [dir]);
}
