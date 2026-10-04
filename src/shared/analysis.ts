// The worker performance analyzer: what one finished task looked like (a run record), and how runs
// add up to a ranking of the models that did them. Pure code, so the server ranks with it, the page
// shows what it ranked with (the weights), and the tests pin both without a browser or a disk.

/** The kinds of task a run can be, as the analyzer sorts them. A task can be several at once. */
export const TASK_TYPES = ['domain-model', 'ui-pages', 'logic', 'security', 'bugfix', 'tests', 'docs', 'other'] as const;
export type TaskType = (typeof TASK_TYPES)[number];

export const TASK_TYPE_LABEL: Record<TaskType, string> = {
  'domain-model': 'Domain model',
  'ui-pages': 'UI / pages',
  logic: 'Logic / microflows',
  security: 'Security',
  bugfix: 'Bug fix',
  tests: 'Tests',
  docs: 'Docs',
  other: 'Other',
};

/** How a run ended, as far as its pull request goes. `running` isn't over yet, so it isn't ranked. */
export type RunOutcome = 'merged' | 'open' | 'closed' | 'no-pr' | 'running';

/**
 * What the CI pipeline's scorecard comment says about a run's pull request, or failing that, what the
 * agent itself wrote in the PR's description ("Report: 95/100"): `source` says which, because a
 * score the agent gave itself is worth less than one a pipeline measured.
 */
export interface Scorecard {
  source: 'ci' | 'self-reported';
  /** Best-practices score out of 100 (mxcli report). */
  score?: number;
  /** Studio Pro's consistency check errors (mx check). */
  mxErrors?: number;
  lintErrors?: number;
  lintWarnings?: number;
  /** Tests that ran: unit and end-to-end together. Missing when none ran or nothing says. */
  testsPassed?: number;
  testsFailed?: number;
}

export interface RunTokens {
  input: number;
  output: number;
  cacheWrite: number;
  cacheRead: number;
}

/** One worker's task, from hire to its pull request, as the analyzer recorded it. */
export interface RunRecord {
  /** `<floor>:<worker id>`: worker ids are unique across the building, and a run is a worker's task. */
  id: string;
  floor: string;
  repo?: string;
  worker: string;
  workerId: string;
  provider: string;
  /** What the session ran on, as the API named it (claude-opus-5-5), else what was asked for. */
  model: string;
  /** For people: "Opus 5.5". */
  modelLabel: string;
  /** Reasoning effort, when one was chosen; none means the CLI's default. */
  effort?: string;
  title: string;
  issue?: number;
  /** The task as it was given, clipped. */
  prompt: string;
  startedAt: number;
  endedAt: number;
  /** Wall clock, first transcript line to last: what someone waiting for the PR sees. */
  durationMs: number;
  /** Time the agent was actually working (its turns added up): what the model's speed is judged on. */
  activeMs: number;
  apiCalls: number;
  toolCalls: number;
  tokens: RunTokens;
  /** USD, priced from the office's own table (server/usage.ts). */
  cost: number;
  /** Prompts a person typed after the task, before its PR was opened: nudges it needed to get there. */
  humanPrompts: number;
  /** Times it stopped on a permission prompt or question, and how long those waits added up to (seen live only). */
  needsInput: number;
  needsInputMs: number;
  outcome: RunOutcome;
  pr?: { number: number; url: string; title: string; state: string; additions: number; deletions: number; changedFiles?: number; checks?: string };
  scorecard?: Scorecard;
  types: TaskType[];
  /** Who sorted it: the small model, or the keyword rules when that wasn't there. */
  typesBy: 'llm' | 'keywords';
  /** One or two sentences on what went well or badly. */
  note?: string;
  /** Why it is left out of the ranking (still running, or too small to say anything), when it is. */
  excluded?: string;
  updatedAt: number;
}

// ---------------------------------------------------------------------------------------------
// Scoring

/**
 * How much each part counts toward a run's score. Quality first, because a fast, cheap run that
 * breaks the app is no use; then whether it got to a pull request at all; then cost and time;
 * then how often a person had to step in. A part with nothing to go on (no scorecard yet) is left
 * out and the rest are scaled up, rather than guessing it.
 */
export const WEIGHTS = { quality: 0.35, success: 0.3, efficiency: 0.2, autonomy: 0.15 } as const;
export type ScorePart = keyof typeof WEIGHTS;

/** Inside quality: the best-practices score, a clean consistency check, and the tests that ran. */
export const QUALITY_WEIGHTS = { score: 0.6, mxClean: 0.25, tests: 0.15 } as const;

/** What a PR's fate is worth: merged is the goal, an open PR is most of the way, closed unmerged is little. */
export const SUCCESS_VALUE: Record<Exclude<RunOutcome, 'running'>, number> = { merged: 1, open: 0.7, closed: 0.2, 'no-pr': 0 };

/** The cost and active time at which efficiency's two halves are worth one half each (it falls off smoothly either side). */
export const REF_COST_USD = 1;
export const REF_ACTIVE_MIN = 15;

