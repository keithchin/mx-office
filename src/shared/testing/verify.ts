// Integrated-revision verification (Testing release 2): a merged PR's task is judged on its merge commit
// on the default branch, never on its PR head alone. Three answers:
//   * verified:     every required check passed or was waived on the merge commit ("Done (verified)");
//   * head-only:    the PR head passed, the merge commit has no results yet ("Passed on PR head,
//                   integrated revision not checked"), never verified;
//   * not-verified: a required check failed, is missing or was skipped on the merge commit ("Merged, not
//                   verified").
// Only verified counts as delivered. Pure: the server (testing/verify.ts) and the tests use it.

import { evaluatePolicy, type CheckState, type Criterion, type PolicyEval, type VerificationPolicy, type Waiver } from './policy.js';
import type { Revision, TestRunRecord } from './record.js';
import type { TestingView } from './view.js';

export type VerifyState = 'verified' | 'not-verified' | 'head-only';

export const VERIFY_WORDS: Record<VerifyState, string> = {
  verified: 'Done (verified)',
  'not-verified': 'Merged, not verified',
  'head-only': 'Passed on PR head, integrated revision not checked',
};

export interface IntegratedLook {
  policy: VerificationPolicy;
  records: readonly TestRunRecord[];
  /** The PR's head commit, and its merge commit on the default branch (unknown: not given yet). */
  head?: Revision;
  merge?: Revision;
  criteria?: readonly Criterion[];
  waivers?: readonly Waiver[];
}

export interface IntegratedResult {
  state: VerifyState;
  merge: PolicyEval;
  head?: PolicyEval;
}

export function verifyIntegrated(l: IntegratedLook): IntegratedResult {
  const merge = evaluatePolicy(l.policy, l.records, l.merge, { criteria: l.criteria, waivers: l.waivers });
  if (merge.verified) return { state: 'verified', merge };
  // Waivers are per revision: the head's results are only looked at to tell "not checked yet" apart.
  const head = l.head ? evaluatePolicy(l.policy, l.records, l.head, { criteria: l.criteria }) : undefined;
  if (merge.nothingRan && head?.verified) return { state: 'head-only', merge, head };
  return { state: 'not-verified', merge, ...(head ? { head } : {}) };
}

/** What a task keeps of its verification (Assignment.verify, roster/resume.ts). */
export interface TaskVerification {
  v: 1;
  state: VerifyState;
  pr: number;
  /** The merge commit it was judged on, and the PR head. */
  revision?: Revision;
  head?: Revision;
  at: number;
  checks: { key: string; state: CheckState; waivedBy?: string }[];
  /** The criteria its PR said it covers. */
  criteria?: string[];
  /** The Needs you item raised for "Merged, not verified", and the revision it was raised for (once per task revision). */
  escalationId?: string;
  raisedFor?: string;
}

export const VERIFY_V = 1;

/** What an acceptance record keeps of Testing at its accepted commit (AcceptanceRecord.testing, optional). */
export interface TestingSummary {
  v: 1;
  commit: Revision;
  /** The Testing tab's cache key then: main's commit and the newest record id. */
  cacheKey: string;
  counts: TestingView['counts'];
  totalRuns: number;
  policy: VerificationPolicy;
  policyFrom: 'default' | 'project';
  /** The policy against the records at the accepted commit. */
  evaluation: PolicyEval;
  notes: string[];
}

/** A merged task the Verification panel lists (anything but verified). */
export interface VerificationTask {
  role: string;
  name: string;
  task: string;
  pr: number;
  url?: string;
  state: VerifyState | 'integrated';
  revision?: string;
  head?: string;
  checks: { key: string; state: CheckState; waivedBy?: string }[];
}

/** The Verification panel (GET /api/testing?part=verification). */
export interface VerificationView {
  policy: VerificationPolicy;
  from: 'default' | 'project';
  by?: string;
  at?: number;
  words: string;
  /** main's newest integrated revision: the newest merged PR's merge commit, judged against the project's policy. */
  newest?: { pr: number; url: string; title: string; revision: string; eval: PolicyEval };
  tasks: VerificationTask[];
  waivers: Waiver[];
  /** Whoever's looking may change the policy and waive (an admin). */
  admin?: boolean;
}
