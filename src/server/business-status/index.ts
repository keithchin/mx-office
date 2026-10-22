// The business status's server side (shared/business-status.ts is the rule): what the pure function reads,
// put together from what the office already keeps, never a store of its own:
//   - the live app (liveapp/ peek): running, its served revision, main's head and the readiness judged at
//     the served revision (journey results for exactly that commit);
//   - the roster's tasks: open ones, and merged ones the merge gate left unreviewed (E5);
//   - the PR list: open pull requests and their checks;
//   - the verification policy evaluated at the served revision (testing/, the same rule as task
//     verification and the acceptance record's Testing summary);
//   - the security baseline's release gate at the served revision (security-gate/, E2), asked only once
//     the work is built into the running build, so a project with nothing running costs no model read;
//   - the current delivery cycle and what changed since its acceptance (acceptance/).
// No approval policy store exists yet: the policy is off. One answer per project is kept a few seconds
// and shared by everyone asking meanwhile (Home, the phone, the progress bar, the Overview); the function
// itself is memoised per input.

import { businessStatuses, summaryOf, type BusinessInput, type BusinessMilestone, type BusinessStatusView, type BusinessSummary } from '../../shared/business-status.js';
import type { Cycle } from '../../shared/acceptance.js';
import { DEFAULT_POLICY, evaluatePolicy } from '../../shared/testing/policy.js';
import type { LiveAppState } from '../../shared/protocol/liveapp.js';
import type { Floor } from '../floor.js';
import type { Ctx } from '../office/context.js';
import { dropKeys, onForgetFloor } from '../office/forget.js';
import { liveAppsIfMade } from '../liveapp/index.js';
import { acceptanceStore, changedNow, onAcceptanceChange } from '../acceptance/index.js';
import { rosterOf } from '../roster/adapter.js';
import { outcomeOf, type Assignment } from '../roster/resume.js';
import { testingStore } from '../testing/index.js';
import { verifyStore } from '../testing/verify.js';
import { securityOf } from '../security-gate/index.js';

/** An answer is handed out again for this long (ms). */
export const BUSINESS_FRESH_MS = 5_000;

const cache = new Map<string, { at: number; key: string; p: Promise<BusinessStatusView> }>();
onForgetFloor((f) => dropKeys(cache, f));
onAcceptanceChange((floorId) => void cache.delete(floorId));

const BUILT = new Set(['ready', 'unverified', 'no-evidence']);

/** The readiness milestones as the rule reads them. */
function milestonesOf(s: LiveAppState): BusinessMilestone[] {
  return (s.readiness?.milestones ?? []).map((m) => ({ id: m.id, title: m.title, state: m.state, journeys: m.journeys, rows: m.rows, inLive: m.inLive, onMain: m.onMain, onBranch: m.onBranch.map((b) => ({ branch: b.branch, ...(b.pr ? { pr: b.pr } : {}), rows: b.rows })), missing: m.missing }));
}

/** Open tasks and merged-but-unreviewed ones, from the roster's members (their task and the few before it). */
function tasksOf(ctx: Ctx, floor: Floor): { open: number; unreviewed: { pr: number; why?: string }[] } | undefined {
  try {
    const d = rosterOf(ctx).data(floor.id);
    let open = 0;
    const unreviewed = new Map<number, string>();
    for (const m of Object.values(d.members) as { task?: Assignment; prevTasks?: Assignment[] }[]) {
      if (m.task && outcomeOf(m.task) === 'open') open++;
      for (const t of [...(m.prevTasks ?? []), ...(m.task ? [m.task] : [])]) if (t.unreviewed && t.outcome === 'integrated') unreviewed.set(t.unreviewed.pr, t.unreviewed.why);
    }
    return { open, unreviewed: [...unreviewed].sort((a, b) => a[0] - b[0]).map(([pr, why]) => ({ pr, why })) };
  } catch {
    return undefined;
  }
}

