// Where each Developer change is (shared/dev-change-state.ts, dev-change-facts.ts), from what the office already
// keeps: the change record (queue, candidates, links), the task record and the member's task on the roster (how
// it ended), the PR list (its PR merged with its merge commit), local git (merged without a PR: the candidate on
// main's first-parent line), the worker it was handed to (gone or not), the data-impact guard's holds, the live
// app's served revision and guided validation's reviews. Nothing derived is stored. Also the revision strip's
// facts and the checks bound to the relevant revision.

import { aliasesOf, candidateChecks, CHANGE_TONE, changeBranch, changeFour, changeState, currentChange, queuedOf, type Candidate, type ChangeFacts, type ChangeReview, type CheckResult, type DevChange, type DevChangePolicy, type DevChangeView, type HeldOn, type QueueWhy, type StripFacts } from '../../shared/dev-changes.js';
import type { TaskRecord } from '../../shared/tasks.js';
import { pullFor, pullsOf, type ChangePull } from './observe.js';

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
  /** The commit on main's first-parent line that brought `sha` in (itself when it's on that line), when main has it. */
  mergedAt?(sha: string): Promise<string | undefined>;
  /** Whether the worker `id` has left the project. */
  workerGone?(id: string): boolean;
  /** The data-impact hold on this change (its candidate, or the live preview's on its merge), if any. */
  held?(c: DevChange, merged?: string): HeldOn | undefined;
  /** Earlier untried changes overlapping this one. */
  depends?(c: DevChange, all: readonly DevChange[]): Promise<{ id: string; docs: string[] }[]>;
  /** Why the queue's head waits now. */
  why?: { why: QueueWhy; ahead?: string };
  policy?: DevChangePolicy;
  /** Check results that may be about the change's candidates (test runs by revision). */
  checks?: readonly CheckResult[];
  hasCI?: boolean;
  reviews?: ReadonlyMap<string, ChangeReview[]>;
  /** Whether this viewer asked for change `c` or is an admin. */
  mayCancel(c: DevChange): boolean;
  /** Whether this viewer may confirm or dismiss links (admins, and whoever asked). */
  mayDecide?(c: DevChange): boolean;
}

type Facts = Pick<ViewInputs, 'task' | 'assignments' | 'pulls' | 'preview' | 'contains' | 'why' | 'mergedAt' | 'workerGone'>;

/** A linked record's work is followed from its alias: the task it was handed as, the PRs that name it. */
export function followed(c: DevChange): DevChange {
  if (c.activated || !c.linked) return c;
  const l = c.linked;
  return { ...c, activated: { type: 'activated', at: l.at, requestId: l.id, taskId: l.taskId ?? '', member: l.member ?? 'the team', role: l.role ?? '', ...(l.workerId ? { workerId: l.workerId } : {}), delivery: 'sent' } };
}

/** The facts the execution state is worked out from, for one change. */
export async function changeFacts(c0: DevChange, i: Facts, position?: number): Promise<ChangeFacts> {
  const c = followed(c0);
  const f: ChangeFacts = { queue: c.queue };
  if (c.queue === 'queued') {
    if (position) f.position = position;
    // Every queued change waits for the same condition as the head of the queue (and the ones ahead of it).
    f.why = i.why?.why ?? 'behind';
    if (i.why?.ahead) f.ahead = i.why.ahead;
    return f;
  }
  if (c.queue === 'clarify') return { ...f, ...(c.clarify ? { clarify: c.clarify.why } : {}) };
  if (c.queue === 'cancelled') return { ...f, ...(c.cancelled ? { cancelled: { by: c.cancelled.by, ...(c.cancelled.active ? { active: true as const } : {}), ...(c.cancelled.stop ? { stop: c.cancelled.stop } : {}) } } : {}) };
  if (c.superseded) f.superseded = { by: c.superseded.by, follow: c.superseded.follow };
  if (c.settled) f.settled = c.settled.why;
  const taskId = c.activated?.taskId;
  const t = taskId ? i.task(taskId) : undefined;
  const ended = (t?.events ?? []).filter((e) => e.type === 'completed' || e.type === 'cancelled' || e.type === 'superseded').at(-1)?.type as ChangeFacts['ended'];
  if (ended) f.ended = ended;
  const a = taskId ? [...i.assignments].reverse().find((x) => x.taskId === taskId) : undefined;
  if (a) f.outcome = a.outcome;
  const cand = c.candidates.filter((x) => !x.late).at(-1);
  if (cand) f.candidate = cand;
  const p = pullFor(c, i.pulls);
  if (p && (p.state === 'OPEN' || p.state === 'MERGED' || p.state === 'CLOSED')) f.pr = { number: p.number, state: p.state, ...(p.mergeCommit ? { mergeCommit: p.mergeCommit } : {}) };
  f.preview = i.preview;
  if (f.pr?.state === 'MERGED' && f.pr.mergeCommit) f.merged = { sha: f.pr.mergeCommit, via: 'pr' };
  else if (cand && !f.pr && i.mergedAt) {
    // No PR (a project without GitHub, or one the list doesn't have): main having the candidate is the merge.
    const m = await i.mergedAt(cand.sha).catch(() => undefined);
    if (m) f.merged = { sha: m, via: 'git' };
  }
  if (c.queue === 'active' && c.activated?.workerId && i.workerGone?.(c.activated.workerId)) f.workerGone = true;
  if (f.merged && i.preview.running && i.preview.served) {
    const inServed = await i.contains(f.merged.sha, i.preview.served);
    if (inServed !== undefined) f.inServed = inServed;
  }
  return f;
}

