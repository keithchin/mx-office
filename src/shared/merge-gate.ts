// The merge gate (server/merge-gate/, docs/site/using-the-office/review-gate.md#the-merge-gate): a review
// counts only for the exact revision (head commit) it reviewed, with its verdict, by someone who didn't
// author the pull request's commits. A new commit on the branch makes it stale. The office's own Merge
// button refuses a pull request whose head has no counting approval (or whose checks fail), unless an
// admin overrides it with a typed reason; the office also posts the verdict on the head commit as the
// `mx-office/review` status, which GitHub branch protection can require. Identity comes from the
// office's records (the agent named in a Review comment, the person signed in to the office), never from
// GitHub: all agents share one GitHub account. Pure: the server, the page and the tests import it.

import { protectionVerdict, type ProtectionFacts, type ProtectionVerdict } from './merge-gate-protection.js';

/** The commit status the office posts on a pull request's head. */
export const STATUS_CONTEXT = 'mx-office/review';

/**
 * Review comments posted from this time on need a `Verdict:` line to count; older ones keep the old rule
 * (a complete Review comment is an approval). Both are bound to the revision they reviewed.
 */
export const BINDING_SINCE = Date.parse('2026-10-22T00:00:00Z');

/** How long an admin's override lets the office's Merge button through for that head (ms). */
export const OVERRIDE_MS = 30 * 60_000;
export const OVERRIDE_REASON_MIN = 10;

export type ReviewVerdict = 'approve' | 'changes' | 'comment';
export const VERDICT_WORDS: Record<ReviewVerdict, string> = { approve: 'Approved', changes: 'Changes requested', comment: 'Comment only' };

/** Where a review record came from. */
export type ReviewSource = 'agent-comment' | 'github-review' | 'office';

export interface Reviewer {
  /** agent: named in a Review comment (an office agent); person: signed in to the office; github: another GitHub account. */
  kind: 'agent' | 'person' | 'github';
  name: string;
  role?: string;
  /** The office account id (person), when there is one. */
  id?: string;
}

/** One review, bound to the head commit it reviewed. */
export interface ReviewRecord {
  /** c:<comment id> / r:<review id> (from GitHub, so a second look finds the same one), o:<random> (the office). */
  id: string;
  pr: number;
  /** The full head SHA it reviewed (a stated short one is kept as stated when it isn't on the branch). */
  sha: string;
  /** How the SHA was known: stated in the comment, inferred from the commit times, GitHub's own, or the office's. */
  shaFrom: 'stated' | 'inferred' | 'github' | 'office';
  verdict: ReviewVerdict;
  reviewer: Reviewer;
  at: number;
  source: ReviewSource;
  note?: string;
}

export interface OverrideRecord {
  pr: number;
  sha: string;
  reason: string;
  by: { name: string; id?: string };
  at: number;
}

/** A pull request's commit, oldest first in a list. */
export interface PrCommit {
  oid: string;
  at: number;
  /** The author names git recorded ("Sophie (Mx Office Lead Developer)", "Keith Chin"). */
  authors: string[];
}

export type ReviewState = 'reviewed' | 'changes' | 'stale' | 'none';

export interface RefusedReview {
  id: string;
  who: string;
  why: string;
}

/** The review status of a pull request's current head. */
export interface HeadReview {
  state: ReviewState;
  head: string;
  /** The review it rests on: the approval (reviewed), the request for changes (changes), the last one before the new commits (stale). */
  record?: ReviewRecord;
  /** Stale: commits on the branch since the reviewed one (undefined: that commit isn't on the branch any more). */
  since?: number;
  /** Reviews that don't count, and why (the author reviewing itself, no verdict, …). */
  refused: RefusedReview[];
  text: string;
}

export type ChecksState = 'pass' | 'fail' | 'pending' | 'none';

