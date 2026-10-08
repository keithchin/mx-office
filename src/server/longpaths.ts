// Long paths on Windows. A Mendix app's javascriptsource carries npm packages with deep node_modules
// trees (nanoflowcommons' async-storage has a macOS .xcodeproj seven folders down), and checked out in
// a worker's worktree under the floor's .agent-office/worktrees those paths pass Windows' 260
// characters: git refuses with "Filename too long" and the hire fails ("Could not create a git
// worktree", the new-project wizard's team step, 2026-10-08). `core.longpaths true` in the
// repository's own config lets git for Windows use the long-path APIs. The office sets it when the
// wizard clones a floor, and again before any worktree is made, should a floor predate this.
//
// The check reads the repository's config file (as gitfiles.ts does) so a hire costs no git run;
// only a repository without the setting gets one `git config`, started off the event loop.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { commonDirOf } from './gitfiles.js';
import { execFileOffP } from './offloop/exec.js';

/** Clone arguments (`git clone -c …`) that give the new repository the setting from the start; none off Windows. */
export const LONGPATHS_CLONE_ARGS: readonly string[] = process.platform === 'win32' ? ['-c', 'core.longpaths=true'] : [];

/** git's reading of a boolean config value. */
const truthy = (v: string) => /^(true|yes|on|1)$/i.test(v.trim());

/**
 * Whether the repository's own config (the one every worktree shares) sets core.longpaths true; null
 * when `dir` isn't the top of a checkout or the file can't be read.
 */
export function hasLongPaths(dir: string): boolean | null {
  const common = commonDirOf(dir);
  if (!common) return null;
  let cfg: string;
  try {
    cfg = readFileSync(path.join(common, 'config'), 'utf8');
  } catch {
    return null;
  }
  let inCore = false;
  let value: boolean | undefined;
  for (const raw of cfg.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || line.startsWith(';')) continue;
    const sec = /^\[\s*([^\]\s"]+)(?:\s+"[^"]*")?\s*\]\s*(.*)$/.exec(line);
    if (sec) {
      inCore = sec[1].toLowerCase() === 'core';
      // `[core] longpaths = true` on one line is allowed too.
      if (!sec[2]) continue;
    }
    const kv = /^([A-Za-z][\w-]*)\s*(?:=\s*(.*))?$/.exec(sec ? sec[2] : line);
    // A bare key is true; the last setting wins, as in git.
    if (inCore && kv && kv[1].toLowerCase() === 'longpaths') value = kv[2] === undefined ? true : truthy(kv[2].replace(/\s+[#;].*$/, ''));
  }
  return value === true;
}

/** Repositories (their shared git folder) seen with the setting this run: no need to read again. */
const known = new Set<string>();

/**
 * Makes sure the repository at `dir` has core.longpaths true in its own config, on Windows (elsewhere
 * paths are long enough already). Never throws: a repository it couldn't set is left as it was, and
 * git says why when it next fails.
 */
export async function ensureLongPaths(dir: string, platform: NodeJS.Platform = process.platform): Promise<void> {
  if (platform !== 'win32') return;
  const key = commonDirOf(dir) ?? path.resolve(dir);
  if (known.has(key)) return;
  if (hasLongPaths(dir) !== true) {
    try {
      await execFileOffP('git', ['config', '--local', 'core.longpaths', 'true'], { cwd: dir, timeout: 20_000, windowsHide: true });
    } catch (err) {
      console.warn(`agent-office: couldn't set core.longpaths in ${dir}: ${(err as Error).message}`);
      return;
    }
  }
  known.add(key);
}

/** Forgets what ensureLongPaths saw (tests). */
export function forgetLongPaths() {
  known.clear();
}
