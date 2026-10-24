// How much GitHub's branch protection really enforces the office's review (server/merge-gate/gh.ts reads it,
// read only): a per-project verdict, worded precisely. The office posts `mx-office/review` with the agents'
// GitHub token (connections/env.ts gives the same token to every agent, and the office's own gh runs with it),
// so a required status alone proves nothing: any holder of that token can post a passing one. What does hold
// is a required human review on GitHub, and only once a person has checked its bypass paths (admin bypass,
// who may dismiss reviews, CODEOWNERS coverage); a required check restricted to one GitHub App holds only
// while that App's key is out of the agents' reach. Pure: the server, the page and the tests import it.

/** Enforced: a human review is required on GitHub (or the check is restricted to one App). Weak: the status is required but fakeable. None: neither. */
export type ProtectionVerdict = 'enforced' | 'weak' | 'none' | 'unknown';

export const VERDICT_LABEL: Record<ProtectionVerdict, string> = { enforced: 'Enforced', weak: 'Weak', none: 'None', unknown: 'Unknown' };

/** What the office could read about a branch beyond its required checks. */
export interface ProtectionFacts {
  /** The GitHub App ids a required `mx-office/review` check is restricted to (empty: any source may post it). */
  appIds?: number[];
  /** Human approvals GitHub requires before a merge (classic protection or a ruleset); undefined when unreadable. */
  approvals?: number;
  /** A code owner's review is required. */
  codeOwners?: boolean;
}

/** Said wherever the status is shown while the agents' token is what posts it (the PR window, Needs you, the docs). */
export const AGENTS_TOKEN_NOTE = 'The review status is posted with the agents’ token, so an agent could post it too: require a human review on GitHub (CODEOWNERS / required approvals) and check its bypass paths.';

/** A human-review requirement only counts once its repository settings and bypass paths are verified by a person. */
export const VERIFY_NOTE = 'It counts only once you have checked on GitHub who can bypass it (admins, bypass lists), who can dismiss reviews, and that CODEOWNERS covers the app’s files.';

/** The verdict for a branch: whether it requires the status (`requiresGate`), with what else was read. */
export function protectionVerdict(branch: string, read: { requiresGate: boolean; unknown?: boolean } & ProtectionFacts): { verdict: ProtectionVerdict; verdictText: string } {
  if (read.unknown) return { verdict: 'unknown', verdictText: `Unknown: the office couldn’t read ${branch}’s protection. Treat the review as advisory.` };
  const approvals = read.approvals ?? 0;
  if (approvals > 0 || read.codeOwners) {
    const what = [approvals > 0 ? `${approvals} approving review${approvals === 1 ? '' : 's'}` : '', read.codeOwners ? 'a code owner’s review' : ''].filter(Boolean).join(' and ');
    return { verdict: 'enforced', verdictText: `Enforced: GitHub requires ${what} on ${branch} before a merge. ${VERIFY_NOTE}` };
  }
  if (read.requiresGate && read.appIds?.length)
    return { verdict: 'enforced', verdictText: `Enforced: ${branch} requires mx-office/review from GitHub App ${read.appIds.join(', ')} only. It holds while that App’s private key is out of the agents’ reach; the office itself posts with the agents’ token, which that check won’t accept.` };
  const unread = read.approvals === undefined ? ' (the office couldn’t read whether human approvals are required: that needs Administration read access)' : '';
  if (read.requiresGate) return { verdict: 'weak', verdictText: `Weak: ${branch} requires mx-office/review, but the required status can be posted by any holder of the agents’ token, so an agent can make it pass${unread}.` };
  return { verdict: 'none', verdictText: `None: ${branch} requires neither mx-office/review nor a human review${unread}. Only the office’s own Merge button checks the review.` };
}