export interface GateDecision {
  allowed: boolean;
  /** Why it may or may not merge, in a sentence. */
  reason: string;
  /** Allowed only because an admin overrode the gate for this head. */
  override?: OverrideRecord;
}

/** Branch protection on the PR's base, as the office could read it (never written). */
export interface ProtectionView {
  branch: string;
  state: 'requires-gate' | 'protected' | 'unprotected' | 'unknown';
  /** The status checks GitHub requires on it. */
  contexts: string[];
  text: string;
  /** How much it enforces the review (shared/merge-gate-protection.ts): Enforced / Weak / None / Unknown, in words. */
  verdict?: ProtectionVerdict;
  verdictText?: string;
  /** The GitHub App ids a required mx-office/review is restricted to; the human approvals and code-owner review GitHub requires. */
  appIds?: number[];
  approvals?: number;
  codeOwners?: boolean;
}

/** What the PR window shows (GET /api/merge-gate). */
export interface MergeGateView {
  pr: number;
  state: 'OPEN' | 'MERGED' | 'CLOSED';
  head: string;
  review: HeadReview;
  checks: ChecksState;
  decision: GateDecision;
  /** Whether "merge automatically once the checks pass" would be allowed (checks still running). */
  autoAllowed?: boolean;
  protection?: ProtectionView;
  /** Every review recorded for this PR, newest first (the history). */
  history: ReviewRecord[];
  overrides: OverrideRecord[];
  /** The agents and people who authored its commits (they can't review it). */
  authors: string[];
  /** The `mx-office/review` status last posted on this head, when the office posted one. */
  posted?: StatusPost;
  /** Whether you may override (an admin). */
  admin?: boolean;
  /** Who reviews: the person when no other agent can (Solo). */
  personReviews?: boolean;
  /** Reading the PR from GitHub failed. */
  error?: string;
}

export interface StatusPost {
  sha: string;
  state: 'success' | 'pending' | 'failure';
  description: string;
  at: number;
  error?: string;
}

const lower = (s: string | undefined) => (s ?? '').trim().toLowerCase();
export const sameName = (a: string | undefined, b: string | undefined) => !!lower(a) && lower(a) === lower(b);
export const short = (sha: string | undefined) => (sha ?? '').slice(0, 7);
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

/** A `Verdict:` word in words: approve(d) / LGTM, changes requested / reject, comment. */
export function verdictWord(text: string | undefined): ReviewVerdict | undefined {
  const t = lower(text).replace(/[*_`.!]/g, '');
  if (!t) return undefined;
  if (/^(approved?|approve this revision|lgtm|accept(ed)?|pass(ed)?|ok)\b/.test(t)) return 'approve';
  if (/^(changes?( requested)?|request(ed)? changes|reject(ed)?|block(ed)?|fail(ed)?|needs? (work|changes))\b/.test(t)) return 'changes';
  if (/^(comments?( only)?|neutral|fyi)\b/.test(t)) return 'comment';
  return undefined;
}

/** The `Head:` and `Verdict:` lines of a Review comment, when it has them. */
export function bindingOf(body: string | undefined): { head?: string; verdict?: ReviewVerdict } {
  const out: { head?: string; verdict?: ReviewVerdict } = {};
  for (const raw of (body ?? '').replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.replace(/[*_`]/g, '').trim();
    const head = /^(?:head|commit|revision|reviewed (?:head|commit|revision)|sha)\s*:\s*([0-9a-f]{7,40})\b/i.exec(line);
    if (head && !out.head) out.head = head[1].toLowerCase();
    const v = /^verdict\s*:\s*(.+)$/i.exec(line);
    if (v && !out.verdict) out.verdict = verdictWord(v[1]);
  }
  return out;
}

/** A Review comment's verdict: its `Verdict:` line, else (before BINDING_SINCE only) an approval. */
export function verdictOf(body: string | undefined, at: number): ReviewVerdict | undefined {
  return bindingOf(body).verdict ?? (at < BINDING_SINCE ? 'approve' : undefined);
}

