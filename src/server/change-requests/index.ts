// Change requests wired to the office (service.ts, view.ts): the team's lead from the roster's coverage, the
// task minted through the roster's task record and typed through its delivery as a durable dispatch (held for
// the lead's turn under way, recorded as the member's task once it goes in, as a model change request is),
// the audit log, and for each request's state the task record, the roster, the PR list the project already
// polls, the live app's served revision, the business status and local git. Made once per office.

import type { Ctx } from '../office/context.js';
import type { Floor } from '../floor.js';
import { audit } from '../audit/index.js';
import { rosterOf, teamFloor } from '../roster/adapter.js';
import { outcomeOf, type Assignment } from '../roster/resume.js';
import { sendAsAnswer } from '../roster/dispatch-send.js';
import { dispatchTaskOf } from '../roster/task-ids.js';
import { deliveryOpts } from '../model-change/service.js';
import { liveAppsIfMade } from '../liveapp/index.js';
import { businessViewOf } from '../business-status/index.js';
import { contains } from '../tasks/git.js';
import { managerOf } from '../../shared/roster/coverage.js';
import type { ChangeRequestView } from '../../shared/change-requests.js';
import { RequestBook, type Handed, type RequestMember } from './service.js';
import { viewsOf, type RequestAssignment } from './view.js';

const books = new WeakMap<object, RequestBook>();

export function changeRequestBook(ctx: Ctx): RequestBook {
  let b = books.get(ctx.cfg);
  if (b) return b;
  b = new RequestBook({
    dataDir: ctx.cfg.dataDir,
    now: () => Date.now(),
    intake(floorId) {
      const floor = ctx.floors.get(floorId);
      if (!floor) return [];
      const roster = rosterOf(ctx);
      const tf = teamFloor(ctx, floor);
      const d = roster.data(floorId);
      const roles = [...new Set([managerOf(d.coverage), d.coverage.analysis])];
      return roles.map((role): RequestMember => {
        const m = d.members[role];
        const w = roster.workerOf(tf, m);
        return { role, name: m.name, ...(w ? { workerId: w.id } : {}), atWork: !!w && m.phase === 'active' };
      });
    },
    async hand(floorId, m, text, o): Promise<Handed> {
      const floor = ctx.floors.get(floorId);
      if (!floor || !m.workerId) return { status: 'refused', why: 'No such project' };
      const roster = rosterOf(ctx);
      const tf = teamFloor(ctx, floor);
      const w = tf.worker(m.workerId);
      if (!w) return { status: 'refused', why: `${m.name} isn’t at work` };
      // The task's record on disk first (roster/task-ids.ts): when it can't be written, nothing is typed.
      const prep = await roster.tasks.prepare(tf, w.id, text, 'request');
      if (prep.error !== undefined) return { status: 'refused', why: prep.error };
      if (!prep.task) return { status: 'refused', why: 'The office couldn’t make a task for this request, so nothing was sent. Try again.' };
      const typed = prep.text;
      const exe = prep.task.executionId;
      const onSent = () => (o.onSent(), roster.tasks.assign(tf, w.id, typed, o.by, 'request', exe));
      const task = dispatchTaskOf(prep.task);
      const { result, sent } = await sendAsAnswer(roster, tf, w, typed, deliveryOpts('after', o.by, o.id, onSent), { decision: `cr:${o.id.split(':').pop()}`, by: o.by, kind: 'answer', ...(task ? { task } : {}) });
      if (!result.ok) return { status: 'refused', why: result.error };
      if (!sent || sent.status === 'refused') return { status: 'refused', why: sent?.status === 'refused' ? sent.why : 'not sent' };
      const rec = result.results[0]?.records[0];
      return { status: sent.status, taskId: prep.task.taskId, executionId: exe, ...(rec ? { dispatchId: rec.id } : {}) };
    },
    record: (e) => audit.record(e),
  });
  books.set(ctx.cfg, b);
  return b;
}

/** The project's requests with their state, newest first. */
export async function requestsOf(ctx: Ctx, floor: Floor): Promise<ChangeRequestView[]> {
  const list = changeRequestBook(ctx).list(floor.id);
  if (!list.length) return [];
  const roster = rosterOf(ctx);
  const d = roster.data(floor.id);
  const assignments: RequestAssignment[] = [];
  for (const m of Object.values(d.members) as { task?: Assignment; prevTasks?: Assignment[] }[]) {
    for (const t of [...(m.prevTasks ?? []), ...(m.task ? [m.task] : [])]) if (t.taskId) assignments.push({ taskId: t.taskId, ...(t.pr !== undefined ? { pr: t.pr } : {}), outcome: outcomeOf(t) });
  }
  const tasks = roster.tasks.ids.of(floor.id);
  const live = liveAppsIfMade(ctx)?.peek(floor.id);
  const served = live?.status === 'running' ? live.served?.sha : undefined;
  const biz = (await businessViewOf(ctx, floor))?.project;
  return viewsOf(list, {
    task: (id) => tasks.get(floor.id, id),
    assignments,
    pulls: floor.github.pulls.items,
    ...(served ? { served } : {}),
    ...(biz && biz.state !== 'unknown' ? { business: { state: biz.state, ...(biz.revision ? { revision: biz.revision } : {}) } } : {}),
    contains: (sha, into) => contains(floor.dir, sha, into).catch(() => undefined),
  });
}
