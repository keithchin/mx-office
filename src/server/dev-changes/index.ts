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
import { projectPauseOf } from '../project-run/store.js';
import { liveAppsIfMade } from '../liveapp/index.js';
import { defaultBranch, floorRef } from '../liveapp/checkout.js';
import { contains } from '../tasks/git.js';
import { git } from '../asks/sources.js';
import { modelOf } from '../model/index.js';
import { testingStore } from '../testing/index.js';
import { changeRequestBook } from '../change-requests/index.js';
import { managerOf } from '../../shared/roster/coverage.js';
import { activeOf, changeBranch, currentChange, queuedOf, type CheckResult, type DevChange, type DevChangesView, type StripFacts } from '../../shared/dev-changes.js';
import { ChangeStore } from './store.js';
import { DevChanges, type Who } from './service.js';
import { newCandidates, type ChangePull } from './observe.js';
import { changeFacts, changeViews, stripFacts, type ChangeAssignment, type ViewInputs } from './view.js';
import { refGone } from './recheck.js';

interface Office {
  store: ChangeStore;
  changes: DevChanges;
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

function inputsOf(ctx: Ctx, floor: Floor): Pick<ViewInputs, 'task' | 'assignments' | 'pulls' | 'preview' | 'contains'> {
  const tasks = rosterOf(ctx).tasks.ids.of(floor.id);
  const p = previewOf(ctx, floor.id);
  return {
    task: (id) => tasks.get(floor.id, id),
    assignments: assignmentsOf(ctx, floor.id),
    pulls: floor.github.pulls.items as ChangePull[],
    preview: { running: p.status === 'running', ...(p.served ? { served: p.served } : {}) },
    contains: (sha, into) => contains(floor.dir, sha, into).catch(() => undefined),
  };
}

/** The office's Developer change queue. */
export function devChangesOf(ctx: Ctx): Office {
  let o = offices.get(ctx.cfg);
  if (o) return o;
  const store = new ChangeStore(path.join(ctx.cfg.dataDir, 'dev-changes'));
  const changes = new DevChanges({
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
      const r = await changeRequestBook(ctx).request(floorId, { text: c.text, page: c.page, pageMoved: c.pageMoved, revision: c.revision, by: c.by, ...(c.owner ? { owner: c.owner } : {}), change: { id: c.id, source: c.source, ...(c.ref ? { ref: c.ref } : {}) } });
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
  o = { store, changes };
  offices.set(ctx.cfg, o);
  return o;
}

/** Notes new candidate heads of the project's active change (its branch in the folder, its PRs), then moves the queue. */
export async function observeChanges(ctx: Ctx, floor: Floor): Promise<void> {
  const { store, changes } = devChangesOf(ctx);
  const all = await store.all(floor.id).catch(() => [] as DevChange[]);
  if (!all.length) return;
  const active = activeOf(all);
  // The task record from before a restart, read once: how the active change's task ended.
  if (active) await rosterOf(ctx).tasks.ids.of(floor.id).load(floor.id).catch(() => undefined);
  if (active) {
    const head = await floorRef(floor.dir, changeBranch(active.id)).catch(() => undefined);
    for (const cand of newCandidates(active, floor.github.pulls.items as ChangePull[], head?.sha.trim(), Date.now())) await store.event(floor.id, active.id, { type: 'candidate', at: cand.seenAt, candidate: cand }).catch(() => undefined);
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

/** Test runs that ran on one of the changes' candidates, as check results. */
async function checksOf(ctx: Ctx, floorId: string, all: readonly DevChange[]): Promise<CheckResult[]> {
  const shas = new Set(all.flatMap((c) => c.candidates.map((x) => x.sha)));
  if (!shas.size) return [];
  const recs = await testingStore(ctx.cfg.dataDir, floorId).all().catch(() => []);
  const out: CheckResult[] = [];
  for (const r of recs) {
    const rev = r.testedRevision?.toLowerCase();
    if (!rev || ![...shas].some((s) => s.startsWith(rev) || rev.startsWith(s))) continue;
    const failed = r.results.some((x) => x.status === 'failed');
    const verdict = r.conclusion ?? (failed ? 'failed' : r.results.length && r.results.every((x) => x.status === 'passed') ? 'passed' : 'skipped');
    out.push({ revision: r.testedRevision, name: r.suite, verdict });
  }
  return out;
}

/** The project's changes with their state, and the revision strip, for one viewer. */
export async function changesView(ctx: Ctx, floor: Floor, who: Who): Promise<DevChangesView> {
  await observeChanges(ctx, floor);
  const { store, changes } = devChangesOf(ctx);
  const all = await store.all(floor.id).catch(() => [] as DevChange[]);
  const base = inputsOf(ctx, floor);
  const why = changes.whyQueued(floor.id, all);
  const views = await changeViews(all, {
    ...base,
    ...(why ? { why } : {}),
    checks: await checksOf(ctx, floor.id, all),
    hasCI: base.pulls.some((p) => (p as { checks?: string }).checks && (p as { checks?: string }).checks !== 'none'),
    mayCancel: (c) => who.admin || (!!c.owner && c.owner === who.id),
  });
  const main = await mainHead(floor.dir);
  const preview = previewOf(ctx, floor.id);
  const behind = main && preview.served ? await behindBy(floor.dir, preview.served, main) : undefined;
  const strip = stripFacts(main, preview, behind, views);
  const cur = currentChange(views);
  return { floor: floor.id, changes: views, strip, current: cur?.id ?? null };
}