/** Fewer runs than this and a ranking says so: one good run is a story, not a result. */
export const MIN_CONFIDENT_RUNS = 3;

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

export function qualityOf(sc: Scorecard | undefined): number | undefined {
  if (!sc) return undefined;
  const parts: [number, number][] = [];
  if (typeof sc.score === 'number') parts.push([clamp01(sc.score / 100), QUALITY_WEIGHTS.score]);
  if (typeof sc.mxErrors === 'number') parts.push([sc.mxErrors === 0 ? 1 : 0, QUALITY_WEIGHTS.mxClean]);
  const ran = (sc.testsPassed ?? 0) + (sc.testsFailed ?? 0);
  // Tests that never ran say nothing about the model (Run 2's runner needed Developer Mode), so they don't count either way.
  if (ran > 0) parts.push([(sc.testsPassed ?? 0) / ran, QUALITY_WEIGHTS.tests]);
  return weighted(parts);
}

export const successOf = (outcome: RunOutcome): number | undefined => (outcome === 'running' ? undefined : SUCCESS_VALUE[outcome]);

/** Half cost, half active time: $1 and 15 minutes each score 0.5, half of either scores 0.67. */
export function efficiencyOf(cost: number, activeMs: number): number {
  const cheap = 1 / (1 + Math.max(0, cost) / REF_COST_USD);
  const quick = 1 / (1 + Math.max(0, activeMs) / 60_000 / REF_ACTIVE_MIN);
  return 0.5 * cheap + 0.5 * quick;
}

/** No interventions is 1, one is 0.5, two 0.33, and so on. */
export const autonomyOf = (interventions: number): number => 1 / (1 + Math.max(0, interventions));

function weighted(parts: [number, number][]): number | undefined {
  const total = parts.reduce((s, [, w]) => s + w, 0);
  return total ? parts.reduce((s, [v, w]) => s + v * w, 0) / total : undefined;
}

export interface RunScore {
  /** 0-100, or undefined for a run that isn't ranked. */
  score?: number;
  parts: Partial<Record<ScorePart, number>>;
}

export function scoreRun(r: RunRecord): RunScore {
  const parts: Partial<Record<ScorePart, number>> = {};
  const q = qualityOf(r.scorecard);
  if (q !== undefined) parts.quality = q;
  const s = successOf(r.outcome);
  if (s !== undefined) parts.success = s;
  parts.efficiency = efficiencyOf(r.cost, r.activeMs);
  parts.autonomy = autonomyOf(r.humanPrompts + r.needsInput);
  if (r.excluded || s === undefined) return { parts };
  const score = weighted((Object.keys(parts) as ScorePart[]).map((k) => [parts[k]!, WEIGHTS[k]]));
  return { score: score === undefined ? undefined : Math.round(score * 1000) / 10, parts };
}

// ---------------------------------------------------------------------------------------------
// Ranking

export type GroupBy = 'model' | 'effort';

/** "claude-haiku-4-5-20251001" → "Haiku 4.5"; anything not a Claude id is shown as it is. */
export function modelLabel(model: string): string {
  const m = /^(?:claude-)?(opus|sonnet|haiku|fable|mythos)-(\d+(?:-\d{1,2})?)(?:-\d{8})?$/i.exec(model.trim());
  if (!m) return model || 'unknown';
  return `${m[1][0].toUpperCase()}${m[1].slice(1).toLowerCase()} ${m[2].replace('-', '.')}`;
}

export function groupKey(r: RunRecord, by: GroupBy): { key: string; label: string } {
  const base = r.modelLabel || modelLabel(r.model);
  if (by === 'model') return { key: base, label: base };
  const effort = r.effort ?? 'default';
  return { key: `${base}|${effort}`, label: `${base} · ${effort}` };
}

