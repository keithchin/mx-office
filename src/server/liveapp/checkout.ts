// The live app's own checkout of a floor's main: a clone in the office's data folder, never the
// floor's checkout (people and agents work in that) nor an agent's worktree. It's cloned from the
// floor's checkout (quick, and it shares its objects) and follows it: every fetch is from the floor's
// folder, never from GitHub. The floor's folder is what the office keeps current with its own fetches
// (wizard/gate-source.ts fetchDefault, with the office's git credentials); the live clone asking GitHub
// itself had no credentials for a private repo and never updated (a migration project, release 56: "couldn't ask
// the remote about main" in the log, the app on PR #7 for a day). All git here runs off the event loop.

import { execFileOff } from '../offloop/exec.js';
import { existsSync, readdirSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import { defaultBranch as originDefault, fetchDefault, fetchOutcome, gitSaid } from '../wizard/gate-source.js';

function git(args: string[], cwd: string, timeout = 120_000): Promise<string> {
  return new Promise((resolve, reject) => {
    // Mendix projects carry node_modules deep in javascriptsource/: past Windows' 260-character paths once inside the office's data folder.
    execFileOff('git', ['-c', 'core.longpaths=true', ...args], { cwd, timeout, maxBuffer: 8 * 1024 * 1024, env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0' }, windowsHide: true }, (err, stdout, stderr) => {
      if (err) reject(new Error(`git ${args[0]}: ${gitSaid(stderr || (err.killed ? 'timed out' : err.message))}`));
      else resolve(stdout.trim());
    });
  });
}

/** Clones the floor into `dir` the first time; an older clone pointed at GitHub is pointed back at the floor's folder. */
export async function ensureCheckout(dir: string, floorDir: string): Promise<void> {
  if (existsSync(path.join(dir, '.git'))) {
    const url = await git(['remote', 'get-url', 'origin'], dir).catch(() => '');
    if (path.resolve(url || '.') !== path.resolve(floorDir)) await git(['remote', url ? 'set-url' : 'add', 'origin', floorDir], dir).catch(() => undefined);
    return;
  }
  rmSync(dir, { recursive: true, force: true });
  await git(['clone', '--quiet', '--no-checkout', floorDir, dir], path.dirname(dir), 600_000);
}

/** The floor's default branch: what origin/HEAD names in its folder (else main, else master), else the branch its folder is on. */
export async function defaultBranch(floorDir: string): Promise<string> {
  const def = await originDefault(floorDir).catch(() => undefined);
  if (def) return def;
  const here = await git(['rev-parse', '--abbrev-ref', 'HEAD'], floorDir).catch(() => '');
  return here && here !== 'HEAD' ? here : 'main';
}

/** The ref in the floor's folder that is its `branch` as the office knows it: origin's when it has one, else its own. */
export async function floorRef(floorDir: string, branch: string): Promise<{ ref: string; sha: string } | undefined> {
  for (const ref of [`refs/remotes/origin/${branch}`, `refs/heads/${branch}`]) {
    const sha = await git(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], floorDir).catch(() => '');
    if (sha) return { ref, sha };
  }
  return undefined;
}

export interface Checkedout {
  sha: string;
  subject: string;
  /** When the commit was made (ms). */
  at?: number;
  /** Whether the checkout moved to another commit (what was built before is stale then). */
  moved: boolean;
}

/** Fetches `branch` from the floor's folder and puts the checkout on it, files the app makes (deployment/, .mxcli/) left alone. */
export async function pullBranch(dir: string, floorDir: string, branch: string): Promise<Checkedout> {
  const at = await floorRef(floorDir, branch);
  if (!at) throw new Error(`The project's folder has no ${branch} branch`);
  const before = await git(['rev-parse', '--verify', '--quiet', 'HEAD'], dir).catch(() => '');
  await git(['fetch', '--quiet', '--no-tags', floorDir, `+${at.ref}:refs/remotes/origin/${branch}`], dir, 300_000);
  await git(['checkout', '--quiet', '--force', '--detach', `refs/remotes/origin/${branch}`], dir);
  const [sha, subject, ct] = (await git(['log', '-1', '--format=%H%x00%s%x00%ct'], dir)).split('\0');
  return { sha, subject, ...(Number(ct) ? { at: Number(ct) * 1000 } : {}), moved: !!before && before !== sha };
}

export interface FloorLook {
  /** Whether the floor's folder could fetch its remote this time (always true with no remote). */
  ok: boolean;
  at: number;
  error?: string;
  /** Where its `branch` is now, in the folder. */
  head?: string;
}

/**
 * Has the floor's folder fetch its `branch` from GitHub (the office's shared fetch: at most one at a time
 * per folder, at most every `everyMs`, the office's credentials), then says where the branch is. With no
 * remote, the folder's own branch is all there is.
 */
export async function lookAtFloor(floorDir: string, branch: string, everyMs: number): Promise<FloorLook> {
  const hasRemote = !!(await git(['remote', 'get-url', 'origin'], floorDir).catch(() => ''));
  if (hasRemote) await fetchDefault(floorDir, branch, everyMs);
  const o = hasRemote ? fetchOutcome(floorDir) : undefined;
  const head = await floorRef(floorDir, branch);
  return { ok: o?.ok ?? true, at: o?.at ?? Date.now(), ...(o?.error ? { error: o.error } : {}), ...(head ? { head: head.sha } : {}) };
}

/** How many commits `to` has that `from` hasn't (undefined when either isn't in the folder). */
export async function commitsBetween(dir: string, from: string, to: string): Promise<number | undefined> {
  const n = await git(['rev-list', '--count', `${from}..${to}`], dir, 30_000).catch(() => '');
  return n === '' ? undefined : Number(n);
}

/** When a commit was made (ms), when the folder has it. */
export async function commitTime(dir: string, sha: string): Promise<number | undefined> {
  const ct = await git(['log', '-1', '--format=%ct', sha], dir, 30_000).catch(() => '');
  return Number(ct) ? Number(ct) * 1000 : undefined;
}

/** The Mendix project in the checkout: a .mpr at its top, or one folder down. */
export function findMpr(dir: string): string | undefined {
  const skip = new Set(['.git', 'node_modules', 'deployment', '.mxcli', 'theme', 'javascriptsource', 'javasource', 'widgets']);
  const look = (d: string): string | undefined => readdirSync(d).find((f) => f.toLowerCase().endsWith('.mpr') && statSync(path.join(d, f)).isFile());
  const top = look(dir);
  if (top) return path.join(dir, top);
  for (const sub of readdirSync(dir)) {
    if (skip.has(sub) || sub.startsWith('.')) continue;
    const full = path.join(dir, sub);
    if (!statSync(full).isDirectory()) continue;
    const found = look(full);
    if (found) return path.join(full, found);
  }
  return undefined;
}

/**
 * What mxbuild made last time, which a newer main can trip over: its first build then fails with
 * "Object reference not set to an instance of an object" though the model checks clean. The
 * database's files (deployment/data) stay.
 */
export const BUILD_LEFTOVERS = ['build', 'tmp', 'dojo-web', 'native', 'sass', 'log', 'build.gradle', 'build_core.xml', 'settings.gradle'];

/** Takes the last build's output out of a project folder; true when there was any. */
export function cleanBuild(projectDir: string): boolean {
  let any = false;
  for (const name of BUILD_LEFTOVERS) {
    const p = path.join(projectDir, 'deployment', name);
    if (!existsSync(p)) continue;
    rmSync(p, { recursive: true, force: true, maxRetries: 3, retryDelay: 500 });
    any = true;
  }
  return any;
}
