// What the merge gate reads of one pull request (gh pr view, PR_FIELDS): its head, commits, checks, and
// the reviews on it, each turned into a review record bound to the commit it reviewed. A Review comment
// (shared/review-gate.ts's layout) by an office agent, or by another GitHub account, is bound to the
// commit its `Head:` line names, else to the branch's head when it was posted; a GitHub review from
// another account carries its own commit. Pure: the service (service.ts) runs gh and keeps the records.

import { ciRollup } from '../../shared/ci-conclusion.js';
import { agentFromAuthor, openerFromBody, parseReview, reviewComplete } from '../../shared/review-gate.js';
import { bindingOf, fullSha, headAt, isGateStatus, sameName, verdictOf, type ChecksState, type PrCommit, type ReviewRecord, type ReviewVerdict } from '../../shared/merge-gate.js';

/** What the gate asks GitHub about a pull request. */
export const PR_FIELDS = 'number,state,isDraft,author,body,headRefName,headRefOid,baseRefName,commits,comments,reviews,statusCheckRollup';

export interface PrFacts {
  pr: number;
  state: 'OPEN' | 'MERGED' | 'CLOSED';
  isDraft: boolean;
  head: string;
  base: string;
  branch: string;
  /** The GitHub account that opened it (the office's, for an agent). */
  account: string;
  commits: PrCommit[];
  checks: ChecksState;
  /** The agent named in the "Opened by … via Mx Office" line. */
  opener?: string;
  records: ReviewRecord[];
  /** Review comments that don't make a record, and why. */
  ignored: string[];
}

export interface CollectLook {
  /** The project's agents by name. */
  agents: readonly string[];
  branchOwner?(branch: string): string | undefined;
}

const ms = (iso: unknown) => (typeof iso === 'string' ? Date.parse(iso) : NaN);
const GH_VERDICT: Record<string, ReviewVerdict> = { APPROVED: 'approve', CHANGES_REQUESTED: 'changes' };

/** The facts of a PR from `gh pr view --json PR_FIELDS`. */
export function factsOf(p: any, look: CollectLook): PrFacts {
  const commits: PrCommit[] = (Array.isArray(p?.commits) ? p.commits : [])
    .map((c: any) => ({ oid: String(c?.oid ?? ''), at: ms(c?.committedDate ?? c?.authoredDate), authors: (c?.authors ?? []).map((a: any) => String(a?.name ?? '')).filter(Boolean) }))
    .filter((c: PrCommit) => /^[0-9a-f]{7,40}$/i.test(c.oid));
  const account = String(p?.author?.login ?? '');
  const branch = String(p?.headRefName ?? '');
  const head = String(p?.headRefOid ?? commits.at(-1)?.oid ?? '');
  const opener = openerFromBody(p?.body) ?? look.branchOwner?.(branch);
  const records: ReviewRecord[] = [];
  const ignored: string[] = [];
  const notes = [...(p?.comments ?? []).map((c: any) => ({ c, kind: 'c' as const })), ...(p?.reviews ?? []).map((c: any) => ({ c, kind: 'r' as const }))];
  for (const { c, kind } of notes) {
    const body = String(c?.body ?? '');
    const at = ms(c?.submittedAt ?? c?.createdAt);
    const login = String(c?.author?.login ?? '');
    const otherAccount = !!login && !!account && login !== account;
    const id = `${kind}:${String(c?.id ?? `${login}-${at}`)}`;
    const r = parseReview(body);
    if (r && Number.isFinite(at)) {
      const agent = look.agents.find((a) => sameName(a, r.reviewer));
      if (!agent && !otherAccount) {
        ignored.push(`A Review comment names ${r.reviewer || 'nobody'}, who isn’t an agent of this project`);
        continue;
      }
      if (!reviewComplete(r)) {
        ignored.push(`The Review comment by ${r.reviewer || '(nobody named)'} lists no checks with results or no files read`);
        continue;
      }
      const b = bindingOf(body);
      const stated = b.head ? fullSha(b.head, commits) : undefined;
      const sha = stated ?? headAt(at, commits);
      if (!sha) {
        ignored.push(`The Review comment by ${r.reviewer} names no Head: commit, and none was on the branch when it was posted`);
        continue;
      }
      records.push({
        id,
        pr: Number(p?.number),
        sha,
        shaFrom: stated ? 'stated' : 'inferred',
        verdict: verdictOf(body, at) ?? 'comment',
        reviewer: agent ? { kind: 'agent', name: agent, ...(r.role ? { role: r.role } : {}) } : { kind: 'github', name: r.reviewer || login, role: r.role ?? `GitHub: ${login}` },
        at,
        source: 'agent-comment',
      });
      continue;
    }
    // A GitHub review (approve or request changes) from another account: GitHub records which commit it saw.
    const verdict = kind === 'r' ? GH_VERDICT[String(c?.state ?? '')] : undefined;
    const oid = String(c?.commit?.oid ?? '');
    if (verdict && otherAccount && /^[0-9a-f]{40}$/i.test(oid) && Number.isFinite(at)) records.push({ id, pr: Number(p?.number), sha: oid, shaFrom: 'github', verdict, reviewer: { kind: 'github', name: login }, at, source: 'github-review' });
  }
  const rollup = (Array.isArray(p?.statusCheckRollup) ? p.statusCheckRollup : []).filter((c: any) => !isGateStatus(c));
  return {
    pr: Number(p?.number),
    state: p?.state === 'MERGED' || p?.state === 'CLOSED' ? p.state : 'OPEN',
    isDraft: !!p?.isDraft,
    head,
    base: String(p?.baseRefName ?? ''),
    branch,
    account,
    commits,
    checks: ciRollup(rollup),
    ...(opener ? { opener } : {}),
    records,
    ignored,
  };
}

/** Who authored the PR's commits (they can't review it): its opener, the agents its commits name, and the people. */
export function authorsOf(f: Pick<PrFacts, 'opener' | 'commits'>): string[] {
  const out = new Set<string>();
  if (f.opener) out.add(f.opener);
  for (const c of f.commits) for (const a of c.authors) out.add(agentFromAuthor(a) ?? a);
  return [...out];
}
