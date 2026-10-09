// The file work of deleting a project, all async (the libuv pool, never the event loop): whether a
// folder may be deleted at all, deleting a tree on Windows (junctions unlinked first and never followed,
// read-only files, long paths, a locked file said plainly with a retry), and copying the office data
// into the archive before any of it goes.

import { cp, lstat, mkdir, readdir, realpath, rm, stat } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isTestPath } from '../testmode.js';
import { unlinkLinks, within } from '../worktree-sweep/sweep.js';

const norm = (p: string) => (process.platform === 'win32' ? path.resolve(p).toLowerCase() : path.resolve(p));
const same = (a: string, b: string) => norm(a) === norm(b);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** The office's own code (never inside a folder it deletes): the nearest folder up with its package.json. */
let appRoot: string | undefined;
function appRootDir(): string {
  if (appRoot) return appRoot;
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 6; i++, dir = path.dirname(dir)) {
    try {
      if (JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8')).name === 'agent-office') return (appRoot = dir);
    } catch {
      // keep looking
    }
  }
  return (appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..'));
}

export interface FolderRules {
  /** The office's projects home: only folders inside it are ever deleted. */
  home: string;
  /** The office's own data folder. */
  dataDir: string;
  /** The project the office was started in (it keeps its own data there). */
  local: boolean;
  /** The office is in test mode: only test-office folders. */
  testMode: boolean;
}

/** Why `dir` must not be deleted, or undefined when it may (a folder already gone may, there's nothing to do). */
export async function folderRefusal(dir: string, rules: FolderRules): Promise<string | undefined> {
  const abs = path.resolve(dir);
  if (rules.local) return 'it’s the project the office was started in, and the office keeps its own data there';
  if (rules.testMode && !isTestPath(abs)) return 'the office is in test mode, and only folders under scratch/test-offices (or a test-office… folder) are deleted then';
  if (!within(rules.home, abs)) return `it isn’t inside the office’s projects folder (${rules.home})`;
  if (same(abs, rules.dataDir) || within(abs, rules.dataDir)) return 'the office’s own data is inside it';
  if (same(abs, appRootDir()) || within(abs, appRootDir())) return 'the office’s own code is inside it';
  const st = await lstat(abs).catch(() => undefined);
  if (!st) return undefined;
  if (st.isSymbolicLink()) return 'it’s a junction or symbolic link, not a folder of its own';
  if (!st.isDirectory()) return 'it isn’t a folder';
  // A link further up would put it somewhere else than it says.
  const real = await realpath(abs).catch(() => abs);
  if (!same(real, abs)) return `it really is ${real} (a link on the way there)`;
  const realHome = await realpath(rules.home).catch(() => rules.home);
  if (!within(realHome, real)) return `it isn’t inside the office’s projects folder (${rules.home})`;
  return undefined;
}

/** A plain sentence for why a delete failed. */
export function whyNotDeleted(err: unknown, dir: string): string {
  const e = err as NodeJS.ErrnoException;
  const where = e.path && !same(e.path, dir) ? ` (${e.path})` : '';
  if (e.code === 'EBUSY' || e.code === 'EPERM' || e.code === 'EACCES' || e.code === 'ENOTEMPTY')
    return `Couldn’t delete ${dir}: a file in it is in use or locked${where}. Close whatever has it open (Studio Pro, an editor, a terminal in that folder, a running app) and press Retry.`;
  if (e.code === 'ENAMETOOLONG') return `Couldn’t delete ${dir}: a path in it is too long for Windows${where}. Press Retry; if it fails again, delete it from Explorer.`;
  return `Couldn’t delete ${dir}: ${e.message ?? String(err)}`;
}

/**
 * Deletes a folder and everything in it. Every junction and symlink inside is unlinked first without
 * being followed (a worktree's node_modules junction points at another checkout's packages). Node's rm
 * clears read-only files on Windows and takes long paths; a locked file is tried again a few times,
 * then said plainly (whyNotDeleted).
 */
export async function removeTree(dir: string, tries = 4): Promise<void> {
  const st = await lstat(dir).catch(() => undefined);
  if (!st) return;
  if (st.isSymbolicLink()) throw new Error(`Refusing to delete ${dir}: it’s a link`);
  let last: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      await unlinkLinks(dir);
      await rm(dir, {
        recursive: true,
        force: true,
        maxRetries: 3,
        retryDelay: 150,
      });
      return;
    } catch (err) {
      last = err;
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return;
      await sleep(250 * (i + 1));
    }
  }
  throw new Error(whyNotDeleted(last, dir));
}

/** Copies a folder into the archive: plain files and folders only (links, sockets and pipes stay behind), leaving out `skip`. */
export async function copyTree(from: string, to: string, skip: readonly string[] = []): Promise<number> {
  let files = 0;
  const st = await stat(from).catch(() => undefined);
  if (!st) return 0;
  if (st.isFile()) {
    await mkdir(path.dirname(to), { recursive: true });
    await cp(from, to, { force: true });
    return 1;
  }
  await cp(from, to, {
    recursive: true,
    force: true,
    filter: async (src) => {
      if (skip.some((s) => same(s, src) || within(s, src))) return false;
      const s = await lstat(src).catch(() => undefined);
      if (!s || !(s.isFile() || s.isDirectory())) return false;
      if (s.isFile()) files++;
      return true;
    },
  });
  return files;
}

/** Whether the folder has anything in it. */
export const hasEntries = (dir: string) =>
  readdir(dir).then(
    (n) => n.length > 0,
    () => false,
  );
