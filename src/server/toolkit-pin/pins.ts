// The pinned copies of the toolkit: one detached, read-only-by-convention worktree of the office's toolkit
// clone per commit, at <clone>-pins/<sha12> (next to the clone: mendix-toolkit → mendix-toolkit-pins), shared
// by every project on that commit. A project's scripts, wiring and the office's own gate-check runs use its
// pin, so a pull or a new commit in the shared clone never reaches a project mid-stage. A detached HEAD
// also makes the toolkit's old session-start `git pull --ff-only` fail harmlessly instead of moving it.

import { existsSync, realpathSync } from 'node:fs';
import { readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { classifyCommit, type ToolkitCommit } from '../../shared/toolkit.js';
import { git, gitRun, isAncestor, remoteDefault, revParse } from './git.js';

/** Where the pins of the clone at `root` live. */
export const pinsDir = (root: string) => path.join(path.dirname(path.resolve(root)), `${path.basename(path.resolve(root))}-pins`);

/** The pin folder for `sha` (its first 12 characters). */
export const pinDir = (root: string, sha: string) => path.join(pinsDir(root), sha.slice(0, 12).toLowerCase());

const SHA = /^[0-9a-f]{7,40}$/i;
const making = new Map<string, Promise<string>>();

/** Whether `root` is a git checkout. */
export async function isRepo(root: string): Promise<boolean> {
  if (!existsSync(root)) return false;
  const top = await git(['rev-parse', '--show-toplevel'], root);
  const real = (x: string) => {
    try {
      return realpathSync.native(x).toLowerCase();
    } catch {
      return path.resolve(x).toLowerCase();
    }
  };
  return !!top && real(top) === real(root);
}

/**
 * The pin of `sha`, made when it isn't there yet (fetching first when the clone hasn't got the commit), or
 * reused when it's there at that commit. A pin folder at another commit (someone checked something out in
 * it) is made again. Resolves to the folder; throws why not.
 */
export async function ensurePin(root: string, sha: string): Promise<string> {
  if (!SHA.test(sha)) throw new Error(`not a commit: ${sha}`);
  // A short sha is made the full one first, so the folder is the same whichever way it's named.
  return makePin(root, (await revParse(root, sha)) ?? sha);
}

function makePin(root: string, sha: string): Promise<string> {
  const dir = pinDir(root, sha);
  const key = dir.toLowerCase();
  const going = making.get(key);
  if (going) return going;
  const p = (async () => {
    let full = await revParse(root, sha);
    if (!full) {
      await gitRun(['-c', 'http.lowSpeedLimit=1000', '-c', 'http.lowSpeedTime=15', 'fetch', '--quiet', '--no-tags', 'origin'], root, 120_000);
      full = await revParse(root, sha);
    }
    if (!full) throw new Error(`the toolkit clone at ${root} hasn't got commit ${sha.slice(0, 12)} (not even after a fetch)`);
    if (existsSync(dir)) {
      const at = await git(['rev-parse', 'HEAD'], dir);
      if (at === full && (await git(['rev-parse', '--show-toplevel'], dir)) !== undefined) return dir;
      await gitRun(['worktree', 'remove', '--force', '--force', dir], root, 60_000);
      await rm(dir, { recursive: true, force: true }).catch(() => undefined);
      await gitRun(['worktree', 'prune'], root);
    }
    const r = await gitRun(['worktree', 'add', '--detach', '--force', dir, full], root, 180_000);
    if (!r.ok || !existsSync(dir)) throw new Error(`couldn't make the toolkit pin ${path.basename(dir)}: ${r.err.slice(0, 300)}`);
    return dir;
  })().finally(() => making.delete(key));
  making.set(key, p);
  return p;
}

/** Files in the pin that differ from its commit (someone edited the read-only copy). */
export async function pinEdits(dir: string): Promise<string[]> {
  const out = await git(['status', '--porcelain', '--untracked-files=no'], dir);
  return out ? out.split('\n').map((l) => l.slice(3).trim()).filter(Boolean) : [];
}

/** Removes every pin folder under the clone's pins that isn't in `keep` (full or short shas). */
export async function prunePins(root: string, keep: Iterable<string>): Promise<string[]> {
  const kept = [...keep].map((s) => s.slice(0, 12).toLowerCase());
  const base = pinsDir(root);
  const names = await readdir(base).catch(() => [] as string[]);
  const gone: string[] = [];
  for (const name of names) {
    if (!/^[0-9a-f]{12}$/.test(name) || kept.includes(name) || making.has(path.join(base, name).toLowerCase())) continue;
    const dir = path.join(base, name);
    await gitRun(['worktree', 'remove', '--force', '--force', dir], root, 60_000);
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    gone.push(name);
  }
  if (gone.length) await gitRun(['worktree', 'prune'], root);
  return gone;
}

const RS = '\x1e';
const US = '\x1f';

/** Commits in `range` (`a..b`, or a single ref for its history), newest first, merges left out, with their files and kinds. */
export async function commitsIn(root: string, range: string, max = 200): Promise<ToolkitCommit[]> {
  const out = await git(['log', '--no-merges', '--name-only', '--format=%x1e%H%x1f%cs%x1f%s', `-n`, String(max), range, '--'], root, 30_000);
  if (!out) return [];
  return out
    .split(RS)
    .filter((b) => b.trim())
    .map((block) => {
      const [head, ...rest] = block.split('\n');
      const [sha, date, subject] = head.split(US);
      const files = rest.map((l) => l.trim()).filter(Boolean);
      return { sha, date, subject, kinds: classifyCommit(subject, files), files: files.slice(0, 40) };
    });
}

/** How many non-merge commits `range` has. */
export async function countIn(root: string, range: string): Promise<number> {
  return Number(await git(['rev-list', '--count', '--no-merges', range], root)) || 0;
}

/** A commit's date (YYYY-MM-DD) and subject. */
export async function commitInfo(root: string, sha: string): Promise<{ date?: string; subject?: string }> {
  const out = await git(['log', '-1', '--format=%cs%x1f%s', sha, '--'], root);
  if (!out) return {};
  const [date, subject] = out.split(US);
  return { date, subject };
}

/** The newest toolkit commit for a new project or an update: origin's default branch, unless the clone's HEAD has commits it hasn't (then HEAD). */
export async function latestCommit(root: string): Promise<{ sha: string; branch: string } | undefined> {
  const def = await remoteDefault(root);
  const head = await revParse(root, 'HEAD');
  const tip = def ? await revParse(root, `refs/remotes/origin/${def}`) : undefined;
  if (tip && (!head || (await isAncestor(root, head, tip)))) return { sha: tip, branch: `origin/${def}` };
  return head ? { sha: head, branch: 'HEAD' } : undefined;
}

/**
 * The pin a new project starts on: the fork fetched first (quietly, time-limited; offline is fine), then
 * the newest commit (latestCommit) made a pin. Undefined when the toolkit folder isn't a git clone.
 */
export async function pinForNew(root: string, fetch = true): Promise<{ sha: string; dir: string; date?: string } | undefined> {
  if (!(await isRepo(root))) return undefined;
  if (fetch) await gitRun(['-c', 'http.lowSpeedLimit=1000', '-c', 'http.lowSpeedTime=15', 'fetch', '--quiet', '--no-tags', 'origin'], root, 90_000);
  const latest = await latestCommit(root);
  if (!latest) return undefined;
  return { sha: latest.sha, dir: await ensurePin(root, latest.sha), date: (await commitInfo(root, latest.sha)).date };
}
