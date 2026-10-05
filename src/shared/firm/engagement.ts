// An engagement of the Firm: one audit of one project. What the Project Manager configures for it
// (with the Firm's defaults), the states it goes through, what each reviewer on it is doing, the
// questions they ask the project team, and the cost estimate shown before it starts. Pure: the
// server, the /firm page and the tests share it.

import type { TeamId } from '../roster/roles.js';
import { DEFAULT_FIRM_MODEL, firmModelId, isReviewerId, REVIEWERS, REVIEWER_BY_ID, type ReviewerId } from './roles.js';

export const TEST_TYPES = ['static', 'mx-check', 'unit', 'e2e', 'security', 'traceability', 'accessibility', 'performance'] as const;
export type TestType = (typeof TEST_TYPES)[number];
export const TEST_TYPE_LABEL: Record<TestType, string> = {
  static: 'Static review',
  'mx-check': 'mx check / lint',
  unit: 'Unit tests',
  e2e: 'E2E (Playwright, live app)',
  security: 'Security scan',
  traceability: 'Requirements traceability',
  accessibility: 'Accessibility',
  performance: 'Performance',
};

export const ARTIFACTS = ['test-plan', 'test-cases', 'test-results', 'screenshots', 'traceability', 'findings'] as const;
export type Artifact = (typeof ARTIFACTS)[number];
export const ARTIFACT_LABEL: Record<Artifact, string> = {
  'test-plan': 'Test plan',
  'test-cases': 'Test cases',
  'test-results': 'Test results',
  screenshots: 'Screenshots',
  traceability: 'Traceability matrix',
  findings: 'Findings register',
};

export const DOCS = ['executive', 'detailed'] as const;
export type DocKind = (typeof DOCS)[number];
export const DOC_LABEL: Record<DocKind, string> = { executive: 'Executive summary', detailed: 'Detailed report' };

export const DEPTHS = ['quick', 'standard', 'deep'] as const;
export type Depth = (typeof DEPTHS)[number];

export const AUDIT_TEAMS: readonly TeamId[] = ['design', 'development', 'testing', 'analysis'];

export interface EngagementConfig {
  floor: string;
  /** The project teams a specialist is attached to. */
  teams: TeamId[];
  /** Who's on it: the Partner always, the specialists for those teams by default, the optional ones when added. */
  reviewers: ReviewerId[];
  tests: TestType[];
  artifacts: Artifact[];
  docs: DocKind[];
  /** Recommendations: prioritised now / next / later, each with the team that owns it. */
  recommendations: boolean;
  depth: Depth;
  /** USD for the whole engagement: warned at 80%, wrapped up at 100%. */
  budget: number;
  /** Minutes from staffing to the hard stop. */
  maxMinutes: number;
  /** A model id per reviewer on it. */
  models: Partial<Record<ReviewerId, string>>;
  /** Whether a benched Lead may be hired back just to answer the Firm's questions. */
  allowRehire: boolean;
}

export const BUDGET_MAX = 2000;
export const MINUTES_MAX = 8 * 60;

export function defaultConfig(floor: string, models: Partial<Record<ReviewerId, string>> = {}): EngagementConfig {
  const reviewers = REVIEWERS.filter((r) => r.staffing !== 'optional').map((r) => r.id);
  return {
    floor,
    teams: [...AUDIT_TEAMS],
    reviewers,
    tests: ['static', 'mx-check', 'unit', 'traceability'],
    artifacts: ['test-plan', 'test-results', 'traceability', 'findings'],
    docs: ['executive', 'detailed'],
    recommendations: true,
    depth: 'standard',
    budget: 60,
    maxMinutes: 120,
    models: Object.fromEntries(reviewers.map((id) => [id, models[id] ?? DEFAULT_FIRM_MODEL])),
    allowRehire: false,
  };
}

const pick = <T extends string>(v: unknown, all: readonly T[]): T[] => (Array.isArray(v) ? [...new Set(v.filter((x): x is T => all.includes(x as T)))] : []);
const num = (v: unknown, lo: number, hi: number, d: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);

