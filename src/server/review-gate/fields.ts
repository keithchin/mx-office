// What the review gate reads of a merged pull request, from the PR list the office already asks GitHub
// for (github.ts): who GitHub says merged it, the comments and reviews that could be a review or an
// approval (only those: the PR list goes to every browser), the commit titles that claim a review, and
// the commits' author names (an agent's own, git-identity.ts). Asked for merged PRs only.

import type { GhPull, GhReviewNote } from '../../shared/protocol.js';
import { claimsReviewed } from '../../shared/review-gate.js';

/** The extra fields the merged-PR list asks GitHub for. */
export const GATE_FIELDS = 'mergedBy,comments,reviews,commits';

const NOTE = /^\s*\**(review|approved?)\b/i;
const NOTE_MAX = 3000;
const MAX = 20;

function noteOf(c: any, kind: 'comment' | 'review'): GhReviewNote | undefined {
  const body = String(c?.body ?? '');
  const state = typeof c?.state === 'string' ? c.state : undefined;
  if (!NOTE.test(body) && state !== 'APPROVED') return undefined;
  return { kind, author: String(c?.author?.login ?? ''), body: body.slice(0, NOTE_MAX), at: String(c?.submittedAt ?? c?.createdAt ?? ''), ...(state ? { state } : {}) };
}

/** The review gate's fields of one PR from gh's JSON (nothing when GitHub didn't send them). */
export function gateFieldsOf(p: any): Partial<GhPull> {
  if (p?.state !== 'MERGED') return {};
  const out: Partial<GhPull> = {};
  if (typeof p.mergedBy?.login === 'string') out.mergedBy = p.mergedBy.login;
  const notes = [...(p.comments ?? []).map((c: any) => noteOf(c, 'comment')), ...(p.reviews ?? []).map((r: any) => noteOf(r, 'review'))].filter((n): n is GhReviewNote => !!n);
  if (Array.isArray(p.comments) || Array.isArray(p.reviews)) out.reviewNotes = notes.slice(0, MAX);
  if (Array.isArray(p.commits)) {
    out.claims = p.commits.map((c: any) => String(c?.messageHeadline ?? '')).filter(claimsReviewed).slice(0, MAX).map((t: string) => t.slice(0, 200));
    const names = new Set<string>();
    for (const c of p.commits) for (const a of c?.authors ?? []) if (typeof a?.name === 'string' && a.name) names.add(a.name.slice(0, 120));
    out.commitAuthors = [...names].slice(0, MAX);
  }
  return out;
}
