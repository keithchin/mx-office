// A worker's grade from its criteria, everyone's ranks (in the building, on their floor, among their
// model, among their role), the averages by model and by role, and the highlights the rules can find
// in the evidence. GET /api/ranking is buildRanking's answer; the Workers tab draws it as it comes.

import { ROLE_BY_ID } from '../roster/roles.js';
import { baselineOf, finished, STANDARD_LABEL, STANDARD_WEIGHTS, standardCriteria } from './standard.js';
import { SPECIALIST_SHARE, specialistOf, type Specialist } from './specialist.js';
import { combine, gradeOf, GRADE_FLOORS, GRADES, mean, round1, usd, type Confidence, type Criterion, type Grade, type RankRole, type WorkerFacts } from './model.js';
import type { RunRecord } from '../analysis.js';

export interface Highlight {
  text: string;
  by: 'rules' | 'ai';
}

export interface Ranks {
  global?: number;
  floor?: number;
  model?: number;
  role?: number;
  /** How many graded workers each rank is out of. */
  of: { global: number; floor: number; model: number; role: number };
}

export interface RankedWorker {
  key: string;
  /** Its latest worker id; every id it has been is in workerIds. */
  id: string;
  workerIds: string[];
  name: string;
  kind: 'agent';
  role: RankRole;
  roleLabel: string;
  model: string;
  modelLabel: string;
  floor: string;
  floorName: string;
  color?: string;
  gone: boolean;
  status?: string;
  lastSeen: number;
  tasks: number;
  /** 0–100 and its letter; missing while there's nothing to grade it on. */
  score?: number;
  grade?: Grade;
  confidence: Confidence;
  standard: Criterion[];
  specialist?: Specialist;
  highlights: Highlight[];
  rank: Ranks;
  /** Points up or down since its last recorded day. */
  trend?: number;
}

export interface GroupStats {
  key: string;
  label: string;
  count: number;
  graded: number;
  avgScore?: number;
  avgGrade?: Grade;
  grades: Record<Grade, number>;
  /** The best of the group, by key. */
  top?: string;
}

export interface RankingReport {
  scope: 'floor' | 'all';
  floor?: string;
  floors: { id: string; name: string }[];
  weights: typeof STANDARD_WEIGHTS;
  labels: typeof STANDARD_LABEL;
  specialistShare: number;
  gradeFloors: typeof GRADE_FLOORS;
  /** Everyone in scope, best first; the ones with no grade yet at the end. */
  workers: RankedWorker[];
  byModel: GroupStats[];
  byRole: GroupStats[];
  generatedAt: number;
}

export const roleLabel = (r: RankRole) => (r === 'worker' ? 'Worker' : (ROLE_BY_ID.get(r)?.title ?? r));

/** The overall score: the standard four, with a team role's specialist ranking counting SPECIALIST_SHARE of it. */
export function overallOf(standard: Criterion[], specialist?: Specialist): number | undefined {
  const s = combine(standard);
  const sp = specialist?.score;
  if (s === undefined) return sp;
  if (sp === undefined) return s;
  return round1(s * (1 - SPECIALIST_SHARE) + sp * SPECIALIST_SHARE);
}

/** Low with under two criteria scored or one task; high with three or more and five tasks. */
export function overallConfidence(standard: Criterion[], tasks: number): Confidence {
  const scored = standard.filter((c) => c.score !== undefined).length;
  if (scored < 2 || tasks < 2) return 'low';
  return scored >= 3 && tasks >= 5 ? 'high' : 'medium';
}