/** What the wizard sent, made safe: unknown values dropped, the Partner always on, numbers in range. A string says what's wrong. */
export function cleanConfig(raw: unknown, base: EngagementConfig): EngagementConfig | string {
  if (!raw || typeof raw !== 'object') return 'Send the engagement as JSON';
  const r = raw as Record<string, unknown>;
  const teams = 'teams' in r ? pick(r.teams, AUDIT_TEAMS) : base.teams;
  const asked = 'reviewers' in r ? pick(r.reviewers, REVIEWERS.map((x) => x.id)) : base.reviewers;
  // A specialist only comes for a team it's attached to; the optional ones and the Partner come regardless.
  const reviewers = REVIEWERS.filter((x) => x.staffing === 'always' || (asked.includes(x.id) && (x.staffing === 'optional' || teams.includes(x.team)))).map((x) => x.id);
  if (reviewers.length < 2) return 'Pick at least one team or reviewer to attach';
  const tests = 'tests' in r ? pick(r.tests, TEST_TYPES) : base.tests;
  if (!tests.length) return 'Pick at least one kind of test';
  const rawModels = (r.models && typeof r.models === 'object' ? r.models : {}) as Record<string, unknown>;
  const models: Partial<Record<ReviewerId, string>> = {};
  for (const id of reviewers) models[id] = firmModelId(rawModels[id] ?? base.models[id]);
  return {
    floor: base.floor,
    teams,
    reviewers,
    tests,
    artifacts: 'artifacts' in r ? pick(r.artifacts, ARTIFACTS) : base.artifacts,
    docs: 'docs' in r ? pick(r.docs, DOCS) : base.docs,
    recommendations: typeof r.recommendations === 'boolean' ? r.recommendations : base.recommendations,
    depth: DEPTHS.includes(r.depth as Depth) ? (r.depth as Depth) : base.depth,
    budget: Math.round(num(r.budget, 1, BUDGET_MAX, base.budget) * 100) / 100,
    maxMinutes: Math.round(num(r.maxMinutes, 10, MINUTES_MAX, base.maxMinutes)),
    models,
    allowRehire: typeof r.allowRehire === 'boolean' ? r.allowRehire : base.allowRehire,
  };
}

// ---- The engagement's lifecycle --------------------------------------------------------------

export type Phase = 'requested' | 'staffing' | 'fieldwork' | 'consolidating' | 'delivered' | 'cancelled' | 'failed';
export const PHASE_LABEL: Record<Phase, string> = {
  requested: 'Requested',
  staffing: 'Staffing',
  fieldwork: 'Interviews & review',
  consolidating: 'Partner consolidating',
  delivered: 'Report delivered',
  cancelled: 'Cancelled',
  failed: 'Failed',
};
/** Where each phase may go next. The end states go nowhere. */
export const TRANSITIONS: Record<Phase, readonly Phase[]> = {
  requested: ['staffing', 'cancelled'],
  staffing: ['fieldwork', 'cancelled', 'failed'],
  fieldwork: ['consolidating', 'cancelled', 'failed'],
  consolidating: ['delivered', 'cancelled', 'failed'],
  delivered: [],
  cancelled: [],
  failed: [],
};
export const canMove = (from: Phase, to: Phase) => TRANSITIONS[from].includes(to);
export const isActive = (p: Phase) => p === 'requested' || p === 'staffing' || p === 'fieldwork' || p === 'consolidating';

export type ReviewerStatus = 'queued' | 'staffing' | 'interviewing' | 'reviewing' | 'writing' | 'waiting' | 'done' | 'stopped' | 'failed';
export const REVIEWER_STATUS_LABEL: Record<ReviewerStatus, string> = {
  queued: 'Queued',
  staffing: 'Getting set up',
  interviewing: 'Interviewing',
  reviewing: 'Reviewing',
  writing: 'Writing',
  waiting: 'Waiting on the others',
  done: 'Done',
  stopped: 'Stopped',
  failed: 'Failed',
};

export interface ReviewerRun {
  id: ReviewerId;
  name: string;
  model: string;
  status: ReviewerStatus;
  /** USD spent so far (the runner's own tally, estimated mid-turn). */
  cost: number;
  tokens: { input: number; output: number; cacheRead: number; cacheWrite: number };
  /** The headless session it carries on with. */
  sessionId?: string;
  startedAt?: number;
  endedAt?: number;
  /** Its section of the report is in. */
  submitted: boolean;
  /** Its last line of activity, for the live view. */
  activity?: string;
  /** Times it was told to carry on after a turn ended with nothing to show. */
  nudges: number;
  asked: number;
}

export type QuestionStatus = 'open' | 'answered' | 'unanswered';
export interface Question {
  id: string;
  reviewer: ReviewerId;
  team: TeamId;
  /** Who it went to: the role and its name, or nobody (recorded unanswered). */
  to?: { role: string; name: string; workerId: string; relayed?: boolean; pending?: boolean };
  text: string;
  at: number;
  status: QuestionStatus;
  answer?: string;
  answeredAt?: number;
  /** Why nobody answered, when nobody did. */
  why?: string;
}

export interface TranscriptLine {
  at: number;
  who: string;
  text: string;
}

export interface Engagement {
  id: string;
  floor: string;
  floorName: string;
  repo?: string;
  /** The commit every reviewer's checkout is pinned to. */
  commit?: string;
  config: EngagementConfig;
  phase: Phase;
  requestedBy: string;
  requestedAt: number;
  startedAt?: number;
  endedAt?: number;
  reviewers: ReviewerRun[];
  questions: Question[];
  transcript: TranscriptLine[];
  /** The estimate shown when it was confirmed. */
  estimate: number;
  /** Budget alerts already raised. */
  warned80?: boolean;
  wrapUpAt?: number;
  /** Why it ended early, when it did. */
  note?: string;
  /** The report, once delivered (or the partial one, when it was cut short). */
  reportId?: string;
  /** When the PM first opened the report (the Needs-you item goes then). */
  readAt?: number;
  /** A sample, seeded for screenshots and demos: nobody ran it. */
  sample?: boolean;
}

