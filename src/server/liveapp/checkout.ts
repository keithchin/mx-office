// The live app's own checkout of a floor's main: a clone in the office's data folder, never the
// floor's checkout (people and agents work in that) nor an agent's worktree. It's cloned from the
// floor's checkout (quick, and it shares its objects) and then follows the floor's GitHub remote.

import { execFile } from 'node:child_process';
import { existsSync, readdirSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';

function git(args: string[], cwd: string, timeout = 120_000): Promise<string> {
  return new Promise((resolve, reject) => {
    // Mendix projects carry node_modules deep in javascriptsource/: past Windows' 260-character paths once inside the office's data folder.
    execFile('git', ['-c', 'core.longpaths=true', ...args], { cwd, timeout, maxBuffer: 8 * 1024 * 1024, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } }, (err, stdout, stderr) => {
      if (err) reject(new Error(`git ${args[0]}: ${(stderr || err.message).trim().split('\n').slice(-2).join(' ')}`));
      else resolve(stdout.trim());
    });
  });
}

/** Clones the floor into `dir` the first time, pointing it at the floor's own remote (`remote`) when it has one. */
export async function ensureCheckout(dir: string, floorDir: string, remote: string | undefined): Promise<void> {
  if (existsSync(path.join(dir, '.git'))) return;
  rmSync(dir, { recursive: true, force: true });
  await git(['clone', '--quiet', '--no-checkout', floorDir, dir], path.dirname(dir), 600_000);
  if (remote) await git(['remote', 'set-url', 'origin', remote], dir);
}

/** The branch the remote calls its default ("main"), or "main" when it won't say. */
export async function defaultBranch(dir: string): Promise<string> {
  try {
    const out = await git(['ls-remote', '--symref', 'origin', 'HEAD'], dir, 30_000);
    return /^ref:\s+refs\/heads\/(\S+)\s+HEAD/m.exec(out)?.[1] ?? 'main';
  } catch {
    return 'main';
  }
}

/** The commit `branch` is at on the remote right now (git ls-remote, no fetch). */
export async function remoteHead(dir: string, branch: string): Promise<string | undefined> {
  const out = await git(['ls-remote', 'origin', `refs/heads/${branch}`], dir, 30_000);
  return /^([0-9a-f]{40})\s/m.exec(out)?.[1];
}

export interface Checkedout {
  sha: string;
  subject: string;
  /** Whether the checkout moved to another commit (what was built before is stale then). */
  moved: boolean;
}

/** Fetches `branch` and puts the checkout on it, files the app makes (deployment/, .mxcli/) left alone. */
export async function pullBranch(dir: string, branch: string): Promise<Checkedout> {
  const before = await git(['rev-parse', '--verify', '--quiet', 'HEAD'], dir).catch(() => '');
  await git(['fetch', '--quiet', 'origin', `+refs/heads/${branch}:refs/remotes/origin/${branch}`], dir, 300_000);
  await git(['checkout', '--quiet', '--force', '--detach', `origin/${branch}`], dir);
  const sha = await git(['rev-parse', 'HEAD'], dir);
  const subject = await git(['log', '-1', '--format=%s'], dir);
  return { sha, subject, moved: !!before && before !== sha };
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