/** What the rules can say it achieved, from its runs and records: two to four lines, best first. */
export function ruleHighlights(f: WorkerFacts, standard: Criterion[]): Highlight[] {
  const out: string[] = [];
  const done = finished(f.runs);
  const merged = done.filter((r) => r.outcome === 'merged');
  const firstTry = merged.filter((r) => r.pr?.checks === 'pass' && r.humanPrompts + r.needsInput === 0);
  if (firstTry.length) out.push(firstTry.length === 1 ? `Merged PR #${firstTry[0].pr!.number} with green CI and no human help` : `Merged ${firstTry.length} PRs with green CI and no human help`);
  else if (merged.length) out.push(merged.length === 1 ? `Merged PR #${merged[0].pr!.number}${merged[0].pr!.title ? `: ${merged[0].pr!.title}` : ''}` : `Merged ${merged.length} PRs`);
  const best = [...done].filter((r) => (r.scorecard?.score ?? 0) >= 90).sort((a, b) => b.scorecard!.score! - a.scorecard!.score!)[0];
  if (best?.pr) out.push(`Scored ${best.scorecard!.score}/100 on best practices in PR #${best.pr.number}`);
  const cheap = merged.filter((r) => r.cost > 0).sort((a, b) => a.cost - b.cost)[0];
  if (cheap && merged.length) out.push(`Delivered PR #${cheap.pr!.number} for ${usd(cheap.cost)}`);
  const approved = f.proposals.filter((p) => p.status === 'approved' || p.status === 'auto');
  if (approved.length) out.push(approved.length === 1 ? `Proposal approved at standup: ${approved[0].title}` : `${approved.length} standup proposals approved`);
  const quick = f.team?.leadEscalations.filter((e) => e.resolution && e.resolution.at - e.at <= 5 * 60_000).length ?? 0;
  if (f.role === 'pm' && quick) out.push(`Got ${quick} Lead escalation${quick === 1 ? '' : 's'} answered within 5 min`);
  const top = standard.filter((c) => (c.score ?? 0) >= 90).map((c) => c.label);
  if (top.length) out.push(`Top marks (90+) for ${top.join(', ').toLowerCase()}`);
  return out.slice(0, 4).map((text) => ({ text, by: 'rules' }));
}

/** One worker graded, without its ranks (those need everyone). */
export function gradeWorker(f: WorkerFacts, base: ReturnType<typeof baselineOf>): Omit<RankedWorker, 'rank' | 'trend'> {
  const standard = standardCriteria(f, base);
  const specialist = specialistOf(f);
  // Graded once it has finished a real task (or, for a team role, has a specialist score): a task still going, or a false start, isn't a result.
  const score = finished(f.runs).length || specialist?.score !== undefined ? overallOf(standard, specialist) : undefined;
  return {
    key: f.key,
    id: f.workerIds[f.workerIds.length - 1] ?? f.key,
    workerIds: f.workerIds,
    name: f.name,
    kind: 'agent',
    role: f.role,
    roleLabel: roleLabel(f.role),
    model: f.model,
    modelLabel: f.modelLabel,
    floor: f.floor,
    floorName: f.floorName,
    color: f.color,
    gone: f.gone,
    status: f.status,
    lastSeen: f.lastSeen,
    tasks: f.runs.length,
    score,
    grade: score === undefined ? undefined : gradeOf(score),
    confidence: overallConfidence(standard, f.runs.length),
    standard,
    specialist,
    highlights: score === undefined ? [] : ruleHighlights(f, standard),
  };
}

/** Best first; equal scores go to the one with more tasks behind it, then by name. Ungraded last. */
export function byRank(a: Pick<RankedWorker, 'score' | 'tasks' | 'name'>, b: Pick<RankedWorker, 'score' | 'tasks' | 'name'>): number {
  if (a.score === undefined || b.score === undefined) return a.score === undefined ? (b.score === undefined ? a.name.localeCompare(b.name) : 1) : -1;
  return b.score - a.score || b.tasks - a.tasks || a.name.localeCompare(b.name);
}

/** 1-based ranks of the graded workers within each group `keyOf` makes. */
export function ranksWithin<T extends Pick<RankedWorker, 'key' | 'score' | 'tasks' | 'name'>>(ws: T[], keyOf: (w: T) => string): { rank: Map<string, number>; of: Map<string, number> } {
  const groups = new Map<string, T[]>();
  for (const w of ws) if (w.score !== undefined) groups.set(keyOf(w), [...(groups.get(keyOf(w)) ?? []), w]);
  const rank = new Map<string, number>();
  const of = new Map<string, number>();
  for (const [g, list] of groups) {
    list.sort(byRank).forEach((w, i) => rank.set(w.key, i + 1));
    of.set(g, list.length);
  }
  return { rank, of };
}

