// Testing release 2's wiring into the office: after each new PR list (floors.ts pullsChanged, the
// board's own poll), one pass per floor, never two at once: the default branch's CI runs taken in
// (main-checks.ts, at most once per poll), every integrated task judged on its merge commit, and the
// test-first prompt. Plus the acceptance record's Testing summary (acceptance/index.ts asks for it).
// All of it only while "Judge merged tasks against checks" is on (switches.ts, off by default), and then
// only for PRs merged after it was turned on; the automatic quality run only while "Score main
// automatically with mxcli" is on.

import { DEFAULT_POLICY, evaluatePolicy, type PolicyEval, type VerificationPolicy } from '../../shared/testing/policy.js';
import type { TestingView } from '../../shared/testing/view.js';
import type { TestingSummary } from '../../shared/testing/verify.js';
import type { Floor } from '../floor.js';
import type { Ctx } from '../office/context.js';
import { onForgetFloor } from '../office/forget.js';
import { rosterOf, teamFloor } from '../roster/adapter.js';
import { setupView } from '../wizard/setup.js';
import { acJourneys, officeDeps, testingAt, testingStore, testingView } from './index.js';
import { MainChecks, officeRunner, type GhRun } from './main-checks.js';
import { qualityOnMain, type MxDeps } from './mxcli-office.js';
import type { Roster } from '../roster/index.js';
import type { TeamFloor } from '../roster/types.js';
import { mainOf } from './repo.js';
import { testingSwitches } from './switches.js';
import { forgetVerifyStores, projectPolicy, stageLookOf, testFirst, verifyStore, verifyTasks } from './verify.js';

onForgetFloor((f) => forgetVerifyStores(f.id));

const offices = new WeakMap<object, MainChecks>();
const mainChecksOf = (ctx: Ctx, runner: (dir: string) => GhRun | undefined) => {
  let m = offices.get(ctx.cfg);
  if (!m) offices.set(ctx.cfg, (m = new MainChecks(runner)));
  return m;
};

/** What a pass uses, injectable for the tests: gh for the main-branch checks, the roster and its floor, mxcli. */
export interface PassDeps {
  runner?: (dir: string) => GhRun | undefined;
  roster?: Roster;
  team?: TeamFloor;
  mx?: MxDeps;
}

/** The PR list each floor was last handled for, and the floors with a pass under way. */
const seen = new Map<string, number>();
const busy = new Set<string>();

/** One pass for a floor whose PR list just came back. Fire and forget: failures are logged, never thrown. */
export async function verifyOnPulls(ctx: Ctx, floor: Floor, deps: PassDeps = {}): Promise<void> {
  const pulls = floor.github.pulls;
  if (!floor.workers || pulls.loading || !pulls.fetchedAt || seen.get(floor.id) === pulls.fetchedAt || busy.has(floor.id)) return;
  seen.set(floor.id, pulls.fetchedAt);
  // The safety switches (switches.ts), both off by default: then nothing here runs at all.
  const sw = testingSwitches();
  if (!sw.judge && !sw.autoScore) return;
  busy.add(floor.id);
  try {
    const main = await mainOf(floor.dir);
    // Release 1b: a new main commit gets its quality scores (once per commit and mxcli version, in the office's work folder).
    if (sw.autoScore) void qualityOnMain(ctx.cfg.dataDir, floor, main, deps.mx);
    if (!sw.judge) return;
    const mc = mainChecksOf(ctx, deps.runner ?? officeRunner);
    const look = { floorId: floor.id, dir: floor.dir, repo: floor.def.repo, pullsAt: pulls.fetchedAt, loading: false };
    if (mc.due(look) && main?.remote) await testingStore(ctx.cfg.dataDir, floor.id).ingest(await mc.poll({ ...look, branch: main.branch }));
    const roster = deps.roster ?? rosterOf(ctx);
    const team = deps.team ?? teamFloor(ctx, floor);
    await verifyTasks(ctx.cfg.dataDir, roster, team, floor, await acJourneys(floor.id), sw.judgeSince ?? Date.now());
    const stage = stageLookOf(setupView(floor.dir));
    if (stage?.stage4 && !stage.stage5) {
      const view = await testingView(ctx.cfg.dataDir, floor, officeDeps(ctx));
      await testFirst(ctx.cfg.dataDir, roster, team, stage, view.counts.coverage.none);
    }
  } catch (err) {
    console.error(`  testing verification on ${floor.id}: ${(err as Error).message}`);
  } finally {
    busy.delete(floor.id);
  }
}

/** A policy or waiver changed: judge the floor's tasks again now, not at the next poll. */
export async function reverify(ctx: Ctx, floor: Floor): Promise<void> {
  const sw = testingSwitches();
  if (!floor.workers || !sw.judge) return;
  await verifyTasks(ctx.cfg.dataDir, rosterOf(ctx), teamFloor(ctx, floor), floor, await acJourneys(floor.id), sw.judgeSince ?? Date.now()).catch(() => 0);
}

/** The Testing summary at the accepted commit; undefined when it can't be read (the record goes on without it). */
export async function testingSummary(ctx: Ctx, floor: Floor, commit: string): Promise<TestingSummary | undefined> {
  try {
    const [view, p, file, records] = await Promise.all([testingAt(ctx.cfg.dataDir, floor, commit, officeDeps(ctx)), projectPolicy(ctx.cfg.dataDir, floor.id), verifyStore(ctx.cfg.dataDir, floor.id).read(), testingStore(ctx.cfg.dataDir, floor.id).all()]);
    return summaryOf(view, commit, p.policy, p.from, evaluatePolicy(p.policy ?? DEFAULT_POLICY, records, commit, { waivers: file.waivers }));
  } catch {
    return undefined;
  }
}

export function summaryOf(view: TestingView, commit: string, policy: VerificationPolicy, from: 'default' | 'project', evaluation: PolicyEval): TestingSummary {
  return { v: 1, commit, cacheKey: view.cacheKey, counts: view.counts, totalRuns: view.totalRuns, policy, policyFrom: from, evaluation, notes: view.notes.slice(0, 5) };
}
