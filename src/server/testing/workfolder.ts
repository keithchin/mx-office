// The office's own work folder for an mxcli run (Testing release 1b): a disposable copy of one commit of
// a project, under <data>/testing/work/<floor>/<kind>/, never a floor checkout or an agent's worktree.
// mxcli's catalog refresh (report, lint, refresh catalog) rewrites `.ai-context/skills/widgets/` and
// creates the agent config folder's `skills/widgets/` and `.mxcli/` in the folder it runs in (mxcli capability audit §3,
// confirmed again on a disposable clone for this release), and `mxcli test --local` injects a test module
// into the model it runs: so they only ever run here, and the folder is wiped before and after each run.
//
// The copy is made from the floor's git objects with a private index (GIT_INDEX_FILE in the office's
// folder, --work-tree the work folder): git reads the floor's objects and writes nothing in the floor,
// neither its index nor its checkout nor its worktree list. Its commit is therefore known exactly, which
// is what the records bind to. All git runs off the event loop.

import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { execFileOffP, type OffError } from '../offloop/exec.js';

const GIT_ENV = { GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0' };

export type WorkKind = 'tests' | 'quality';

export interface WorkFolder {
  /** The folder itself (absolute). */
  dir: string;
  /** The full commit it holds. */
  commit: string;
  /** The project's .mpr, relative to `dir` (forward slashes). */
  mpr: string;
  /** Every file at the commit (repo-relative), for finding the tests. */
  files: string[];
}

async function git(floorDir: string, args: string[], extraEnv: Record<string, string> = {}, timeout = 120_000): Promise<string> {
  try {
    const { stdout } = await execFileOffP('git', ['-C', floorDir, ...args], { env: { ...process.env, ...GIT_ENV, ...extraEnv }, timeout, maxBuffer: 64 * 1024 * 1024, windowsHide: true });
    return stdout;
  } catch (err) {
    const e = err as OffError;
    throw new Error(`git ${args[0]} failed: ${(e.stderr || e.message || '').trim().split('\n').slice(-2).join(' ')}`);
  }
}

/** Where a floor's work folder of one kind lives. */
export const workDirOf = (dataDir: string, floorId: string, kind: WorkKind) => path.join(dataDir, 'testing', 'work', floorId, kind);

const inside = (child: string, parent: string) => {
  const rel = path.relative(path.resolve(parent), path.resolve(child));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
};

/** Refuses a folder that isn't the office's own (under <data>/testing/work) or that is inside the floor's checkout. */
export function assertOfficeFolder(dir: string, dataDir: string, floorDir: string): void {
  if (!inside(dir, path.join(dataDir, 'testing', 'work'))) throw new Error(`not an office work folder: ${dir}`);
  if (inside(dir, floorDir) || inside(floorDir, dir)) throw new Error(`the work folder must not be in the project's checkout: ${dir}`);
}

/** The project file at a commit: a top-level .mpr, else the shallowest one. */
export function mprIn(files: readonly string[]): string | undefined {
  return files.filter((f) => /\.mpr$/i.test(f)).sort((a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b))[0];
}

/** The microflow test files at a commit (.test.mdl / .test.md), each handed to mxcli by name (at most 200). */
export function testPathsIn(files: readonly string[]): string[] {
  return files
    .filter((f) => /\.test\.(mdl|md)$/i.test(f) && !/(^|\/)(node_modules|\.git|\.mxcli)\//.test(f))
    .sort()
    .slice(0, 200);
}

/** Wipes a work folder (retrying a Windows lock a few times). Never throws. */
export async function disposeFolder(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }).catch(() => undefined);
  await rm(`${dir}.index`, { force: true }).catch(() => undefined);
}

/**
 * A fresh copy of commit `sha` of the repo at `floorDir` in the office's work folder `dir` (wiped first).
 * Rejects when the commit isn't there or the copy fails; the folder is wiped again then.
 */
export async function checkoutAt(floorDir: string, sha: string, dir: string, dataDir: string): Promise<WorkFolder> {
  assertOfficeFolder(dir, dataDir, floorDir);
  const commit = (await git(floorDir, ['rev-parse', '--verify', '--quiet', `${sha}^{commit}`])).trim();
  if (!/^[0-9a-f]{40,64}$/.test(commit)) throw new Error(`no commit ${sha} in the project`);
  await disposeFolder(dir);
  await mkdir(dir, { recursive: true });
  const index = { GIT_INDEX_FILE: `${dir}.index` };
  try {
    await git(floorDir, [`--work-tree=${dir}`, 'read-tree', commit], index);
    await git(floorDir, [`--work-tree=${dir}`, 'checkout-index', '-a', '-f'], index, 300_000);
    const files = (await git(floorDir, ['ls-tree', '-r', '--name-only', '-z', commit])).split('\0').filter(Boolean);
    const mpr = mprIn(files);
    if (!mpr) throw new Error(`no .mpr at ${commit.slice(0, 7)}`);
    return { dir, commit, mpr, files };
  } catch (err) {
    await disposeFolder(dir);
    throw err;
  } finally {
    await rm(`${dir}.index`, { force: true }).catch(() => undefined);
  }
}
