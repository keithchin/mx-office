// Developer changes wired to the office (service.ts, observe.ts, view.ts, recheck.ts): the record under
// <data>/dev-changes/, the team's lead and its conditions from the roster (at work, asleep, the spend cap) and
// the project's pause (project-run/), main's head from the project folder, the page/element recheck from the
// model's units, the hand-over through the C4 change requests (task id first, the roster's delivery), and for
// each change's state the task record, the roster, the PR list the project already polls, the live app's
// served revision and local git. Made once per office.
//
// It moves on events only: when the PR list comes back (office/floors.ts pullsChanged), when a worker of the
// project changes (debounced, and only for a project with a queued or active change in memory), and when the
// requests are read or a change is made or cancelled. No timer of its own polls anything.

import path from 'node:path';
import type { Ctx } from '../office/context.js';
import type { Floor } from '../floor.js';
import { audit } from '../audit/index.js';
import { rosterOf, teamFloor } from '../roster/adapter.js';
import { outcomeOf, type Assignment } from '../roster/resume.js';
import { isAsleepStatus } from '../roster/bench.js';
import { projectPause, projectPauseOf } from '../project-run/store.js';
import { validationBook } from '../guided-validation/index.js';
import { liveAppsIfMade } from '../liveapp/index.js';
import { defaultBranch, floorRef } from '../liveapp/checkout.js';
import { contains } from '../tasks/git.js';
import { git } from '../asks/sources.js';
import { modelOf } from '../model/index.js';
import { testingStore } from '../testing/index.js';
import { checkName, checkVerdict } from '../../shared/testing/record.js';
import { changeRequestBook } from '../change-requests/index.js';
import { localOnlyAt } from '../local-only.js';
import { managerOf } from '../../shared/roster/coverage.js';
import { activeOf, changeBranch, currentChange, queuedOf, type CheckResult, type DevChange, type DevChangesView, type DevChangeView, type StripFacts } from '../../shared/dev-changes.js';
import { ChangeStore } from './store.js';
import { DevChanges, type Who } from './service.js';
import { newCandidates, pullFor, type ChangePull } from './observe.js';
import { changeFacts, changeViews, stripFacts, type ChangeAssignment, type ViewInputs } from './view.js';
import { refGone } from './recheck.js';
import { ChangePolicies } from './policy.js';
import { linkPass } from './links.js';
import { dependsOn, relatedFor } from './related.js';
import { candidateHeld, endTask, flagPr, heldOn, mergedAt, relatedDeps, stopWorker } from './wire.js';

// The lifecycle's seams (cancel while active, supersede, retry, the data-impact guard on candidates, merged by git,
// the overlap reads) are in wire.ts; the link pass for old CR-n and MCR-n ids in links.ts (once per project per
// office start, append-only); possibly-related commits and the dependency note in related.ts.

interface Office {
  store: ChangeStore;
  changes: DevChanges;
  policies: ChangePolicies;
}

const offices = new WeakMap<object, Office>();
const mains = new Map<string, { at: number; p: Promise<string | undefined> }>();
const behinds = new Map<string, Promise<{ behind: number; ahead: number } | undefined>>();

/** Main's head in the project folder (origin's default branch, else the local one), kept for a few seconds. */
function mainHead(dir: string): Promise<string | undefined> {
  const had = mains.get(dir);
  if (had && Date.now() - had.at < 5_000) return had.p;
  const p = defaultBranch(dir)
    .then((b) => floorRef(dir, b))
    .then((r) => r?.sha.trim().toLowerCase())
    .catch(() => undefined);
  mains.set(dir, { at: Date.now(), p });
  return p;
}

/** How many commits `main` has that `served` hasn't, and the other way round (cached for good per pair). */
function behindBy(dir: string, served: string, main: string): Promise<{ behind: number; ahead: number } | undefined> {
  const key = `${dir}|${served}|${main}`;
  let p = behinds.get(key);
  if (!p) {
    p = git(['rev-list', '--left-right', '--count', `${served}...${main}`], dir).then((out) => {
      const m = /^(\d+)\s+(\d+)\s*$/.exec(out ?? '');
      return m ? { ahead: Number(m[1]), behind: Number(m[2]) } : undefined;
    });
    behinds.set(key, p);
    if (behinds.size > 200) behinds.delete(behinds.keys().next().value!);
  }
  return p;
}