export const spentOf = (e: Pick<Engagement, 'reviewers'>) => e.reviewers.reduce((n, r) => n + r.cost, 0);

// ---- Interviews: how many questions a reviewer may ask --------------------------------------

export const QUESTION_LIMITS: Record<Depth, { total: number; open: number; gapMs: number }> = {
  quick: { total: 3, open: 1, gapMs: 60_000 },
  standard: { total: 6, open: 2, gapMs: 45_000 },
  deep: { total: 12, open: 3, gapMs: 30_000 },
};
/** An open question nobody answered in this long is recorded unanswered and the reviewer moves on. */
export const ANSWER_TIMEOUT_MS = 20 * 60_000;

/** Whether a reviewer may ask another question now; a string says why not. */
export function mayAsk(e: Pick<Engagement, 'questions' | 'config'>, reviewer: ReviewerId, now: number): true | string {
  const lim = QUESTION_LIMITS[e.config.depth];
  const mine = e.questions.filter((q) => q.reviewer === reviewer);
  if (mine.length >= lim.total) return `You've asked your ${lim.total} questions for this engagement: work from the evidence now`;
  if (mine.filter((q) => q.status === 'open').length >= lim.open) return `You have ${lim.open} open question${lim.open === 1 ? '' : 's'} already: wait for an answer (it comes as your next prompt)`;
  const last = Math.max(0, ...mine.map((q) => q.at));
  if (now - last < lim.gapMs) return `One question every ${Math.round(lim.gapMs / 1000)} s: ask again in ${Math.ceil((lim.gapMs - (now - last)) / 1000)} s`;
  return true;
}

// ---- The estimate ----------------------------------------------------------------------------

/**
 * ESTIMATES, not measurements: the tokens one reviewer is expected to use at each depth (fresh input,
 * output, cache reads, cache writes). Reviewing reads a lot and caches most of it. Tune them from
 * real engagements' tallies (each report's statistics carry the actual cost).
 */
export const EST_TOKENS: Record<Depth, { input: number; output: number; cacheRead: number; cacheWrite: number }> = {
  quick: { input: 60_000, output: 25_000, cacheRead: 600_000, cacheWrite: 80_000 },
  standard: { input: 150_000, output: 60_000, cacheRead: 2_000_000, cacheWrite: 200_000 },
  deep: { input: 400_000, output: 150_000, cacheRead: 6_000_000, cacheWrite: 500_000 },
};
/** The Partner reads everyone's sections on top of its own review. */
export const PARTNER_FACTOR = 1.4;
/** Each kind of test past the first two adds this much work. */
export const TEST_FACTOR = 0.12;
/** E2E against the live app costs extra: screenshots and page dumps are big inputs. */
export const E2E_FACTOR = 0.25;

/** USD per million tokens [input, output, cache read]; cache writes at 1.25x input. */
export type PriceOf = (model: string) => [number, number, number];

export interface Estimate {
  total: number;
  perReviewer: { id: ReviewerId; model: string; usd: number }[];
  /** Always true: it's priced from EST_TOKENS, not measured. */
  estimate: true;
}

export function estimateCost(c: Pick<EngagementConfig, 'reviewers' | 'depth' | 'tests' | 'models'>, priceOf: PriceOf): Estimate {
  const t = EST_TOKENS[c.depth];
  const work = 1 + Math.max(0, c.tests.length - 2) * TEST_FACTOR + (c.tests.includes('e2e') ? E2E_FACTOR : 0);
  const perReviewer = c.reviewers.filter(isReviewerId).map((id) => {
    const model = c.models[id] ?? DEFAULT_FIRM_MODEL;
    const [pin, pout, pread] = priceOf(model);
    const base = (t.input * pin + t.output * pout + t.cacheRead * pread + t.cacheWrite * pin * 1.25) / 1e6;
    const usd = base * work * (id === 'partner' ? PARTNER_FACTOR : 1);
    return { id, model, usd: Math.round(usd * 100) / 100 };
  });
  return { total: Math.round(perReviewer.reduce((n, r) => n + r.usd, 0) * 100) / 100, perReviewer, estimate: true };
}

/** The budget's state: under 80%, past the warning, or at the cap. */
export function budgetState(spent: number, budget: number): 'ok' | 'warn' | 'cap' {
  if (spent >= budget) return 'cap';
  return spent >= budget * 0.8 ? 'warn' : 'ok';
}

/** The reviewer's role row, for names and titles. */
export const roleOf = (id: ReviewerId) => REVIEWER_BY_ID.get(id)!;

/** What the floor's 1D view shows about the Firm: the running audit, and alerts for the Needs-you strip. */
export interface FirmFloorStatus {
  floor: string;
  active?: { id: string; phase: Phase; reviewers: number; spent: number; budget: number; open: number };
  /** The latest delivered report not yet read on this floor. */
  reportReady?: { engagement: string; report: string; at: number };
  budgetWarn?: { engagement: string; spent: number; budget: number };
}