export function groupStats(ws: RankedWorker[], keyOf: (w: RankedWorker) => [string, string]): GroupStats[] {
  const groups = new Map<string, { label: string; list: RankedWorker[] }>();
  for (const w of ws) {
    const [key, label] = keyOf(w);
    const g = groups.get(key) ?? { label, list: [] };
    g.list.push(w);
    groups.set(key, g);
  }
  return [...groups]
    .map(([key, { label, list }]) => {
      const graded = list.filter((w) => w.score !== undefined);
      const grades = Object.fromEntries(GRADES.map((g) => [g, graded.filter((w) => w.grade === g).length])) as Record<Grade, number>;
      const avg = graded.length ? round1(mean(graded.map((w) => w.score!))) : undefined;
      return { key, label, count: list.length, graded: graded.length, avgScore: avg, avgGrade: avg === undefined ? undefined : gradeOf(avg), grades, top: [...graded].sort(byRank)[0]?.key };
    })
    .sort((a, b) => (b.avgScore ?? -1) - (a.avgScore ?? -1) || b.count - a.count || a.label.localeCompare(b.label));
}

export interface BuildOpts {
  floor?: string;
  floors: { id: string; name: string }[];
  /** Each worker's score on its last recorded day before today, for the trend. */
  previous?: (key: string) => number | undefined;
  /** Highlights better than the rules' (the small model's), by key. */
  highlights?: (key: string) => Highlight[] | undefined;
  now?: number;
}

/** Everyone graded and ranked across the building; then the floor's, when one is asked for. */
export function buildRanking(facts: WorkerFacts[], allRuns: RunRecord[], opts: BuildOpts): RankingReport {
  const base = baselineOf(allRuns, facts);
  return rankGraded(
    facts.map((f) => gradeWorker(f, base)),
    opts,
  );
}

/**
 * buildRanking a slice at a time, for the office's background refresh: grading every worker against the
 * building's runs took 0.1–0.6 s on a big office on a loaded machine, all in one go on the event loop
 * (the busy office check, 2026-10-08). Here `pause` is awaited whenever a slice has run `sliceMs`
 * (the office lets other work in there). The same steps in the same order: the same report.
 */
export async function buildRankingSliced(facts: WorkerFacts[], allRuns: RunRecord[], opts: BuildOpts, pause: () => Promise<void>, sliceMs = 12): Promise<RankingReport> {
  let t = Date.now();
  const breathe = async () => {
    if (Date.now() - t < sliceMs) return;
    await pause();
    t = Date.now();
  };
  const base = baselineOf(allRuns, facts);
  await breathe();
  const graded: Omit<RankedWorker, 'rank' | 'trend'>[] = [];
  for (const f of facts) {
    graded.push(gradeWorker(f, base));
    await breathe();
  }
  return rankGraded(graded, opts);
}

/** The graded workers ranked within each group, and the report around them. */
function rankGraded(graded: Omit<RankedWorker, 'rank' | 'trend'>[], opts: BuildOpts): RankingReport {
  const g = ranksWithin(graded, () => 'all');
  const fl = ranksWithin(graded, (w) => w.floor);
  const mo = ranksWithin(graded, (w) => w.modelLabel);
  const ro = ranksWithin(graded, (w) => w.role);
  const all: RankedWorker[] = graded.map((w) => {
    const prev = opts.previous?.(w.key);
    return {
      ...w,
      highlights: opts.highlights?.(w.key) ?? w.highlights,
      rank: {
        global: g.rank.get(w.key),
        floor: fl.rank.get(w.key),
        model: mo.rank.get(w.key),
        role: ro.rank.get(w.key),
        of: { global: g.of.get('all') ?? 0, floor: fl.of.get(w.floor) ?? 0, model: mo.of.get(w.modelLabel) ?? 0, role: ro.of.get(w.role) ?? 0 },
      },
      trend: prev !== undefined && w.score !== undefined ? round1(w.score - prev) : undefined,
    };
  });
  const workers = (opts.floor ? all.filter((w) => w.floor === opts.floor) : all).sort(byRank);
  return {
    scope: opts.floor ? 'floor' : 'all',
    floor: opts.floor,
    floors: opts.floors,
    weights: STANDARD_WEIGHTS,
    labels: STANDARD_LABEL,
    specialistShare: SPECIALIST_SHARE,
    gradeFloors: GRADE_FLOORS,
    workers,
    byModel: groupStats(workers, (w) => [w.modelLabel, w.modelLabel]),
    byRole: groupStats(workers, (w) => [w.role, w.roleLabel]),
    generatedAt: opts.now ?? Date.now(),
  };
}