/** The members of the project's team whose cover takes a request, with their worker. */
function leads(ctx: Ctx, floor: Floor) {
  const roster = rosterOf(ctx);
  const tf = teamFloor(ctx, floor);
  const d = roster.data(floor.id);
  const roles = [...new Set([managerOf(d.coverage), d.coverage.analysis])];
  return { roster, d, list: roles.map((role) => ({ m: d.members[role], w: d.members[role] ? roster.workerOf(tf, d.members[role]) : undefined })) };
}

function assignmentsOf(ctx: Ctx, floorId: string): ChangeAssignment[] {
  const out: ChangeAssignment[] = [];
  for (const m of Object.values(rosterOf(ctx).data(floorId).members) as { task?: Assignment; prevTasks?: Assignment[] }[]) {
    for (const t of [...(m.prevTasks ?? []), ...(m.task ? [m.task] : [])]) if (t.taskId) out.push({ taskId: t.taskId, outcome: outcomeOf(t) });
  }
  return out;
}

function previewOf(ctx: Ctx, floorId: string): StripFacts['preview'] {
  const live = liveAppsIfMade(ctx)?.peek(floorId);
  const serving = (live?.status === 'running' || live?.status === 'updating') && live.served?.sha;
  if (serving) return { status: 'running', served: live!.served!.sha };
  return { status: live?.status === 'starting' ? 'updating' : 'off', ...(live?.lastServed?.sha ? { lastServed: live.lastServed.sha } : {}) };
}

function inputsOf(ctx: Ctx, floor: Floor): Pick<ViewInputs, 'task' | 'assignments' | 'pulls' | 'preview' | 'contains' | 'mergedAt' | 'workerGone'> {
  const tasks = rosterOf(ctx).tasks.ids.of(floor.id);
  const p = previewOf(ctx, floor.id);
  return {
    task: (id) => tasks.get(floor.id, id),
    assignments: assignmentsOf(ctx, floor.id),
    pulls: floor.github.pulls.items as ChangePull[],
    preview: { running: p.status === 'running', ...(p.served ? { served: p.served } : {}) },
    contains: (sha, into) => contains(floor.dir, sha, into).catch(() => undefined),
    mergedAt: async (sha) => mergedAt(floor.dir, sha, await mainHead(floor.dir)),
    workerGone: (id) => !floor.workers.get(id),
  };
}

/** Whether a change has a "Looks right" review (guided validation's book). */
const triedOk = (ctx: Ctx, floorId: string) => {
  const reviews = validationBook(ctx).reviews(floorId);
  return (id: string) => !!reviews.get(id)?.some((r) => r.verdict === 'works');
};

const relatedOf = (ctx: Ctx, floor: Floor) => relatedDeps(ctx, floor, () => mainHead(floor.dir), triedOk(ctx, floor.id));

/** The office's Developer change queue. */
export function devChangesOf(ctx: Ctx): Office {
  let o = offices.get(ctx.cfg);
  if (o) return o;
  const store = new ChangeStore(path.join(ctx.cfg.dataDir, 'dev-changes'));
  const policies = new ChangePolicies(path.join(ctx.cfg.dataDir, 'dev-changes'));
  const floorOf = (id: string) => ctx.floors.get(id);
  const changes = new DevChanges({
    policy: (floorId) => policies.get(floorId),
    async stop(floorId, c, by) {
      const floor = floorOf(floorId);
      return floor ? stopWorker(ctx, floor, c, by) : { how: 'gone' };
    },
    endTask: (floorId, taskId, how, why) => endTask(ctx, floorId, taskId, how, why),
    async flagPr(floorId, pr, text) {
      const floor = floorOf(floorId);
      if (floor) await flagPr(floor, pr, text);
    },
    async held(floorId, c, f) {
      const floor = floorOf(floorId);
      return floor ? candidateHeld(ctx, floor, c, f) : false;
    },
    async depends(floorId, c, all) {
      const floor = floorOf(floorId);
      return floor ? dependsOn(c, all, relatedOf(ctx, floor)) : [];
    },
    store,
    now: () => Date.now(),
    blocked(floorId) {
      const floor = ctx.floors.get(floorId);
      if (!floor) return 'no-lead';
      const { roster, d, list } = leads(ctx, floor);
      const lead = list.find((x) => x.m && x.w && x.m.phase === 'active');
      if (!lead) return 'no-lead';
      if (projectPauseOf(floorId)) return 'paused';
      if (roster.pauseOf(d)) return 'cap';
      if (lead.w && isAsleepStatus(lead.w.status)) return 'asleep';
      return undefined;
    },
    mainHead: async (floorId) => {
      const floor = ctx.floors.get(floorId);
      return floor ? mainHead(floor.dir) : undefined;
    },
    async recheck(floorId, sha, ref) {
      const floor = ctx.floors.get(floorId);
      if (!floor) return undefined;
      const model = await modelOf(ctx).units.commit(floor.dir, sha).catch(() => null);
      return refGone(model, ref, sha.slice(0, 7));
    },
    async hand(floorId, c) {
      // The hand-over carries main as it is now, so the lead compares with the current main, not a stale one.
      const dir = ctx.floors.get(floorId)?.dir;
      const main = dir ? await mainHead(dir).catch(() => undefined) : undefined;
      const r = await changeRequestBook(ctx).request(floorId, { ...(main ? { main } : {}), text: c.text, page: c.page, pageMoved: c.pageMoved, revision: c.revision, by: c.by, ...(c.owner ? { owner: c.owner } : {}), change: { id: c.id, source: c.source, ...(c.ref ? { ref: c.ref } : {}) } });
      if (typeof r === 'string') return r;
      return { requestId: r.id, taskId: r.taskId, ...(r.executionId ? { executionId: r.executionId } : {}), member: r.member, role: r.role, ...(r.workerId ? { workerId: r.workerId } : {}), delivery: r.delivery };
    },
    async facts(floorId, c) {
      const floor = ctx.floors.get(floorId);
      if (!floor) return { queue: c.queue };
      return changeFacts(c, inputsOf(ctx, floor));
    },
    record: (e) => audit.record(e),
  });
  o = { store, changes, policies };
  offices.set(ctx.cfg, o);
  return o;
}

