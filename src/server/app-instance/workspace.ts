// The recording workspace of an office-run app instance (./index.ts): one folder per project and purpose
// under the office's work folders (<data>/testing/work/<project>/instance-<purpose>), kept between runs so
// what mxcli builds and bundles there (deployment/, .mxcli/, the web client's bundle) stays warm. A cold
// copy bundles the web client in minutes on a busy laptop, past mxcli's own limit; a warm one in seconds.
//
//   * The first run copies the commit in from the project's git objects with a private index kept beside
//     the folder (<dir>.index; GIT_INDEX_FILE, --work-tree): git reads the project's objects and writes
//     nothing in the project's folder.
//   * Every later run updates the same folder in place with `read-tree --reset -u` against that index: the
//     files of the new commit are written, files the commit dropped are removed, any tracked file a run
//     changed is put back, and what isn't tracked (the build, the bundle, mxcli's caches) stays. A new
//     commit also clears the last build's leftovers (liveapp/checkout.ts cleanBuild), as the live app does.
//   * deployment/data (the uploaded files of the databases earlier runs dropped) is cleared every time:
//     each run's database is fresh, so are its files.
//   * <dir>.json says which commit the folder holds and whether its last start came up ("clean"); a start
//     that didn't (or an office that stopped mid-way) has the build cleared next time.
//   * Workspaces nobody used for WORKSPACE_KEEP_DAYS are removed (sweepWorkspaces), so a project that is
//     gone, or no longer recorded, doesn't hold its copy for ever.
// All git runs off the event loop; nothing here is ever the project's own checkout.

import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { WorkspaceHow } from '../../shared/app-instance.js';
import { execFileOffP, type OffError } from '../offloop/exec.js';
import { cleanBuild } from '../liveapp/checkout.js';
import { assertOfficeFolder, disposeFolder, mprIn } from '../testing/workfolder.js';

export const WORKSPACE_KEEP_DAYS = 14;

const GIT_ENV = { GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0' };

export interface Workspace {
  dir: string;
  /** The full commit it holds now. */
  commit: string;
  /** The project's .mpr, relative to `dir` (forward slashes). */
  mpr: string;
  how: WorkspaceHow;
}

interface Mark {
  commit: string;
  mpr: string;
  clean: boolean;
  at: number;
}

const markOf = (dir: string) => `${dir}.json`;
const indexOf = (dir: string) => `${dir}.index`;

async function git(floorDir: string, args: string[], extraEnv: Record<string, string> = {}, timeout = 120_000): Promise<string> {
  try {
    const { stdout } = await execFileOffP('git', ['-C', floorDir, ...args], { env: { ...process.env, ...GIT_ENV, ...extraEnv }, timeout, maxBuffer: 64 * 1024 * 1024, windowsHide: true });
    return stdout;
  } catch (err) {
    const e = err as OffError;
    throw new Error(`git ${args[0]} failed: ${(e.stderr || e.message || '').trim().split('\n').slice(-2).join(' ')}`);
  }
}

async function readMark(dir: string): Promise<Mark | undefined> {
  try {
    const m = JSON.parse(await readFile(markOf(dir), 'utf8')) as Partial<Mark>;
    return typeof m.commit === 'string' && typeof m.mpr === 'string' ? { commit: m.commit, mpr: m.mpr, clean: m.clean === true, at: Number(m.at) || 0 } : undefined;
  } catch {
    return undefined;
  }
}

/** Says what the folder holds and whether its last start came up. */
export async function markWorkspace(dir: string, ws: Pick<Workspace, 'commit' | 'mpr'>, clean: boolean): Promise<void> {
  const m: Mark = { commit: ws.commit, mpr: ws.mpr, clean, at: Date.now() };
  await writeFile(markOf(dir), `${JSON.stringify(m)}\n`).catch(() => undefined);
}

/** Removes a workspace, its index and its mark (never throws). */
export async function removeWorkspace(dir: string): Promise<void> {
  await disposeFolder(dir);
  await rm(markOf(dir), { force: true }).catch(() => undefined);
}

/**
 * The workspace at `dir` holding commit `sha` of the repo at `floorDir`: updated in place when it's there
 * already, else a first copy. Rejects when the commit isn't there or the copy fails.
 */
export async function prepareWorkspace(floorDir: string, sha: string, dir: string, dataDir: string): Promise<Workspace> {
  assertOfficeFolder(dir, dataDir, floorDir);
  const commit = (await git(floorDir, ['rev-parse', '--verify', '--quiet', `${sha}^{commit}`])).trim();
  if (!/^[0-9a-f]{40,64}$/.test(commit)) throw new Error(`no commit ${sha} in the project`);
  const index = { GIT_INDEX_FILE: indexOf(dir) };
  const files = (await git(floorDir, ['ls-tree', '-r', '--name-only', '-z', commit])).split('\0').filter(Boolean);
  const mpr = mprIn(files);
  if (!mpr) throw new Error(`no .mpr at ${commit.slice(0, 7)}`);
  const was = await readMark(dir);
  let how: WorkspaceHow = 'fresh';
  if (was && existsSync(dir) && existsSync(indexOf(dir))) {
    try {
      await git(floorDir, [`--work-tree=${dir}`, 'read-tree', '--reset', '-u', commit], index, 300_000);
      how = was.commit === commit ? 'reused' : 'updated';
      // A newer commit over an older build trips mxbuild up; so may a build whose start never came up.
      if (how === 'updated' || !was.clean || was.mpr !== mpr) cleanBuild(path.dirname(path.join(dir, ...was.mpr.split('/'))));
    } catch {
      how = 'fresh';
    }
  }
  if (how === 'fresh') {
    await removeWorkspace(dir);
    await mkdir(dir, { recursive: true });
    try {
      await git(floorDir, [`--work-tree=${dir}`, 'read-tree', commit], index);
      await git(floorDir, [`--work-tree=${dir}`, 'checkout-index', '-a', '-f'], index, 300_000);
    } catch (err) {
      await removeWorkspace(dir);
      throw err;
    }
  }
  await clearRunData(path.dirname(path.join(dir, ...mpr.split('/'))));
  await markWorkspace(dir, { commit, mpr }, false);
  return { dir, commit, mpr, how };
}

/** What a run leaves that belongs to its database (dropped with it): the uploaded files, the runtime's temp files. */
export async function clearRunData(projectDir: string): Promise<void> {
  await rm(path.join(projectDir, 'deployment', 'data'), { recursive: true, force: true, maxRetries: 3, retryDelay: 200 }).catch(() => undefined);
}

/**
 * Removes the instance workspaces under <data>/testing/work that no run used for `days` days (by their mark),
 * except `keep`. Best effort; returns what it removed.
 */
export async function sweepWorkspaces(dataDir: string, keep?: string, days = WORKSPACE_KEEP_DAYS, now = Date.now()): Promise<string[]> {
  const root = path.join(dataDir, 'testing', 'work');
  const gone: string[] = [];
  const floors = await readdir(root).catch(() => [] as string[]);
  for (const f of floors) {
    const names = await readdir(path.join(root, f)).catch(() => [] as string[]);
    for (const n of names) {
      if (!/^instance-[a-z0-9]+\.json$/i.test(n)) continue;
      const dir = path.join(root, f, n.slice(0, -'.json'.length));
      if (keep && path.resolve(dir) === path.resolve(keep)) continue;
      const m = await readMark(dir);
      const at = m?.at || (await stat(markOf(dir)).then((s) => s.mtimeMs, () => now));
      if (now - at < days * 86_400_000) continue;
      await removeWorkspace(dir);
      gone.push(dir);
    }
  }
  return gone;
}
