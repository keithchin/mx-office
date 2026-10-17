// What the live app's commit has of the project's plan (shared/liveapp/readiness.ts), read with git in the
// floor's folder: the build plan and the journeys at main, the build-plan rows each commit gives evidence
// for (shared/liveapp/rows.ts) on main, in the running build's history and on each unmerged origin branch,
// the open pull request of each branch from the board's list, and the journey results the test-run store
// holds for exactly the running commit. All git off the event loop (testing/repo.ts), read-only, nothing
// fetched; each history read is kept per commit, so a new reading after main moves costs one log.

import { git, listFiles, readFiles } from '../testing/repo.js';
import { testingStore } from '../testing/index.js';
import { computeReadiness, type LiveReadiness } from '../../shared/liveapp/readiness.js';
import { parseJourney, parsePlan, type JourneyDef } from '../../shared/liveapp/plan.js';
import { buildLogRows, commitRows, rowsIn } from '../../shared/liveapp/rows.js';
import { sameRevision, statusOf } from '../../shared/testing/record.js';
import type { GhPull, LiveAppMain } from '../../shared/protocol.js';
import { commitTime, commitsBetween, defaultBranch, floorRef } from './checkout.js';

export const PLAN_FILE = 'architecture/build-plan.md';
const BUILD_LOG = 'docs/BUILD-LOG.md';
/** At most this many commits of one history are read for row evidence. */
const MAX_COMMITS = 3000;
/** At most this many unmerged branches are looked at. */
const MAX_BRANCHES = 15;

/** Rows per history (`<floorDir>|<range>`), kept while the commits are the same. */
const histories = new Map<string, Promise<Set<number>>>();

/** The rows with build evidence in a range of commits ("<sha>" or "<main>..<branch>"), and the BUILD-LOG at `tip`. */
function rowsOf(dir: string, range: string, tip: string): Promise<Set<number>> {
  const key = `${dir}|${range}`;
  const had = histories.get(key);
  if (had) return had;
  const p = (async () => {
    const out = (await git(['log', `-n${MAX_COMMITS}`, '--no-renames', '--format=%x01%H%x00%s%x00%b%x02', '--name-only', range], dir, undefined, 60_000)) ?? '';
    const rows = new Set<number>();
    for (const block of out.split('\x01')) {
      const [head, names = ''] = block.split('\x02');
      const [, subject = '', body = ''] = (head ?? '').split('\0');
      if (!subject) continue;
      // A merged pull request's merge commit: its title is the body's first line ("Rows 4-14: domain and seed").
      if (/^Merge pull request #\d+/.test(subject)) {
        for (const r of rowsIn(body.split('\n')[0] ?? '')) rows.add(r);
        continue;
      }
      const files = names.split('\n').map((f) => f.trim()).filter(Boolean);
      for (const r of commitRows({ subject, files })) rows.add(r);
    }
    const log = await git(['show', `${tip}:${BUILD_LOG}`], dir);
    for (const r of buildLogRows(log)) rows.add(r);
    return rows;
  })();
  histories.set(key, p);
  if (histories.size > 200) histories.delete(histories.keys().next().value!);
  p.catch(() => histories.delete(key));
  return p;
}

const journeysAt = new Map<string, Promise<JourneyDef[]>>();

/** The journeys at a commit (tests/**\/*.journey.json, broken controls left out). */
function journeysOf(dir: string, sha: string): Promise<JourneyDef[]> {
  const key = `${dir}|${sha}`;
  let p = journeysAt.get(key);
  if (!p) {
    p = (async () => {
      const files = (await listFiles(dir, sha, ['tests'])).filter((f) => /\.journey\.json$/i.test(f)).slice(0, 200);
      const texts = await readFiles(dir, sha, files, 512 * 1024);
      return files.flatMap((f) => parseJourney(f, texts.get(f) ?? '') ?? []);
    })();
    journeysAt.set(key, p);
    if (journeysAt.size > 50) journeysAt.delete(journeysAt.keys().next().value!);
  }
  return p;
}

