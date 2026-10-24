// Where each Developer change is (shared/dev-changes.ts changeState), from what the office already keeps: the
// change record (queue, candidates), the task record and the member's task on the roster (how it ended), the PR
// list (its PR merged with its merge commit), the live app's served revision and local git ancestry (cached for
// good). Nothing derived is stored. Also the revision strip's facts and the checks bound to a candidate.

import { candidateChecks, changeBranch, changeState, currentChange, queuedOf, type ChangeFacts, type CheckResult, type DevChange, type DevChangeView, type QueueWhy, type StripFacts } from '../../shared/dev-changes.js';
import type { TaskRecord } from '../../shared/tasks.js';
import { pullFor, type ChangePull } from './observe.js';

/** A member's task (roster/resume.ts Assignment), the fields this reads, with its provenance. */
export interface ChangeAssignment {
  taskId?: string;
  outcome: NonNullable<ChangeFacts['outcome']>;
}

export interface ViewInputs {
  task(taskId: string): TaskRecord | undefined;
  assignments: readonly ChangeAssignment[];
  pulls: readonly ChangePull[];
  /** The live app: running (serving S) or not. */
  preview: { running: boolean; served?: string };
  /** Whether revision `into` contains commit `sha` (undefined: couldn't tell). */
  contains(sha: string, into: string): Promise<boolean | undefined>;
  /** Why the queue's head waits now. */
  why?: { why: QueueWhy; ahead?: string };
  /** Check results that may be about the change's candidates (test runs by revision). */
  checks?: readonly CheckResult[];
  hasCI?: boolean;
  /** Whether this viewer may cancel change `c` (theirs, or an admin). */
  mayCancel(c: DevChange): boolean;
}

/** The facts the state is worked out from, for one change. */
export async function changeFacts(c: DevChange, i: Pick<ViewInputs, 'task' | 'assignments' | 'pulls' | 'preview' | 'contains' | 'why'>, position?: number): Promise<ChangeFacts> {
  const f: ChangeFacts = { queue: c.queue };
  if (c.queue === 'queued') {
    if (position) f.position = position;
    // Every queued change waits for the same condition as the head of the queue (and the ones ahead of it).
    f.why = i.why?.why ?? 'behind';
    if (i.why?.ahead) f.ahead = i.why.ahead;
    return f;
  }
  if (c.queue === 'clarify') return { ...f, ...(c.clarify ? { clarify: c.clarify.why } : {}) };
  if (c.queue === 'cancelled') return { ...f, ...(c.cancelled ? { cancelledBy: c.cancelled.by } : {}) };
  const taskId = c.activated?.taskId;
  const t = taskId ? i.task(taskId) : undefined;
  const ended = (t?.events ?? []).filter((e) => e.type === 'completed' || e.type === 'cancelled' || e.type === 'superseded').at(-1)?.type as ChangeFacts['ended'];
  if (ended) f.ended = ended;
  const a = taskId ? [...i.assignments].reverse().find((x) => x.taskId === taskId) : undefined;
  if (a) f.outcome = a.outcome;
  const cand = c.candidates.at(-1);
  if (cand) f.candidate = cand;
  const p = pullFor(c, i.pulls);
  if (p && (p.state === 'OPEN' || p.state === 'MERGED' || p.state === 'CLOSED')) f.pr = { number: p.number, state: p.state, ...(p.mergeCommit ? { mergeCommit: p.mergeCommit } : {}) };
  f.preview = i.preview;
  const merged = f.pr?.state === 'MERGED' ? f.pr.mergeCommit : undefined;
  if (merged && i.preview.running && i.preview.served) {
    const inServed = await i.contains(merged, i.preview.served);
    if (inServed !== undefined) f.inServed = inServed;
  }
  return f;
}

/** Every change with its state, newest first. */
export async function changeViews(all: readonly DevChange[], i: ViewInputs): Promise<DevChangeView[]> {
  const queue = queuedOf(all).map((c) => c.id);
  const out = await Promise.all(
    all.map(async (c): Promise<DevChangeView> => {
      const position = c.queue === 'queued' ? queue.indexOf(c.id) + 1 : undefined;
      const status = changeState(await changeFacts(c, i, position));
      const a = c.activated;
      const checks = c.candidates.length ? candidateChecks(c.candidates, i.checks ?? [], !!i.hasCI) : undefined;
      return {
        ...c,
        ...status,
        branch: changeBranch(c.id),
        ...(position ? { position } : {}),
        ...(a ? { requestId: a.requestId, taskId: a.taskId, member: a.member } : {}),
        ...(checks ? { checks } : {}),
        mayCancel: (c.queue === 'queued' || c.queue === 'clarify') && i.mayCancel(c),
      };
    }),
  );
  return out.sort((x, y) => Number(y.id.slice(3)) - Number(x.id.slice(3)));
}

/** The strip's facts: main @M, the preview @S and how far behind, the current change's candidate. */
export function stripFacts(main: string | undefined, preview: StripFacts['preview'], apart: { behind?: number; ahead?: number } | undefined, views: readonly DevChangeView[]): StripFacts {
  const cur = currentChange(views);
  const change = cur?.queue === 'active' ? { id: cur.id, branch: cur.branch, ...(cur.candidates.at(-1) ? { candidate: cur.candidates.at(-1)!.sha } : {}) } : undefined;
  return { ...(main ? { main } : {}), preview, ...(apart?.behind !== undefined ? { behind: apart.behind } : {}), ...(apart?.ahead ? { ahead: apart.ahead } : {}), ...(change ? { change } : {}) };
}
