// The worker ranking's types and its arithmetic: what a criterion is, how scores turn into grades, and
// the two curves every "compared with its peers" number goes through. Pure, so the server grades with
// it, the Workers tab shows the same weights, and the tests pin it without a browser or a disk.

import type { RunRecord } from '../analysis.js';
import type { Escalation } from '../roster/escalation.js';
import type { RoleId } from '../roster/roles.js';
import type { Proposal } from '../roster/types.js';

/** A–F without E: the user asked for A–F, and five letters on the usual school scale read best. */
export type Grade = 'A' | 'B' | 'C' | 'D' | 'F';
export const GRADES: readonly Grade[] = ['A', 'B', 'C', 'D', 'F'];
/** The lowest score that earns each grade; anything under the last is an F. */
export const GRADE_FLOORS: readonly [Grade, number][] = [['A', 90], ['B', 80], ['C', 70], ['D', 60]];

export function gradeOf(score: number): Grade {
  for (const [g, min] of GRADE_FLOORS) if (score >= min) return g;
  return 'F';
}

/** How much a number can be trusted, by how many samples are behind it. */
export type Confidence = 'low' | 'medium' | 'high';

/** Under `medium` samples it's low, from `high` on it's high. */
export const confidenceOf = (n: number, medium = 2, high = 5): Confidence => (n >= high ? 'high' : n >= medium ? 'medium' : 'low');

/** A worker's role for ranking: a team role, or an ordinary hired worker. */
export type RankRole = RoleId | 'worker';

export interface Criterion {
  key: string;
  label: string;
  /** Its share of the score it counts toward (the standard four, or the specialist ranking). */
  weight: number;
  /** 0–100; missing when there isn't enough data, and then it's left out of the average. */
  score?: number;
  grade?: Grade;
  confidence?: Confidence;
  /** The facts the score was worked out from, one line each. */
  evidence: string[];
  /** Why there's no score, when there isn't one. */
  missing?: string;
}

/** What one part of a criterion came to: a 0–1 value, its weight inside the criterion, and the line saying why. */
export interface Part {
  value: number;
  weight: number;
  line: string;
}

/** Everything the office knows about a worker (or a team role's run of workers) that a grade is made from. */
export interface WorkerFacts {
  /** `<floor>:<worker id>`, or `<floor>:role:<role>` for a team role whose members came and went. */
  key: string;
  floor: string;
  floorName: string;
  /** Every worker id it has been, latest last. */
  workerIds: string[];
  name: string;
  color?: string;
  role: RankRole;
  model: string;
  modelLabel: string;
  /** Not at a desk any more: known only from its records. */
  gone: boolean;
  status?: string;
  lastSeen: number;
  /** Its tasks as the analyzer recorded them (server/analysis/). */
  runs: RunRecord[];
  /** A person typed into it while it's still at its desk and the analyzer hasn't a run for it yet. */
  liveInputs: number;
  /** What it raised to the Project Manager, and the proposals it made at standups. */
  escalations: Escalation[];
  proposals: Proposal[];
  /** The floor's autonomy level (shared/roster/autonomy.ts), when it has a team. */
  autonomy?: number;
  /** A team role's own evidence (specialist.ts). */
  team?: TeamFacts;
}

export interface TeamFacts {
  /** The floor's standups (the Project Coordinator runs them). */
  standups: { startedAt: number; compiledAt?: number; status: string }[];
  /** Escalations the Leads raised on the floor: how fast they were unblocked. */
  leadEscalations: Escalation[];
  /** Its team journal (docs/team/<team>.md): entries, the days they're on, ones with lessons, handoffs. */
  journal?: { entries: number; days: number; lessons: number; handoffs: number };
  /** Pull requests labelled with its team, as GitHub lists them now. */
  teamPrs?: { merged: number; closed: number; open: number; checksPass: number; checksFail: number };
  /** The floor's recorded runs (for the tester's tests, the designer's pages, the developer's mx check). */
  floorRuns: RunRecord[];
  /** The decision register (PROJECT.md ## Decisions) and the toolkit's gate verdicts. */
  decisions?: { confirmed: number; assumed: number; other: number };
  gates?: { pass: number; total: number };
}

export const clamp100 = (n: number) => Math.max(0, Math.min(100, n));
export const round1 = (n: number) => Math.round(n * 10) / 10;
export const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
export function median(xs: number[]): number | undefined {
  if (!xs.length) return undefined;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * Compared with peers as a ratio (mine / theirs, bigger is better): on par is 75 (a C, the middle of
 * the scale), twice as good is 100, half as good is 50, a quarter 25.
 */
export const relRatio = (x: number): number => (x <= 0 ? 0 : clamp100(75 + 25 * Math.log2(x)));

/** Compared with peers as a difference in points (0–100 scores): on par is 75, 20 points better is 100, 20 worse 50. */
export const relDiff = (d: number): number => clamp100(75 + 1.25 * d);

/** A criterion from its parts (weighted mean ×100), or "not enough data" when it has none. */
export function criterion(key: string, label: string, weight: number, parts: Part[], confidence: Confidence, missing: string, extra: string[] = []): Criterion {
  const total = parts.reduce((s, p) => s + p.weight, 0);
  if (!total) return { key, label, weight, evidence: extra, missing };
  const score = round1(clamp100((parts.reduce((s, p) => s + p.value * p.weight, 0) / total) * 100));
  return { key, label, weight, score, grade: gradeOf(score), confidence, evidence: [...parts.map((p) => p.line), ...extra] };
}

/** The weighted mean of the criteria that have a score, their weights scaled up to fill the gaps. */
export function combine(cs: Criterion[]): number | undefined {
  const scored = cs.filter((c) => c.score !== undefined);
  const total = scored.reduce((s, c) => s + c.weight, 0);
  return total ? round1(scored.reduce((s, c) => s + c.score! * c.weight, 0) / total) : undefined;
}

export const usd = (n: number) => `$${n.toFixed(2)}`;
export const mins = (ms: number) => `${Math.round(ms / 60_000)} min`;
export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