const linked = new WeakMap<object, Set<string>>();

/** The one-off link pass for a project (links.ts), once per office start: old CR-n and MCR-n ids become aliases. */
async function linkOnce(ctx: Ctx, floor: Floor, all: readonly DevChange[]): Promise<boolean> {
  let done = linked.get(ctx.cfg);
  if (!done) linked.set(ctx.cfg, (done = new Set()));
  if (done.has(floor.id)) return false;
  done.add(floor.id);
  return (await linkPass(devChangesOf(ctx).changes, ctx.cfg.dataDir, floor.id, all).catch(() => [])).length > 0;
}

const WEEK = 7 * 86_400_000;
/** A change whose worker was stopped (cancelled or superseded while the team had it) in the last week: late heads are noted, never counted. */
const stoppedLately = (c: DevChange, now: number) => (!!c.cancelled?.active && now - c.cancelled.at < WEEK) || (c.superseded?.was === 'active' && now - c.superseded.at < WEEK);

/**
 * Notes new candidate heads of the project's active change (its branch in the folder, its PRs) and late ones of a
 * change stopped lately, checks the active candidate against the data-impact guard, notes commits on main linked
 * or possibly related to open changes, then moves the queue.
 */
export async function observeChanges(ctx: Ctx, floor: Floor): Promise<void> {
  const { store, changes } = devChangesOf(ctx);
  let all = await store.all(floor.id).catch(() => [] as DevChange[]);
  if (await linkOnce(ctx, floor, all)) all = await store.all(floor.id);
  if (!all.length) return;
  const active = activeOf(all);
  const now = Date.now();
  const pulls = floor.github.pulls.items as ChangePull[];
  // The task record from before a restart, read once: how the active change's task ended.
  if (active) await rosterOf(ctx).tasks.ids.of(floor.id).load(floor.id).catch(() => undefined);
  for (const c of all.filter((x) => x === active || stoppedLately(x, now))) {
    const head = await floorRef(floor.dir, changeBranch(c.id)).catch(() => undefined);
    for (const cand of newCandidates(c, pulls, head?.sha.trim(), now)) await store.event(floor.id, c.id, { type: 'candidate', at: cand.seenAt, candidate: cand }).catch(() => undefined);
  }
  // The guard on the active change's newest candidate: a hold shows on its preview fact before it merges.
  if (active?.candidates.some((x) => !x.late)) await candidateHeld(ctx, floor, active).catch(() => undefined);
  // Commits on main linked or possibly related to an open change.
  const open = all.filter((c) => c.queue === 'queued' || c.queue === 'active' || c.queue === 'clarify');
  if (open.length) {
    const d = relatedOf(ctx, floor);
    const merges = new Set(all.flatMap((c) => pullFor(c, pulls)?.mergeCommit ?? []));
    for (const c of open) for (const e of await relatedFor(c, all, d, now, merges).catch(() => [])) await store.event(floor.id, c.id, e).catch(() => undefined);
  }
  if (active || queuedOf(all).length) await changes.advance(floor.id).catch(() => undefined);
}