const short = (sha?: string) => (sha ?? '').slice(0, 7);

/** What showed up for a change after it was cancelled or superseded while the team had it: said, never counted. */
export function lateLine(c: DevChange, pulls: readonly ChangePull[]): string | undefined {
  const stopped = c.cancelled?.active || c.superseded?.was === 'active';
  if (!stopped) return undefined;
  const parts = c.candidates.filter((x) => x.late).map((x: Candidate) => `candidate @${short(x.sha)} on ${x.branch}${x.pr ? ` (PR #${x.pr})` : ''}`);
  for (const p of pullsOf(followed(c), pulls)) if (p.state === 'MERGED' || (p.state === 'OPEN' && p.number !== c.cancelled?.pr)) parts.push(`PR #${p.number} ${p.state === 'MERGED' ? 'merged' : 'open'}`);
  if (!parts.length) return undefined;
  return `After ${c.queue === 'superseded' ? 'it was superseded' : 'cancellation'}: ${[...new Set(parts)].join(', ')}: not counted. It never settles this change or moves the queue.`;
}

/** Every change with its state and four facts, newest first. */
export async function changeViews(all: readonly DevChange[], i: ViewInputs): Promise<DevChangeView[]> {
  const queue = queuedOf(all, i.policy).map((c) => c.id);
  const out = await Promise.all(
    all.map(async (c): Promise<DevChangeView> => {
      const position = c.queue === 'queued' ? queue.indexOf(c.id) + 1 : undefined;
      const f = await changeFacts(c, i, position);
      const status = changeState(f);
      const a = c.activated;
      const live = c.candidates.filter((x) => !x.late);
      const rel = f.merged && !live.some((x) => x.sha === f.merged!.sha) ? [...live, { sha: f.merged.sha, via: 'branch' as const, branch: 'main', seenAt: 0 }] : live;
      const checks = rel.length ? candidateChecks(rel, i.checks ?? [], !!i.hasCI) : undefined;
      const reviews = i.reviews?.get(c.id);
      const held = status.state === 'candidate' || status.state === 'implemented' ? i.held?.(c, f.merged?.sha) : undefined;
      const facts = changeFour({ state: status.state, words: status.words, tone: CHANGE_TONE[status.state], ...(status.revision ? { revision: status.revision } : {}), ...(f.merged ? { merged: f.merged.sha } : {}), ...(checks ? { checks } : {}), hasCI: !!i.hasCI, ...(f.preview ? { preview: f.preview } : {}), ...(f.inServed !== undefined ? { inServed: f.inServed } : {}), ...(held ? { held } : {}), ...(reviews ? { reviews } : {}) });
      const open = c.queue === 'queued' || c.queue === 'active' || c.queue === 'clarify';
      const depends = open && i.depends ? await i.depends(c, all).catch(() => []) : [];
      const late = lateLine(c, i.pulls);
      const may = i.mayCancel(c);
      const parent = c.of ? all.find((x) => x.id === c.of) : undefined;
      const aliases = aliasesOf(c);
      const decide = i.mayDecide?.(c) ?? may;
      return {
        ...c,
        ...status,
        branch: changeBranch(c.id),
        facts,
        ...(position ? { position } : {}),
        ...(a ? { requestId: a.requestId, taskId: a.taskId, member: a.member } : {}),
        ...(checks ? { checks } : {}),
        ...(reviews ? { reviews } : {}),
        mayCancel: open && may,
        ...(status.state === 'attention' && may ? { mayRetry: true } : {}),
        ...(parent && parent.queue !== 'cancelled' && parent.queue !== 'superseded' && may ? { maySupersede: parent.id } : {}),
        ...(depends.length ? { depends } : {}),
        ...(late ? { late } : {}),
        ...(c.related?.length ? { relatedView: c.related.map((r) => ({ ...r, mayDecide: decide && !r.explicit })) } : {}),
        ...(aliases.length ? { aliases } : {}),
      };
    }),
  );
  return out.sort((x, y) => Number(y.id.slice(3)) - Number(x.id.slice(3)));
}

/** The strip's facts: main @M, the preview @S and how far behind, the current change's candidate. */
export function stripFacts(main: string | undefined, preview: StripFacts['preview'], apart: { behind?: number; ahead?: number } | undefined, views: readonly DevChangeView[]): StripFacts {
  const cur = currentChange(views);
  const cand = cur?.candidates.filter((x) => !x.late).at(-1);
  const change = cur?.queue === 'active' ? { id: cur.id, branch: cur.branch, ...(cand ? { candidate: cand.sha } : {}) } : undefined;
  return { ...(main ? { main } : {}), preview, ...(apart?.behind !== undefined ? { behind: apart.behind } : {}), ...(apart?.ahead ? { ahead: apart.ahead } : {}), ...(change ? { change } : {}) };
}