export interface LeaderRow {
  key: string;
  label: string;
  /** Runs ranked. */
  n: number;
  lowConfidence: boolean;
  /** Mean of the runs' scores, 0-100. */
  score: number;
  parts: Partial<Record<ScorePart, number>>;
  /** The raw numbers behind it, means over the ranked runs. */
  avgCost: number;
  avgDurationMs: number;
  avgActiveMs: number;
  /** Of the ranked runs: how many opened a PR, and how many of those merged. */
  prs: number;
  merged: number;
  /** Mean best-practices score where there was one, and how many runs had one. */
  avgQuality?: number;
  qualityN: number;
  /** Runs with Studio Pro's check clean, of those that reported it. */
  mxClean: number;
  mxN: number;
  avgInterventions: number;
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

/** One leaderboard row per model (or model and effort), best first. Unranked runs are left out. */
export function rank(runs: RunRecord[], by: GroupBy = 'model'): LeaderRow[] {
  const groups = new Map<string, { label: string; runs: RunRecord[]; scores: RunScore[] }>();
  for (const r of runs) {
    const s = scoreRun(r);
    if (s.score === undefined) continue;
    const { key, label } = groupKey(r, by);
    const g = groups.get(key) ?? { label, runs: [], scores: [] };
    g.runs.push(r);
    g.scores.push(s);
    groups.set(key, g);
  }
  const rows: LeaderRow[] = [];
  for (const [key, g] of groups) {
    const parts: Partial<Record<ScorePart, number>> = {};
    for (const k of Object.keys(WEIGHTS) as ScorePart[]) {
      const vs = g.scores.map((s) => s.parts[k]).filter((v): v is number => v !== undefined);
      if (vs.length) parts[k] = mean(vs);
    }
    const quality = g.runs.map((r) => r.scorecard?.score).filter((v): v is number => typeof v === 'number');
    const mx = g.runs.map((r) => r.scorecard?.mxErrors).filter((v): v is number => typeof v === 'number');
    rows.push({
      key,
      label: g.label,
      n: g.runs.length,
      lowConfidence: g.runs.length < MIN_CONFIDENT_RUNS,
      score: Math.round(mean(g.scores.map((s) => s.score!)) * 10) / 10,
      parts,
      avgCost: mean(g.runs.map((r) => r.cost)),
      avgDurationMs: mean(g.runs.map((r) => r.durationMs)),
      avgActiveMs: mean(g.runs.map((r) => r.activeMs)),
      prs: g.runs.filter((r) => r.pr).length,
      merged: g.runs.filter((r) => r.outcome === 'merged').length,
      avgQuality: quality.length ? mean(quality) : undefined,
      qualityN: quality.length,
      mxClean: mx.filter((e) => e === 0).length,
      mxN: mx.length,
      avgInterventions: mean(g.runs.map((r) => r.humanPrompts + r.needsInput)),
    });
  }
  // Best first; a tie goes to the one with more runs behind it.
  return rows.sort((a, b) => b.score - a.score || b.n - a.n || a.label.localeCompare(b.label));
}

export interface MatrixCell {
  score: number;
  n: number;
}

/** Each model's score on each kind of task: a run of several kinds counts toward each of them. */
export function matrix(runs: RunRecord[], by: GroupBy = 'model'): { rows: { key: string; label: string; cells: Partial<Record<TaskType, MatrixCell>> }[]; types: TaskType[] } {
  const rows = new Map<string, { label: string; acc: Partial<Record<TaskType, number[]>> }>();
  const seen = new Set<TaskType>();
  for (const r of runs) {
    const s = scoreRun(r).score;
    if (s === undefined) continue;
    const { key, label } = groupKey(r, by);
    const row = rows.get(key) ?? { label, acc: {} };
    for (const t of r.types.length ? r.types : (['other'] as TaskType[])) {
      (row.acc[t] ??= []).push(s);
      seen.add(t);
    }
    rows.set(key, row);
  }
  const types = TASK_TYPES.filter((t) => seen.has(t));
  return {
    types,
    rows: [...rows].map(([key, { label, acc }]) => ({
      key,
      label,
      cells: Object.fromEntries(Object.entries(acc).map(([t, xs]) => [t, { score: Math.round(mean(xs!) * 10) / 10, n: xs!.length }])) as Partial<Record<TaskType, MatrixCell>>,
    })),
  };
}

/** GET /api/analysis: the ranking for one floor or the whole building, and the runs behind it. */
export interface AnalysisReport {
  scope: 'global' | 'floor';
  floor?: string;
  by: GroupBy;
  weights: typeof WEIGHTS;
  qualityWeights: typeof QUALITY_WEIGHTS;
  successValue: typeof SUCCESS_VALUE;
  refCostUsd: number;
  refActiveMin: number;
  minConfidentRuns: number;
  leaderboard: LeaderRow[];
  matrix: ReturnType<typeof matrix>;
  /** Latest first, each with its score (none when unranked). */
  runs: (RunRecord & { score?: number })[];
  /** The floors there are runs for, to name them. */
  floors: { id: string; name: string }[];
  /** A backfill or re-analysis is under way. */
  busy: boolean;
}

export function buildReport(all: RunRecord[], opts: { floor?: string; by?: GroupBy; floors: { id: string; name: string }[]; busy: boolean }): AnalysisReport {
  const by = opts.by ?? 'model';
  const runs = opts.floor ? all.filter((r) => r.floor === opts.floor) : all;
  return {
    scope: opts.floor ? 'floor' : 'global',
    floor: opts.floor,
    by,
    weights: WEIGHTS,
    qualityWeights: QUALITY_WEIGHTS,
    successValue: SUCCESS_VALUE,
    refCostUsd: REF_COST_USD,
    refActiveMin: REF_ACTIVE_MIN,
    minConfidentRuns: MIN_CONFIDENT_RUNS,
    leaderboard: rank(runs, by),
    matrix: matrix(runs, by),
    runs: [...runs].sort((a, b) => b.startedAt - a.startedAt).map((r) => ({ ...r, score: scoreRun(r).score })),
    floors: opts.floors,
    busy: opts.busy,
  };
}