/** What the function reads for `floor` now. `pre` hands in the acceptance part a caller already has (the progress bar). */
export async function businessInputOf(ctx: Ctx, floor: Floor, pre?: { cycles: readonly Cycle[]; changed: string[] }): Promise<BusinessInput> {
  const live = liveAppsIfMade(ctx)?.peek(floor.id);
  const input: BusinessInput = {};
  if (live) {
    input.live = { running: live.status === 'running' && !!live.served, ...(live.served ? { served: live.served.sha } : {}) };
    if (live.main?.sha) input.main = { sha: live.main.sha, ...(live.branch ? { branch: live.branch } : {}) };
    if (live.readiness) input.readiness = { ...(live.readiness.sha ? { sha: live.readiness.sha } : {}), milestones: milestonesOf(live), ...(live.readiness.note ? { note: live.readiness.note } : {}) };
  }
  const tasks = tasksOf(ctx, floor);
  if (tasks) input.work = { ...tasks, openPrs: floor.github.pulls.items.filter((p) => p.state === 'OPEN').map((p) => ({ number: p.number, ...(p.isDraft ? { draft: true } : {}), checks: p.checks })) };
  // The current delivery cycle and what changed since its acceptance (the head alone: no deliverables scan).
  try {
    const cycles = pre?.cycles ?? acceptanceStore(ctx.cfg.dataDir, floor.id).cycles();
    const cur = cycles[cycles.length - 1];
    if (cur) {
      const rec = cur.record;
      const changed = rec ? (pre?.changed ?? (await changedNow(ctx, floor, cycles, true).catch(() => []))) : [];
      input.acceptance = { version: cur.version, ...(rec ? { accepted: { ...(rec.source.commit ? { commit: rec.source.commit } : {}), ...(rec.source.branch ? { branch: rec.source.branch } : {}), at: rec.acceptedAt, by: rec.acceptedBy.name, ...(rec.source.deploy ? { deploy: rec.source.deploy } : {}) } } : {}), changed };
    }
  } catch {
    // Not a project id the store takes: no delivery cycle to say anything about.
  }
  input.policy = { on: false };
  // Verification inputs only once something is built into the running build: they're what that step reads.
  const served = input.live?.running ? input.live.served : undefined;
  if (served && input.readiness?.sha === served && input.readiness.milestones.some((m) => BUILT.has(m.state))) {
    const [checks, security] = await Promise.all([checksAt(ctx, floor, served), securityAt(ctx, floor, served)]);
    if (checks) input.checks = checks;
    if (security) input.security = security;
  }
  return input;
}

async function checksAt(ctx: Ctx, floor: Floor, revision: string): Promise<BusinessInput['checks']> {
  try {
    const [file, records] = await Promise.all([verifyStore(ctx.cfg.dataDir, floor.id).read(), testingStore(ctx.cfg.dataDir, floor.id).all()]);
    const policy = file.policy ? { v: 1 as const, required: file.policy.required, linkedCriteria: file.policy.linkedCriteria } : DEFAULT_POLICY;
    const ev = evaluatePolicy(policy, records, revision, { waivers: file.waivers });
    return { revision, required: ev.checks.map((c) => ({ label: c.label, state: c.state })) };
  } catch {
    return undefined;
  }
}

async function securityAt(ctx: Ctx, floor: Floor, revision: string): Promise<BusinessInput['security']> {
  try {
    const g = await securityOf(ctx).gate(floor, 'release', revision);
    return { revision, meets: g.meets, enforced: g.enforced, missing: g.missing, ...(g.noApp ? { noApp: true } : {}) };
  } catch {
    return undefined;
  }
}

async function compute(ctx: Ctx, floor: Floor, pre?: { cycles: readonly Cycle[]; changed: string[] }): Promise<BusinessStatusView> {
  const { project, milestones } = businessStatuses(await businessInputOf(ctx, floor, pre));
  return { floor: floor.id, project, milestones, generatedAt: Date.now() };
}

/** The project's business status and each milestone's, shared for BUSINESS_FRESH_MS. Never throws. */
export async function businessViewOf(ctx: Ctx, floor: Floor, pre?: { cycles: readonly Cycle[]; changed: string[] }, now = Date.now()): Promise<BusinessStatusView | undefined> {
  // A change of what runs (served revision, readiness, status) lets go of the answer at once.
  const live = liveAppsIfMade(ctx)?.peek(floor.id);
  const key = live ? `${live.status}|${live.served?.sha ?? ''}|${live.readiness?.at ?? ''}|${live.main?.sha ?? ''}` : '';
  const hit = cache.get(floor.id);
  let p = hit && hit.key === key && now - hit.at < BUSINESS_FRESH_MS ? hit.p : undefined;
  if (!p) {
    p = compute(ctx, floor, pre);
    cache.set(floor.id, { at: now, key, p });
    p.catch(() => cache.get(floor.id)?.p === p && cache.delete(floor.id));
  }
  try {
    return await p;
  } catch {
    return undefined;
  }
}

/** The project's status as a card shows it (Home, the phone, the Teams digest), or undefined when it can't be read. */
export async function businessSummaryOf(ctx: Ctx, floor: Floor): Promise<BusinessSummary | undefined> {
  const v = await businessViewOf(ctx, floor);
  return v ? summaryOf(v.project) : undefined;
}