/** The unmerged origin branches with commits main hasn't, newest first. */
async function branchesOf(dir: string, def: string, main: string): Promise<{ branch: string; sha: string }[]> {
  const out = (await git(['for-each-ref', '--sort=-committerdate', '--format=%(refname:short)%00%(objectname)', 'refs/remotes/origin'], dir)) ?? '';
  const all = out
    .split('\n')
    .map((l) => l.split('\0'))
    .filter(([r, sha]) => r && sha && r !== 'origin/HEAD' && r !== 'origin' && r !== `origin/${def}` && sha !== main)
    .map(([r, sha]) => ({ branch: r.replace(/^origin\//, ''), sha }));
  return all.slice(0, MAX_BRANCHES);
}

/** The newest decided result of each journey among test runs of exactly `sha`. */
async function journeyResults(dataDir: string, floorId: string, sha: string, ids: readonly string[]): Promise<{ journey: string; status: 'passed' | 'failed' }[]> {
  if (!ids.length) return [];
  const records = [...(await testingStore(dataDir, floorId).all().catch(() => []))].filter((r) => sameRevision(r.testedRevision, sha)).sort((a, b) => b.ingestedAt - a.ingestedAt);
  const out: { journey: string; status: 'passed' | 'failed' }[] = [];
  const seen = new Set<string>();
  for (const rec of records) {
    const suiteJourney = /^journey\s+(\S+)/i.exec(rec.suite)?.[1];
    for (const res of rec.results) {
      const status = statusOf(res.status);
      if (status !== 'passed' && status !== 'failed') continue;
      const named = new Set([res.name, ...res.links.map((l) => l.target), ...(suiteJourney && rec.results.length === 1 ? [suiteJourney] : [])]);
      for (const id of ids) {
        if (seen.has(id) || !named.has(id)) continue;
        seen.add(id);
        out.push({ journey: id, status });
      }
    }
  }
  return out;
}

export interface ReadinessLook {
  dataDir: string;
  floorId: string;
  floorDir: string;
  /** The running build's commit, when it runs. */
  live?: string;
  running: boolean;
  pulls: readonly GhPull[];
  now?: number;
}

/** Where main is against the running build, and the running build's readiness by milestone. */
export async function readReadiness(l: ReadinessLook): Promise<{ main?: LiveAppMain; readiness?: LiveReadiness }> {
  const def = await defaultBranch(l.floorDir);
  const head = await floorRef(l.floorDir, def);
  if (!head) return {};
  const main: LiveAppMain = { sha: head.sha, behind: 0 };
  const at = await commitTime(l.floorDir, head.sha);
  if (at) main.at = at;
  let liveKnown = !!l.live;
  if (l.live) {
    const behind = await commitsBetween(l.floorDir, l.live, head.sha);
    if (behind === undefined) liveKnown = false;
    else main.behind = behind;
  }
  const planMd = (await git(['show', `${head.sha}:${PLAN_FILE}`], l.floorDir)) ?? (l.live && liveKnown ? await git(['show', `${l.live}:${PLAN_FILE}`], l.floorDir) : undefined);
  const plan = parsePlan(planMd);
  const [mainRows, liveRows, journeys, branches] = await Promise.all([rowsOf(l.floorDir, head.sha, head.sha), l.live && liveKnown ? rowsOf(l.floorDir, l.live, l.live) : Promise.resolve(new Set<number>()), journeysOf(l.floorDir, head.sha), branchesOf(l.floorDir, def, head.sha)]);
  const open = (b: string) => l.pulls.find((p) => p.headRefName === b && p.state === 'OPEN');
  const branchRows = await Promise.all(
    branches.map(async (b) => {
      const rows = new Set(await rowsOf(l.floorDir, `${head.sha}..${b.sha}`, b.sha));
      for (const r of mainRows) rows.delete(r);
      const pr = open(b.branch);
      return { branch: b.branch, rows, ...(pr ? { pr: { number: pr.number, ...(pr.isDraft ? { draft: true } : {}) } } : {}) };
    }),
  );
  const results = l.live && liveKnown && l.running ? await journeyResults(l.dataDir, l.floorId, l.live, journeys.map((j) => j.id)) : [];
  const readiness = computeReadiness({
    plan,
    ...(planMd !== undefined ? { planFile: PLAN_FILE } : {}),
    running: l.running && liveKnown,
    ...(l.live && liveKnown ? { live: { sha: l.live, rows: liveRows } } : {}),
    main: { sha: head.sha, branch: def, rows: mainRows },
    branches: branchRows.filter((b) => b.rows.size),
    journeys,
    results,
    now: l.now ?? Date.now(),
  });
  if (l.live && !liveKnown) readiness.note = `The running commit ${l.live.slice(0, 7)} isn't in the project's folder, so the office can't say what it has`;
  return { main, readiness };
}