/** The full SHA a stated head names on the branch, else the head as stated. */
export function fullSha(stated: string, commits: readonly PrCommit[]): string {
  const s = lower(stated);
  return commits.find((c) => c.oid.toLowerCase().startsWith(s))?.oid ?? s;
}

/** The branch's head when a comment was posted: the newest commit made at or before it. */
export function headAt(at: number, commits: readonly PrCommit[]): string | undefined {
  let found: string | undefined;
  for (const c of commits) if (c.at <= at) found = c.oid;
  return found;
}

/** Whether a reviewer is one of the PR's authors (an agent by name, a person by name). */
export function isAuthor(r: Reviewer, authors: readonly string[]): boolean {
  return authors.some((a) => sameName(a, r.name));
}

const whoOf = (r: Reviewer) => (r.role ? `${r.name} (${r.role})` : r.name);
const matches = (sha: string, head: string) => !!sha && !!head && (head.toLowerCase().startsWith(sha.toLowerCase()) || sha.toLowerCase().startsWith(head.toLowerCase()));

/**
 * The review status of `head`: reviewed (an independent approval of exactly this commit and no standing
 * request for changes on it), changes (an independent reviewer's last word on this commit asks for
 * changes), stale (reviewed, but the branch moved on since), or none.
 */
export function headReview(input: { head: string; commits: readonly PrCommit[]; records: readonly ReviewRecord[]; authors: readonly string[] }): HeadReview {
  const { head, commits, authors } = input;
  const refused: RefusedReview[] = [];
  const counted: ReviewRecord[] = [];
  for (const r of [...input.records].sort((a, b) => a.at - b.at)) {
    if (isAuthor(r.reviewer, authors)) refused.push({ id: r.id, who: whoOf(r.reviewer), why: 'authored commits on this pull request, so it can’t review it' });
    else if (r.verdict === 'comment') refused.push({ id: r.id, who: whoOf(r.reviewer), why: 'gave no approving verdict (comment only, or no Verdict: line)' });
    else counted.push(r);
  }
  // Each reviewer's last word on this exact head.
  const last = new Map<string, ReviewRecord>();
  for (const r of counted) if (matches(r.sha, head)) last.set(`${r.reviewer.kind}:${lower(r.reviewer.name)}`, r);
  const words = [...last.values()];
  const changes = words.filter((r) => r.verdict === 'changes').pop();
  if (changes) return { state: 'changes', head, record: changes, refused, text: `Changes requested by ${whoOf(changes.reviewer)} at ${short(head)}` };
  const ok = words.filter((r) => r.verdict === 'approve').pop();
  if (ok) return { state: 'reviewed', head, record: ok, refused, text: `Reviewed ✓ by ${whoOf(ok.reviewer)} at ${short(head)}` };
  const before = counted.filter((r) => !matches(r.sha, head)).pop();
  if (before) {
    const i = commits.findIndex((c) => matches(before.sha, c.oid));
    const since = i >= 0 ? commits.length - 1 - i : undefined;
    const moved = since === undefined ? `the reviewed commit ${short(before.sha)} is no longer on the branch` : `changed since review: ${plural(since, 'commit')}`;
    return { state: 'stale', head, record: before, ...(since !== undefined ? { since } : {}), refused, text: `Stale: ${before.verdict === 'changes' ? 'changes were requested' : 'reviewed'} by ${whoOf(before.reviewer)} at ${short(before.sha)}, ${moved}` };
  }
  return { state: 'none', head, refused, text: refused.length ? `Not reviewed: ${refused.length === 1 ? 'one review doesn’t' : `${refused.length} reviews don’t`} count` : 'Not reviewed yet' };
}

/** The override in force for this head, if any. */
export function overrideFor(overrides: readonly OverrideRecord[], pr: number, head: string, now: number): OverrideRecord | undefined {
  return [...overrides].reverse().find((o) => o.pr === pr && matches(o.sha, head) && now - o.at >= 0 && now - o.at < OVERRIDE_MS);
}

