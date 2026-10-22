// The merge gate's GitHub calls, all through gh (as the office): read a pull request, post the
// `mx-office/review` commit status on its head, and read whether its base branch is protected and which
// status checks it requires (classic protection as any reader sees it on the branch, plus rulesets).
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

/** Whether `branch` is protected and which status checks it requires: read only. */
export async function readProtection(run: GhRun, dir: string, branch: string): Promise<ProtectionView> {
  const b = encodeURIComponent(branch);
  const [classic, rules] = await Promise.allSettled([run(['api', `repos/{owner}/{repo}/branches/${b}`], dir), run(['api', `repos/{owner}/{repo}/rules/branches/${b}`], dir)]);
  if (classic.status === 'rejected') return protectionOf(branch, { error: String((classic.reason as Error)?.message ?? classic.reason).slice(0, 160) });
  let isProtected = false;
  const contexts: string[] = [];
  try {
    const j = JSON.parse(classic.value);
    isProtected = j?.protected === true;
    contexts.push(...contextsOf(j?.protection?.required_status_checks));
  } catch {
    return protectionOf(branch, { error: 'GitHub’s answer wasn’t JSON' });
  }
  if (rules.status === 'fulfilled') {
    try {
      const list = JSON.parse(rules.value);
      for (const r of Array.isArray(list) ? list : []) {
        if (r?.type !== 'required_status_checks') continue;
        isProtected = true;
        for (const c of r?.parameters?.required_status_checks ?? []) if (typeof c?.context === 'string') contexts.push(c.context);
      }
    } catch {
      // rulesets unreadable: classic protection alone
    }
  }
  return protectionOf(branch, { protected: isProtected, contexts });
}
