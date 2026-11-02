// What the Roadmap reads from the project and the office (shared/phases/view.ts ViewInput), local git only and
// off the event loop: the build plan at main with its done rows (roster/build-plan-source.ts, the same rows the
// automatic hand-off uses), the journeys at main (tests/**/*.journey.json), each journey's newest decided
// result on a commit on main (testing/'s run records), the merges on main that name build-plan rows, the newest
// mx check on main (security-gate/), the data-impact holds standing without an approval (data-impact/), and
// the budget ledger (budget/). What git gives is kept per main commit, so a view after main moved costs one
// read of each and an unchanged one none.

import { git, listFiles, mainOf, readFiles } from '../testing/repo.js';
import { testingStore } from '../testing/index.js';
import { buildPlanOf } from '../roster/build-plan-source.js';
import { handoffRows } from '../../shared/roster/handoff.js';
import { parseJourney, parsePlan, type JourneyDef } from '../../shared/liveapp/plan.js';
import { commitRows, prTitleRows } from '../../shared/liveapp/rows.js';
import { sameRevision, statusOf } from '../../shared/testing/record.js';
import type { GhPull } from '../../shared/protocol.js';

/** How many of main's commits count as "on main" for journey results and the mx check. */
export const MAIN_HISTORY = 400;

export interface RepoRead {
  main?: { sha: string; branch: string };
  planRows: { n: number; step: string; phase?: string }[];
  planPhases: { title: string; rows: { n: number }[] }[];
  done: number[];
  journeys: JourneyDef[];
  history: string[];
  merges: { pr?: number; sha: string; title: string; at: number; rows: number[] }[];
}

const kept = new Map<string, { sha: string; at: number; p: Promise<RepoRead> }>();
/** A read is kept this long even when main hasn't moved (rows done on branches change too). */
const FRESH_MS = 60_000;

/** The repository's side of the Roadmap, kept per main commit (and at most a minute). */
export function readRepo(dir: string, pulls: readonly GhPull[], now = Date.now()): Promise<RepoRead> {
  return mainOf(dir).then((main) => {
    if (!main) return { planRows: [], planPhases: [], done: [], journeys: [], history: [], merges: [] };
    const hit = kept.get(dir);
    if (hit && hit.sha === main.sha && now - hit.at < FRESH_MS) return hit.p;
    const p = readAt(dir, main, pulls);
    kept.set(dir, { sha: main.sha, at: now, p });
    if (kept.size > 100) kept.delete(kept.keys().next().value!);
    p.catch(() => kept.delete(dir));
    return p;
  });
}

async function readAt(dir: string, main: { sha: string; branch: string }, pulls: readonly GhPull[]): Promise<RepoRead> {
  const [plan, journeys, log] = await Promise.all([
    buildPlanOf(dir, pulls).catch(() => undefined),
    journeysAt(dir, main.sha),
    git(['log', '--first-parent', `-n${MAIN_HISTORY}`, '--format=%x01%H%x00%s%x00%b%x00%ct', main.sha], dir, undefined, 30_000),
  ]);
  const history: string[] = [];
  const merges: RepoRead['merges'] = [];
  for (const block of (log ?? '').split('\x01')) {
    const [sha = '', subject = '', body = '', ct = ''] = block.split('\0');
    if (!sha.trim()) continue;
    history.push(sha.trim());
    const pr = /^Merge pull request #(\d+)/.exec(subject)?.[1];
    const title = pr ? (body.trim().split('\n')[0] ?? subject) : subject;
    const rows = pr ? prTitleRows(title) : commitRows({ subject, files: [] });
    if (rows.length) merges.push({ ...(pr ? { pr: Number(pr) } : {}), sha: sha.trim(), title: title.slice(0, 160), at: Number(ct.trim()) * 1000 || 0, rows });
  }
  // A non-merge-commit history (squash merges, direct commits): every commit on main is "on main".
  if (!history.length) history.push(main.sha);
  const md = plan?.plan;
  return {
    main: { sha: main.sha, branch: main.branch },
    planRows: handoffRows(md).map((r) => ({ n: r.n, step: r.step, ...(r.phase ? { phase: r.phase } : {}) })),
    planPhases: parsePlan(md).phases.map((p) => ({ title: p.title, rows: p.rows.map((r) => ({ n: r.n })) })),
    done: plan?.done ?? [],
    journeys,
    history: await allOnMain(dir, main.sha, history),
    merges,
  };
}

/** Every commit on main (not only the first-parent line: a merged branch's own commits were tested too). */
async function allOnMain(dir: string, sha: string, firstParent: string[]): Promise<string[]> {
  const out = await git(['rev-list', `-n${MAIN_HISTORY * 2}`, sha], dir, undefined, 30_000);
  const all = (out ?? '').split('\n').map((s) => s.trim()).filter(Boolean);
  return all.length ? all : firstParent;
}

async function journeysAt(dir: string, sha: string): Promise<JourneyDef[]> {
  const files = (await listFiles(dir, sha, ['tests']).catch(() => [] as string[])).filter((f) => /\.journey\.json$/i.test(f)).slice(0, 300);
  const texts = await readFiles(dir, sha, files, 512 * 1024).catch(() => new Map<string, string>());
  return files.flatMap((f) => parseJourney(f, texts.get(f) ?? '') ?? []);
}

/** Each journey's newest decided result on a commit in `history` (main), by the test-run records' matching rule. */
export async function resultsOnMain(dataDir: string, floorId: string, history: readonly string[], ids: readonly string[]): Promise<Record<string, 'passed' | 'failed'>> {
  const out: Record<string, 'passed' | 'failed'> = {};
  if (!ids.length || !history.length) return out;
  const onMain = (rev: string) => history.some((h) => sameRevision(h, rev));
  const records = [...(await testingStore(dataDir, floorId).all().catch(() => []))].filter((r) => onMain(r.testedRevision)).sort((a, b) => b.ingestedAt - a.ingestedAt);
  const want = new Set(ids);
  for (const rec of records) {
    const suiteJourney = /^journey\s+(\S+)/i.exec(rec.suite)?.[1];
    for (const res of rec.results) {
      const status = statusOf(res.status);
      if (status !== 'passed' && status !== 'failed') continue;
      const named = new Set([res.name, ...res.links.map((l) => l.target), ...(suiteJourney && rec.results.length === 1 ? [suiteJourney] : [])]);
      for (const id of named) if (want.has(id) && !(id in out)) out[id] = status;
    }
  }
  return out;
}
