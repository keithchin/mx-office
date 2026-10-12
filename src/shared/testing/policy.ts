// Testing release 2: the verification policy and the state of each required check on a revision
// (docs/site/using-the-office/testing.md, "Verification policy and waivers"). A policy is the list of
// checks a task needs before it counts as verified, each named by a stable key that matches how the
// test-run records name their suites and checks: the pr-checks run's conclusion, its scorecard rows (mx
// check, lint, unit tests, e2e tests), and "e2e journeys for the task's linked acceptance criteria".
// A check on a revision is passed, failed, missing (nothing ran on that revision), skipped, or waived (a
// named person, with a reason, audited). Missing and skipped never count as passed.
// Pure (no Node imports): the server evaluates, the page shows.

import { sameRevision, type ResultStatus, type Revision, type TestRunRecord } from './record.js';
import { newestFirst } from './view.js';

export const CHECK_KEYS = ['pr-checks', 'mx-check', 'lint', 'unit-tests', 'e2e-tests'] as const;
export type CheckKey = (typeof CHECK_KEYS)[number];
/** The linked-criteria rule's key: it applies only to a task with linked criteria. */
export const LINKED = 'linked-criteria';
export type AnyCheckKey = CheckKey | typeof LINKED;

export const CHECK_LABEL: Record<AnyCheckKey, string> = {
  'pr-checks': 'pr-checks run (its overall conclusion)',
  'mx-check': 'Studio Pro mx check (scorecard row)',
  lint: 'Lint (scorecard row)',
  'unit-tests': 'Unit tests (scorecard row)',
  'e2e-tests': 'E2E tests (scorecard row)',
  [LINKED]: 'E2E journeys for the task’s linked acceptance criteria',
};

/** How a scorecard row's name says which check it is. */
const ROW: Record<Exclude<CheckKey, 'pr-checks'>, RegExp> = {
  'mx-check': /\bmx\s*check\b|\bmxcli check\b/i,
  lint: /\blint/i,
  'unit-tests': /\bunit\b/i,
  'e2e-tests': /\be2e\b|playwright|end[- ]to[- ]end/i,
};

export interface VerificationPolicy {
  v: 1;
  /** The checks required on the integrated revision. */
  required: CheckKey[];
  /** Whether e2e results for the task's linked acceptance criteria are required (only when it has some). */
  linkedCriteria: boolean;
}

/** With nothing configured: the pr-checks conclusion on the integrated revision, plus the linked-criteria rule. */
export const DEFAULT_POLICY: VerificationPolicy = { v: 1, required: ['pr-checks'], linkedCriteria: true };

export const isCheckKey = (k: unknown): k is CheckKey => typeof k === 'string' && (CHECK_KEYS as readonly string[]).includes(k);

/** A policy from what was saved or sent; undefined when it isn't one (a missing one means the default). */
export function cleanPolicy(raw: unknown): VerificationPolicy | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Partial<VerificationPolicy>;
  if (!Array.isArray(r.required)) return undefined;
  const required = CHECK_KEYS.filter((k) => r.required!.includes(k));
  return { v: 1, required, linkedCriteria: r.linkedCriteria !== false };
}

/** The policy in force for a task: its own override, else the project's, else the default. */
export const policyFor = (project: VerificationPolicy | undefined, task: VerificationPolicy | undefined): VerificationPolicy => task ?? project ?? DEFAULT_POLICY;

/** The policy in words, one line: "pr-checks run (…); e2e journeys for linked criteria when a task has them". */
export function policyWords(p: VerificationPolicy): string {
  const parts = p.required.map((k) => CHECK_LABEL[k]);
  if (p.linkedCriteria) parts.push('e2e journeys for the linked acceptance criteria, when a task has them');
  return parts.length ? parts.join('; ') : 'nothing required';
}

export type CheckState = 'passed' | 'failed' | 'missing' | 'skipped' | 'waived';

/** A waiver: a named person accepting a check that didn't pass on one revision, with why. Audited. */
export interface Waiver {
  check: AnyCheckKey;
  revision: Revision;
  by: string;
  accountId?: string;
  reason: string;
  at: number;
  /** The task it was given for, in words ("PR #12"). */
  task?: string;
}

export const WAIVER_REASON_MIN = 8;

/** Why a waiver can't be recorded, or undefined when it can. */
export function waiverProblem(w: { by?: unknown; reason?: unknown; check?: unknown; revision?: unknown }): string | undefined {
  if (typeof w.by !== 'string' || !w.by.trim()) return 'A waiver needs the name of the person giving it';
  if (typeof w.reason !== 'string' || w.reason.trim().length < WAIVER_REASON_MIN) return `A waiver needs a reason (at least ${WAIVER_REASON_MIN} characters)`;
  if (!(isCheckKey(w.check) || w.check === LINKED)) return 'Say which required check is waived';
  if (typeof w.revision !== 'string' || !/^[0-9a-f]{7,64}$/i.test(w.revision)) return 'Say which revision (commit) the waiver is for';
  return undefined;
}

