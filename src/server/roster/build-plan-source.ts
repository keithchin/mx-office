// The build plan and its done rows for the automatic hand-off (handoff.ts), from the real office: the plan at main
// (architecture/build-plan.md), the rows with build evidence on main and the team's pushed branches
// (wizard/build-evidence.ts, cached a minute per commit), and the rows the Lead's own branch names in its commit
// subjects since main ("Row 12: …", "Rows 13-14: …") for work not pushed yet. Local git only, off the event loop.

import { execFileOff } from '../offloop/exec.js';
import { mainOf } from '../testing/repo.js';
import { evidenceFor } from '../wizard/build-evidence.js';
import { rowsIn } from '../../shared/build-progress.js';
import type { GhPull } from '../../shared/protocol/github.js';

const ENV = { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0' };
const git = (args: string[], cwd: string) =>
  new Promise<string | undefined>((resolve) => execFileOff('git', args, { cwd, maxBuffer: 8 * 1024 * 1024, timeout: 20_000, env: ENV, windowsHide: true }, (err, out) => resolve(err ? undefined : String(out))));

/** The plan at main and the rows done (evidence on main or a branch, or named by `branch`'s commits since main). */
export async function buildPlanOf(dir: string, pulls: readonly GhPull[], branch?: string): Promise<{ plan: string; done: number[] } | undefined> {
  const main = await mainOf(dir);
  if (!main) return undefined;
  const plan = await git(['show', `${main.sha}:architecture/build-plan.md`], dir);
  if (!plan?.trim()) return undefined;
  const ev = await evidenceFor(dir, main.branch, main.sha, pulls);
  const done = new Set<number>([...(ev?.build.rows?.main ?? []), ...(ev?.build.rows?.branch ?? [])]);
  if (branch && /^[\w./-]+$/.test(branch)) {
    const subjects = (await git(['log', '--format=%s', '-n200', `${main.sha}..refs/heads/${branch}`], dir)) ?? '';
    for (const s of subjects.split('\n')) if (/^\s*rows?\s+\d/i.test(s)) for (const n of rowsIn(s)) done.add(n);
  }
  return { plan, done: [...done].sort((a, b) => a - b) };
}