/** Whether the office's Merge button may merge: a counting approval of the head and no failing (or, unless auto, running) checks. */
export function gateDecision(review: HeadReview, checks: ChecksState, opts: { auto?: boolean; override?: OverrideRecord } = {}): GateDecision {
  const why = (() => {
    if (review.state === 'changes') return `${review.text}. The author addresses them and asks again.`;
    if (review.state === 'stale') return `${review.text}. The new head ${short(review.head)} needs its own review.`;
    if (review.state === 'none') return `No review counts for the head ${short(review.head)} yet. An independent reviewer (another agent, or you) records one for this revision first.`;
    if (checks === 'fail') return 'Checks are failing on this revision.';
    if (checks === 'pending' && !opts.auto) return 'Checks are still running on this revision. Merge once they pass, or set it to merge automatically.';
    return '';
  })();
  if (!why) return { allowed: true, reason: `${review.text}${checks === 'pass' ? ', checks passed' : checks === 'none' ? ', no checks reported' : ''}.` };
  if (opts.override) return { allowed: true, reason: `Overridden by ${opts.override.by.name}: “${opts.override.reason}”. Without it: ${why}`, override: opts.override };
  return { allowed: false, reason: `Not merged: ${why}` };
}

/** The `mx-office/review` status for a head: success only with a counting approval. */
export function statusOf(review: HeadReview): Pick<StatusPost, 'state' | 'description'> {
  const cut = (s: string) => (s.length > 138 ? `${s.slice(0, 137)}…` : s);
  if (review.state === 'reviewed') return { state: 'success', description: cut(review.text) };
  if (review.state === 'changes') return { state: 'failure', description: cut(review.text) };
  return { state: 'pending', description: cut(review.state === 'stale' ? review.text : `Waiting for an independent review of ${short(review.head)} recorded in Mx Office`) };
}

/** Whether a check in a rollup is the office's own review status (left out of the PR's checks). */
export const isGateStatus = (c: { context?: unknown; name?: unknown }) => c?.context === STATUS_CONTEXT || c?.name === STATUS_CONTEXT;

/** Branch protection in words, from the required contexts GitHub reports (and the approvals and App restriction, when read). */
export function protectionOf(branch: string, read: ({ protected: boolean; contexts: readonly string[] } & ProtectionFacts) | { error: string }): ProtectionView {
  if ('error' in read) return { branch, state: 'unknown', contexts: [], text: `Couldn’t read ${branch}’s protection (${read.error}). The gate may be advisory only.`, ...protectionVerdict(branch, { requiresGate: false, unknown: true }) };
  const contexts = [...new Set(read.contexts)];
  const requiresGate = contexts.includes(STATUS_CONTEXT);
  const facts: ProtectionFacts = { ...(read.appIds?.length ? { appIds: [...new Set(read.appIds)] } : {}), ...(read.approvals !== undefined ? { approvals: read.approvals } : {}), ...(read.codeOwners ? { codeOwners: true } : {}) };
  const v = { ...facts, ...protectionVerdict(branch, { requiresGate, ...facts }) };
  if (requiresGate) return { branch, state: 'requires-gate', contexts, text: `${branch} is protected and requires ${STATUS_CONTEXT}, which the office posts with the agents’ token: an agent holding that token could post it too.`, ...v };
  if (read.protected || contexts.length) return { branch, state: 'protected', contexts, text: `${branch} is protected, but doesn’t require ${STATUS_CONTEXT}: agents can still merge unreviewed work with gh. The gate is advisory outside the office.`, ...v };
  return { branch, state: 'unprotected', contexts, text: `${branch} isn’t protected: only the office’s own Merge button checks the gate; an agent’s gh pr merge doesn’t.`, ...v };
}
