// The merge gate's GitHub calls, all through gh (as the office): read a pull request, post the
// `mx-office/review` commit status on its head, and read whether its base branch is protected and which
// status checks it requires (classic protection as any reader sees it on the branch, plus rulesets), whether
// mx-office/review is restricted to a GitHub App, and the human approvals it requires.
// Never a write to branch protection: making the status required is a person's step on GitHub
// (docs/site/integrations/branch-protection.md).

import { STATUS_CONTEXT, protectionOf, type ProtectionView, type StatusPost } from '../../shared/merge-gate.js';
import { PR_FIELDS } from './collect.js';

/** Runs gh in a project's folder; resolves to its standard output. */
export type GhRun = (args: string[], cwd: string) => Promise<string>;

export async function viewPull(run: GhRun, dir: string, pr: number): Promise<any> {
  return JSON.parse(await run(['pr', 'view', String(pr), '--json', PR_FIELDS], dir));
}

/** Posts the status on `sha`; resolves to the post, with the error when GitHub refused. */
export async function postStatus(run: GhRun, dir: string, sha: string, s: Pick<StatusPost, 'state' | 'description'>, now: number): Promise<StatusPost> {
  try {
    await run(['api', '--method', 'POST', `repos/{owner}/{repo}/statuses/${sha}`, '-f', `state=${s.state}`, '-f', `context=${STATUS_CONTEXT}`, '-f', `description=${s.description}`], dir);
    return { sha, ...s, at: now };
  } catch (err) {
    return { sha, ...s, at: now, error: (err as Error).message.slice(0, 300) };
  }
}

const contextsOf = (rsc: any): string[] => [...(Array.isArray(rsc?.contexts) ? rsc.contexts : []), ...(Array.isArray(rsc?.checks) ? rsc.checks.map((c: any) => c?.context) : [])].filter((c): c is string => typeof c === 'string');

/** The App ids a required check list restricts mx-office/review to (classic `checks[].app_id`, a ruleset's `integration_id`). */
const appIdsOf = (checks: unknown, key: 'app_id' | 'integration_id'): number[] =>
  (Array.isArray(checks) ? checks : []).filter((c: any) => c?.context === STATUS_CONTEXT && Number.isSafeInteger(c?.[key]) && c[key] > 0).map((c: any) => c[key] as number);

/**
 * Whether `branch` is protected, which status checks it requires (and whether mx-office/review is restricted
 * to a GitHub App), and how many human approvals it requires: read only. Rulesets say approvals to any reader;
 * classic protection's review rule needs Administration read, so without it approvals stay unknown.
 */
export async function readProtection(run: GhRun, dir: string, branch: string): Promise<ProtectionView> {
  const b = encodeURIComponent(branch);
  const [classic, rules] = await Promise.allSettled([run(['api', `repos/{owner}/{repo}/branches/${b}`], dir), run(['api', `repos/{owner}/{repo}/rules/branches/${b}`], dir)]);
  if (classic.status === 'rejected') return protectionOf(branch, { error: String((classic.reason as Error)?.message ?? classic.reason).slice(0, 160) });
  let isProtected = false;
  const contexts: string[] = [];
  const appIds: number[] = [];
  let approvals: number | undefined;
  let codeOwners = false;
  try {
    const j = JSON.parse(classic.value);
    isProtected = j?.protected === true;
    contexts.push(...contextsOf(j?.protection?.required_status_checks));
    appIds.push(...appIdsOf(j?.protection?.required_status_checks?.checks, 'app_id'));
  } catch {
    return protectionOf(branch, { error: 'GitHub’s answer wasn’t JSON' });
  }
  if (!isProtected) approvals = 0;
  let ruleApprovals = 0;
  if (rules.status === 'fulfilled') {
    try {
      const list = JSON.parse(rules.value);
      for (const r of Array.isArray(list) ? list : []) {
        if (r?.type === 'pull_request') {
          ruleApprovals = Math.max(ruleApprovals, Number(r?.parameters?.required_approving_review_count) || 0);
          if (r?.parameters?.require_code_owner_review === true) codeOwners = true;
        }
        if (r?.type !== 'required_status_checks') continue;
        isProtected = true;
        for (const c of r?.parameters?.required_status_checks ?? []) if (typeof c?.context === 'string') contexts.push(c.context);
        appIds.push(...appIdsOf(r?.parameters?.required_status_checks, 'integration_id'));
      }
    } catch {
      // rulesets unreadable: classic protection alone
    }
  }
  if (approvals === undefined) {
    // Classic protection's required reviews (needs Administration read; a refusal leaves it unknown).
    try {
      const j = JSON.parse(await run(['api', `repos/{owner}/{repo}/branches/${b}/protection/required_pull_request_reviews`], dir));
      const n = Number(j?.required_approving_review_count);
      if (Number.isFinite(n) && n >= 0) approvals = n;
      if (j?.require_code_owner_reviews === true) codeOwners = true;
    } catch (err) {
      // GitHub says 404 "…not enabled" when the rule isn't on; anything else (403, a plain 404) is "can't tell".
      if (/not enabled/i.test((err as Error)?.message ?? '')) approvals = 0;
    }
  }
  if (ruleApprovals > 0) approvals = Math.max(approvals ?? 0, ruleApprovals);
  return protectionOf(branch, { protected: isProtected, contexts, appIds, ...(approvals !== undefined ? { approvals } : {}), codeOwners });
}