export interface CheckEval {
  key: AnyCheckKey;
  label: string;
  state: CheckState;
  /** What decided it: the record and its result, in words. */
  detail?: string;
  runId?: string;
  waiver?: Waiver;
}

export interface PolicyEval {
  revision?: Revision;
  checks: CheckEval[];
  /** Every required check passed or waived. */
  verified: boolean;
  /** Not one required check has a result (or a waiver) on this revision. */
  nothingRan: boolean;
}

/** A criterion and the journeys that prove it (the acceptance-criteria table's Proof column). */
export interface Criterion {
  id: string;
  journeys?: string[];
}

const counts = (r: TestRunRecord) => {
  const c = { passed: 0, failed: 0, skipped: 0 };
  for (const t of r.results) c[t.status]++;
  return c;
};

/** A run's overall status: its recorded conclusion, else its results (any failure fails it). */
function overall(r: TestRunRecord): ResultStatus {
  if (r.conclusion) return r.conclusion;
  const c = counts(r);
  return c.failed ? 'failed' : c.passed ? 'passed' : 'skipped';
}

const toState = (s: ResultStatus): CheckState => s;

/** One check on the records of one revision (newest first). */
function evalKey(key: CheckKey, onRev: readonly TestRunRecord[]): Omit<CheckEval, 'label'> {
  const ci = onRev.filter((r) => r.source === 'pr-checks');
  if (key === 'pr-checks') {
    const r = ci[0];
    return r ? { key, state: toState(overall(r)), runId: r.id, detail: `${r.suite}: ${overall(r)}` } : { key, state: 'missing' };
  }
  for (const r of ci) {
    const hit = r.results.find((t) => ROW[key].test(t.name));
    if (hit) return { key, state: toState(hit.status), runId: r.id, detail: `${hit.name}: ${hit.status}${hit.detail ? ` (${hit.detail})` : ''}` };
  }
  return { key, state: 'missing' };
}

/** The linked-criteria rule: each criterion needs a test result on this revision that names it or one of its journeys. */
function evalLinked(criteria: readonly Criterion[], onRev: readonly TestRunRecord[]): Omit<CheckEval, 'label'> {
  const per = criteria.map((c) => {
    const ids = new Set([c.id, ...(c.journeys ?? [])]);
    for (const r of onRev) {
      // Only a test's own links: a run-wide link (a PR title naming AC-04) proves nothing about a journey.
      const hits = r.results.filter((t) => t.links.some((l) => ids.has(l.target)));
      if (hits.length) return { id: c.id, state: hits.some((t) => t.status === 'failed') ? 'failed' : hits.some((t) => t.status === 'passed') ? 'passed' : 'skipped', runId: r.id };
    }
    return { id: c.id, state: 'missing' as const, runId: undefined };
  });
  const order: CheckState[] = ['failed', 'missing', 'skipped', 'passed'];
  const state = (order.find((s) => per.some((p) => p.state === s)) ?? 'missing') as CheckState;
  const bad = per.filter((p) => p.state !== 'passed').map((p) => `${p.id} ${p.state}`);
  return { key: LINKED, state, detail: bad.length ? bad.join(', ') : `${per.map((p) => p.id).join(', ')} passed`, ...(per.find((p) => p.runId)?.runId ? { runId: per.find((p) => p.runId)!.runId } : {}) };
}

/**
 * The policy against the records for one revision: each required check's state there. A waiver for that
 * check on that revision turns anything but passed into waived. No revision (a merge commit not known):
 * every check is missing.
 */
export function evaluatePolicy(policy: VerificationPolicy, records: readonly TestRunRecord[], revision: Revision | undefined, opts: { criteria?: readonly Criterion[]; waivers?: readonly Waiver[] } = {}): PolicyEval {
  const onRev = revision ? newestFirst(records.filter((r) => sameRevision(r.testedRevision, revision))) : [];
  const raw: Omit<CheckEval, 'label'>[] = policy.required.map((k) => evalKey(k, onRev));
  if (policy.linkedCriteria && opts.criteria?.length) raw.push(evalLinked(opts.criteria, onRev));
  const checks = raw.map((c): CheckEval => {
    const waiver = c.state !== 'passed' && revision ? opts.waivers?.find((w) => w.check === c.key && sameRevision(w.revision, revision)) : undefined;
    return { ...c, label: CHECK_LABEL[c.key], ...(waiver ? { state: 'waived' as const, waiver } : {}) };
  });
  return {
    ...(revision ? { revision } : {}),
    checks,
    verified: checks.every((c) => c.state === 'passed' || c.state === 'waived'),
    nothingRan: checks.every((c) => c.state === 'missing'),
  };
}

/** What blocks verified, in words: "pr-checks run (…): missing; Lint (…): failed". */
export const blockingWords = (e: PolicyEval) =>
  e.checks
    .filter((c) => c.state !== 'passed' && c.state !== 'waived')
    .map((c) => `${c.label}: ${c.state}${c.detail && c.state !== 'missing' ? ` (${c.detail})` : ''}`)
    .join('; ');
