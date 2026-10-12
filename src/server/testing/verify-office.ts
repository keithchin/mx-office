// Testing release 2's wiring into the office: after each new PR list (floors.ts pullsChanged, the
// board's own poll), one pass per floor, never two at once: the default branch's CI runs taken in
// (main-checks.ts, at most once per poll), every integrated task judged on its merge commit, and the
// test-first prompt. Plus the acceptance record's Testing summary (acceptance/index.ts asks for it).

import { DEFAULT_POLICY, evaluatePolicy, type PolicyEval, type VerificationPolicy } from '../../shared/testing/policy.js';
import type { TestingView } from '../../shared/testing/view.js';
import type { TestingSummary } from '../../shared/testing/verify.js';
import type { Floor } from '../floor.js';
import type { Ctx } from '../office/context.js';
import { onForgetFloor } from '../office/forget.js';
import { rosterOf, teamFloor } from '../roster/adapter.js';
import { setupView } from '../wizard/setup.js';
import { acJourneys, officeDeps, testingAt, testingStore, testingView } from './index.js';
import { MainChecks, officeRunner } from './main-checks.js';
import { qualityOnMain } from './mxcli-office.js';
import { mainOf } from './repo.js';
import { forgetVerifyStores, projectPolicy, stageLookOf, testFirst, verifyStore, verifyTasks } from './verify.js';

onForgetFloor((f) => forgetVerifyStores(f.id));

const offices = new WeakMap<object, MainChecks>();
const mainChecksOf = (ctx: Ctx) => {
  let m = offices.get(ctx.cfg);
  if (!m) offices.set(ctx.cfg, (m = new MainChecks(officeRunner)));
  return m;
};

/** The PR list each floor was last handled for, and the floors with a pass under way. */
const seen = new Map<string, number>();
const busy = new Set<string>();

/** One pass for a floor whose PR list just came back. Fire and forget: failures are logged, never thrown. */
export async function verifyOnPulls(ctx: Ctx, floor: Floor): Promise<void> {
  const pulls = floor.github.pulls;
  if (!floor.workers || pulls.loading || !pulls.fetchedAt || seen.get(floor.id) === pulls.fetchedAt || busy.has(floor.id)) return;
  seen.set(floor.id, pulls.fetchedAt);
  busy.add(floor.id);
  try {
    const mc = mainChecksOf(ctx);
    const look = { floorId: floor.id, dir: floor.dir, repo: floor.def.repo, pullsAt: pulls.fetchedAt, loading: false };
    const main = await mainOf(floor.dir);
    if (mc.due(look) && main?.remote) await testingStore(ctx.cfg.dataDir, floor.id).ingest(await mc.poll({ ...look, branch: main.branch }));
    // Release 1b: a new main commit gets its quality scores (once per commit and mxcli version, in the office's work folder).
    void qualityOnMain(ctx.cfg.dataDir, floor, main);
    const roster = rosterOf(ctx);
    const team = teamFloor(ctx, floor);
    await verifyTasks(ctx.cfg.dataDir, roster, team, floor, await acJourneys(floor.id));
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
  if (!floor.workers) return;
  await verifyTasks(ctx.cfg.dataDir, rosterOf(ctx), teamFloor(ctx, floor), floor, await acJourneys(floor.id)).catch(() => 0);
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
