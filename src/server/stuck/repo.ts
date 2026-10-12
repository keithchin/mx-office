// The project's files stuck detection reads, at main (origin/<default>, else the folder's HEAD), all
// through git started off the event loop (testing/repo.ts: one ls-tree, one cat-file --batch, one log)
// and only again when main moves. Never a write, never a fetch: the floor's own sync keeps main fresh.

import { lastCommits, listFiles, mainOf, readFiles } from '../testing/repo.js';
import type { RepoTexts } from './detect.js';
import { planJsonAsMarkdown } from './parse.js';

export const PLAN_MD = 'architecture/build-plan.md';
export const PLAN_JSON = 'architecture/build-plan.json';
export const PROJECT_MD = 'PROJECT.md';
export const REPORT_DIR = 'reports/testing';
/** The newest this many report files are searched for "#n". */
const MAX_REPORTS = 30;

export interface RepoRead extends RepoTexts {
  sha: string;
  /** When the build plan last changed at main (ISO), for the first guess at the last progress. */
  planChangedAt?: string;
}

const cache = new Map<string, Promise<RepoRead | undefined>>();

/** The files at main, read once per main commit. */
export async function readRepo(dir: string): Promise<RepoRead | undefined> {
  const main = await mainOf(dir);
  if (!main) return undefined;
  const key = `${dir}\0${main.sha}`;
  let p = cache.get(key);
  if (!p) {
    for (const k of cache.keys()) if (k.startsWith(`${dir}\0`)) cache.delete(k);
    p = readAt(dir, main.sha).catch(() => undefined);
    cache.set(key, p);
  }
  return p;
}

async function readAt(dir: string, sha: string): Promise<RepoRead> {
  const files = await listFiles(dir, sha, [PLAN_MD, PLAN_JSON, PROJECT_MD, REPORT_DIR]);
  const reports = files.filter((f) => f.startsWith(`${REPORT_DIR}/`) && /\.(json|md|xml|txt)$/i.test(f)).sort().slice(-MAX_REPORTS);
  const plan = files.includes(PLAN_MD) ? PLAN_MD : files.includes(PLAN_JSON) ? PLAN_JSON : undefined;
  const [texts, commits] = await Promise.all([readFiles(dir, sha, [...(plan ? [plan] : []), ...(files.includes(PROJECT_MD) ? [PROJECT_MD] : []), ...reports], 1024 * 1024), plan ? lastCommits(dir, sha, [plan], 50) : Promise.resolve(new Map<string, { sha: string; at: string }>())]);
  const at = (f: string | undefined) => (f && texts.has(f) ? { file: f, text: f === PLAN_JSON ? planJsonAsMarkdown(texts.get(f)!) : texts.get(f)! } : undefined);
  return {
    sha,
    ...(at(plan) ? { plan: at(plan) } : {}),
    ...(at(PROJECT_MD) ? { project: at(PROJECT_MD) } : {}),
    reports: reports.flatMap((f) => at(f) ?? []),
    ...(plan && commits.get(plan) ? { planChangedAt: commits.get(plan)!.at } : {}),
  };
}