const soon = new Map<string, ReturnType<typeof setTimeout>>();

/** A worker of the project changed: the queue may move (debounced; nothing to do for a project without queued or active changes). */
export function changesOnWorker(ctx: Ctx, floor: Floor): void {
  const o = offices.get(ctx.cfg);
  if (!o || !o.store.waiting(floor.id) || soon.has(floor.id)) return;
  const t = setTimeout(() => {
    soon.delete(floor.id);
    void observeChanges(ctx, floor);
  }, 1_500);
  t.unref?.();
  soon.set(floor.id, t);
}

/** Test runs that ran on one of the changes' candidates (or merge commits), as check results. */
async function checksOf(ctx: Ctx, floorId: string, all: readonly DevChange[], pulls: readonly ChangePull[]): Promise<CheckResult[]> {
  // Its candidates' heads, and its merge commit once merged (the relevant revision then).
  const shas = new Set(all.flatMap((c) => [...c.candidates.map((x) => x.sha), ...(pullFor(c, pulls)?.mergeCommit ? [pullFor(c, pulls)!.mergeCommit!] : [])]));
  if (!shas.size) return [];
  const recs = await testingStore(ctx.cfg.dataDir, floorId).all().catch(() => []);
  const out: CheckResult[] = [];
  for (const r of recs) {
    const rev = r.testedRevision?.toLowerCase();
    if (!rev || ![...shas].some((s) => s.startsWith(rev) || rev.startsWith(s))) continue;
    out.push({ revision: r.testedRevision, name: checkName(r), verdict: checkVerdict(r) });
  }
  return out;
}

/** The project's changes with their state, and the revision strip, for one viewer. */
export async function changesView(ctx: Ctx, floor: Floor, who: Who): Promise<DevChangesView> {
  await observeChanges(ctx, floor);
  const { store, changes, policies } = devChangesOf(ctx);
  const all = await store.all(floor.id).catch(() => [] as DevChange[]);
  const base = inputsOf(ctx, floor);
  const why = changes.whyQueued(floor.id, all);
  const policy = policies.get(floor.id);
  const rel = relatedOf(ctx, floor);
  const views = await changeViews(all, {
    ...base,
    ...(why ? { why } : {}),
    policy,
    checks: await checksOf(ctx, floor.id, all, base.pulls),
    hasCI: base.pulls.some((p) => (p as { checks?: string }).checks && (p as { checks?: string }).checks !== 'none'),
    // What people said after trying each change (its "Please try this" card), from guided validation's book.
    reviews: validationBook(ctx).reviews(floor.id),
    held: (c, merged) => heldOn(ctx, floor.id, c, merged),
    depends: (c, list) => dependsOn(c, list, rel),
    mayCancel: (c) => who.admin || (!!c.owner && c.owner === who.id),
  });
  const p = projectPause(floor.id);
  const main = await mainHead(floor.dir);
  const preview = previewOf(ctx, floor.id);
  const behind = main && preview.served ? await behindBy(floor.dir, preview.served, main) : undefined;
  const strip = stripFacts(main, preview, behind, views);
  const cur = currentChange(views);
  // A local-only project's receipt offers "Review and merge @C" to admins (server/local-merge/, the same path as the panel).
  const local = localOnlyAt(floor.dir);
  // Which branch actually carries each change on a candidate (local-merge/targets.ts): never a notes-only or gate-failed draft.
  if (local && who.admin) await withMergeTargets(ctx, floor, views);
  return { floor: floor.id, changes: views, strip, current: cur?.id ?? null, ...(p ? { pause: { by: p.by, at: p.at, why: p.why } } : {}), policy, mayPolicy: who.admin, ...(local ? { localOnly: true, mayMerge: who.admin } : {}) };
}

/** Adds the receipt's merge targets to the changes on a candidate (newest three), for a local-only project's admins. */
async function withMergeTargets(ctx: Ctx, floor: Floor, views: DevChangeView[]): Promise<void> {
  const on = views.filter((c) => c.state === 'candidate').slice(-3);
  if (!on.length) return;
  try {
    const { mergeTargetsFor, mergeAsks } = await import('../local-merge/targets.js');
    const asks = mergeAsks(ctx, floor.id);
    for (const c of on) c.mergeTargets = await mergeTargetsFor(ctx, floor, { id: c.id, ...(c.aliases ? { aliases: c.aliases } : {}), ...(c.activated?.workerId ? { workerId: c.activated.workerId } : {}) }, { asks }).catch(() => undefined);
  } catch {
    /* no targets: the receipt offers no merge */
  }
}
