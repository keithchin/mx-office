// Where each change request is (shared/change-requests.ts requestState), from what the office already keeps:
// the task's record (server/tasks/: handed over, how it ended), the member's task on the roster (its outcome,
// a decision it waits on), the pull request that names the task (its `Task:` line, or the request's id)
// from the PR list the project already polls, whether the running version contains that PR's merge commit,
// and the business status (server/business-status/) when its revision contains it. Nothing is stored here;
// ancestry is local git, cached for good (tasks/git.ts contains). No fetch, no polling: asked when the page
// asks for the requests.

import { requestState, type ChangeRequestRecord, type ChangeRequestView, type RequestFacts } from '../../shared/change-requests.js';
import { taskIdsIn, type TaskRecord } from '../../shared/tasks.js';
import type { BusinessState } from '../../shared/business-status.js';

/** A PR as the project's list has it (the fields this reads). */
export interface RequestPull {
  number: number;
  title: string;
  body?: string;
  state: string;
  mergeCommit?: string;
  createdAt?: string;
}

/** A member's task (roster/resume.ts Assignment), the fields this reads, with its provenance. */
export interface RequestAssignment {
  taskId?: string;
  pr?: number;
  outcome: NonNullable<RequestFacts['outcome']>;
}

export interface ViewInputs {
  /** The task's record, when the office has it in memory. */
  task(taskId: string): TaskRecord | undefined;
  /** Every member's task and the few before it. */
  assignments: readonly RequestAssignment[];
  pulls: readonly RequestPull[];
  /** The running version (served revision), when the app answers. */
  served?: string;
  business?: { state: BusinessState; revision?: string };
  /** Whether revision `into` contains commit `sha` (undefined: couldn't tell). */
  contains(sha: string, into: string): Promise<boolean | undefined>;
}

const names = (id: string, text: string) => new RegExp(`(^|[^\\w-])${id.replace(/-/g, '\\-')}(?![\\w-])`).test(text);

/** The request's PR: one whose title or description names its task or its id (merged first, then open), else its member's PR. */
export function pullOf(r: Pick<ChangeRequestRecord, 'id' | 'taskId'>, pulls: readonly RequestPull[], a?: RequestAssignment): RequestPull | undefined {
  const mine = pulls.filter((p) => taskIdsIn(`${p.title}\n${p.body ?? ''}`).includes(r.taskId) || names(r.id, `${p.title}\n${p.body ?? ''}`));
  const pick = mine.find((p) => p.state === 'MERGED') ?? mine.find((p) => p.state === 'OPEN') ?? mine[0];
  return pick ?? (a?.pr !== undefined ? pulls.find((p) => p.number === a.pr) : undefined);
}

/** The facts the state is worked out from, for one request. */
export async function factsOf(r: ChangeRequestRecord, i: ViewInputs): Promise<RequestFacts> {
  const t = i.task(r.taskId);
  const a = [...i.assignments].reverse().find((x) => x.taskId === r.taskId);
  const ends = (t?.events ?? []).filter((e) => e.type === 'completed' || e.type === 'cancelled' || e.type === 'superseded');
  const ended = ends.at(-1)?.type as RequestFacts['ended'];
  const assigned = !!a || !!t?.events.some((e) => e.type === 'assigned' || e.type === 'reassigned');
  const p = pullOf(r, i.pulls, a);
  const st = p?.state;
  const change: RequestFacts['change'] = p && (st === 'OPEN' || st === 'MERGED' || st === 'CLOSED') ? { state: st, ...(p.mergeCommit ? { commit: p.mergeCommit } : {}) } : undefined;
  const f: RequestFacts = { delivery: r.delivery, assigned, ...(ended ? { ended } : {}), ...(a ? { outcome: a.outcome } : {}), ...(change ? { change } : {}), ...(i.served ? { served: i.served } : {}), ...(i.business ? { business: i.business } : {}) };
  const commit = change?.state === 'MERGED' ? change.commit : undefined;
  if (commit) {
    const [inServed, inBusiness] = await Promise.all([i.served ? i.contains(commit, i.served) : undefined, i.business?.revision ? i.contains(commit, i.business.revision) : undefined]);
    if (inServed !== undefined) f.inServed = inServed;
    if (inBusiness !== undefined) f.inBusiness = inBusiness;
  }
  return f;
}

/** Every request with its state, newest first. */
export async function viewsOf(list: readonly ChangeRequestRecord[], i: ViewInputs): Promise<ChangeRequestView[]> {
  return Promise.all(list.map(async (r) => ({ ...r, ...requestState(await factsOf(r, i)) })));
}
