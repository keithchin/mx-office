// Candidate heads for the Developer changes (shared/dev-changes.ts Candidate): from the PR list the project
// already polls (a PR from dev/DC-n, or one whose title or description carries the change's Task: line) and the
// branch's head as fetched into the project folder (origin/dev/DC-n, else the local branch a member's worktree
// made). No polling of its own: asked when the PR list comes back and when the requests are read. A head seen
// once is appended to the change's record and never moved; a newer head is a new candidate. A head that is still
// the revision the change started from (main's head when it was handed over, or the revision it was asked on) is
// a fresh branch with nothing of its own: no candidate (else it would read as merged at once, being on main).

import { changeBranch, type Candidate, type DevChange } from '../../shared/dev-changes.js';
import { taskIdsIn } from '../../shared/tasks.js';

/** A PR as the project's list has it (the fields this reads). */
export interface ChangePull {
  number: number;
  title: string;
  body?: string;
  state: string;
  headRefName?: string;
  headRefOid?: string;
  mergeCommit?: string;
}

const names = (id: string, text: string) => new RegExp(`(^|[^\\w-])${id.replace(/-/g, '\\-')}(?![\\w-])`).test(text);

/** The change's PRs: from its branch, or carrying its task id (or naming its DC or CR id). */
export function pullsOf(c: DevChange, pulls: readonly ChangePull[]): ChangePull[] {
  const branch = changeBranch(c.id);
  const task = c.activated?.taskId;
  const req = c.activated?.requestId;
  return pulls.filter((p) => {
    if (p.headRefName === branch) return true;
    const text = `${p.title}\n${p.body ?? ''}`;
    return (!!task && taskIdsIn(text).includes(task)) || names(c.id, text) || (!!req && names(req, text));
  });
}

/** The PR that speaks for the change: merged first, then open, then any. */
export function pullFor(c: DevChange, pulls: readonly ChangePull[]): ChangePull | undefined {
  const mine = pullsOf(c, pulls);
  return mine.find((p) => p.state === 'MERGED') ?? mine.find((p) => p.state === 'OPEN') ?? mine[0];
}

/** The heads not seen before, in the order to append them: the branch's own head first, then the PRs'. */
export function newCandidates(c: DevChange, pulls: readonly ChangePull[], branchHead: string | undefined, now: number): Candidate[] {
  if (!c.activated) return [];
  const branch = changeBranch(c.id);
  const seen = new Set(c.candidates.map((x) => x.sha));
  // Where it started: a branch still there has nothing of its own yet.
  for (const s of [c.activated.main, c.source.sha]) if (s) seen.add(s.toLowerCase());
  const out: Candidate[] = [];
  const add = (x: Candidate) => {
    if (!/^[0-9a-f]{40}$/i.test(x.sha) || seen.has(x.sha)) return;
    seen.add(x.sha);
    out.push(x);
  };
  const mine = pullsOf(c, pulls);
  if (branchHead) {
    const pr = mine.find((p) => p.headRefName === branch);
    add({ sha: branchHead.toLowerCase(), via: 'branch', branch, ...(pr ? { pr: pr.number } : {}), seenAt: now });
  }
  for (const p of mine) {
    if (!p.headRefOid) continue;
    add({ sha: p.headRefOid.toLowerCase(), via: p.headRefName === branch ? 'branch' : 'pr', branch: p.headRefName || branch, pr: p.number, seenAt: now });
  }
  return out;
}
