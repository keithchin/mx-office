// The four criteria every agent is graded on, whatever its job: how it did against the baseline for its
// model, what it delivered, how far it got without a person stepping in, and what it got for its tokens.
// Each is 0–100 from parts with the evidence for each, and a criterion with nothing to go on says so
// and is left out rather than guessed.

import { autonomyOf, qualityOf, scoreRun, SUCCESS_VALUE, type RunRecord } from '../analysis.js';
import { clamp100, confidenceOf, criterion, mean, median, mins, plural, relDiff, relRatio, round1, usd, type Criterion, type Part, type WorkerFacts } from './model.js';

/** The standard criteria's weights in the overall score. Delivery leads: what shipped matters most. */
export const STANDARD_WEIGHTS = { benchmark: 0.25, delivery: 0.3, autonomy: 0.25, efficiency: 0.2 } as const;
export type StandardKey = keyof typeof STANDARD_WEIGHTS;
export const STANDARD_LABEL: Record<StandardKey, string> = {
  benchmark: 'Model benchmark',
  delivery: 'Delivery',
  autonomy: 'Autonomy',
  efficiency: 'Token efficiency',
};

/** Roles that deliver through pull requests of their own; the others deliver through their teams (specialist.ts). */
const PR_ROLES = new Set(['worker', 'lead-developer']);

/** The building's numbers a worker is compared with: every run the analyzer has, and the median value per dollar and per million tokens. */
export interface Baseline {
  runs: RunRecord[];
  valuePerUsd?: number;
  valuePerMtok?: number;
}

/**
 * A run's score, worked out once per record: the benchmark scores every run in the building for every
 * worker, which was most of a first ranking on a big office (records are replaced, never changed, when
 * they're updated, so the record itself is the key).
 */
const scores = new WeakMap<RunRecord, number | undefined>();
const scoreOf = (r: RunRecord) => {
  if (!scores.has(r)) scores.set(r, scoreRun(r).score);
  return scores.get(r);
};
const ranked = (runs: RunRecord[]) => runs.map((r) => ({ r, s: scoreOf(r) })).filter((x): x is { r: RunRecord; s: number } => x.s !== undefined);
/** Finished tasks that count: not still going, not a false start. */
export const finished = (runs: RunRecord[]) => runs.filter((r) => r.outcome !== 'running' && !r.excluded);
/** The finished tasks its PR-based criteria count: all of them for a role that delivers PRs, else only those that had one. */
export const counted = (f: Pick<WorkerFacts, 'role' | 'runs'>) => (PR_ROLES.has(f.role) ? finished(f.runs) : finished(f.runs).filter((r) => r.pr));
/** Tasks that say how it works: everything but false starts (a task still going counts). */
const working = (runs: RunRecord[]) => runs.filter((r) => !r.excluded || r.outcome === 'running');
const tokensOf = (r: RunRecord) => r.tokens.input + r.tokens.output + r.tokens.cacheWrite + r.tokens.cacheRead;

/** Value delivered: a merged PR is 1, open 0.7, closed 0.2 (shared/analysis.ts SUCCESS_VALUE), summed over finished tasks. */
export function valueOf(runs: RunRecord[]): { value: number; cost: number; tokens: number } {
  const done = finished(runs);
  return {
    value: done.reduce((n, r) => n + (r.outcome === 'running' ? 0 : SUCCESS_VALUE[r.outcome]), 0),
    cost: done.reduce((n, r) => n + r.cost, 0),
    tokens: done.reduce((n, r) => n + tokensOf(r), 0),
  };
}

/**
 * The building's baseline: every run, less the ones a worker's PR-based criteria don't count (a
 * Coordinator's planning sessions aren't a model's failed tasks), and the medians every worker's value
 * per dollar and per million tokens is held against.
 */
export function baselineOf(all: RunRecord[], workers: WorkerFacts[]): Baseline {
  const perUsd: number[] = [];
  const perMtok: number[] = [];
  const left = new Set<string>();
  for (const w of workers) {
    const mine = counted(w);
    const kept = new Set(mine);
    for (const r of w.runs) if (!kept.has(r)) left.add(r.id);
    const v = valueOf(mine);
    if (v.value <= 0) continue;
    if (v.cost > 0) perUsd.push(v.value / v.cost);
    if (v.tokens > 0) perMtok.push(v.value / (v.tokens / 1e6));
  }
  return { runs: all.filter((r) => !left.has(r.id)), valuePerUsd: median(perUsd), valuePerMtok: median(perMtok) };
}

/** 1. How its tasks scored against other workers on the same model, and the building; its cost and time against its model's. */
export function benchmark(f: WorkerFacts, base: Baseline): Criterion {
  const mine = ranked(counted(f));
  const label = STANDARD_LABEL.benchmark;
  const w = STANDARD_WEIGHTS.benchmark;
  if (!mine.length) return criterion('benchmark', label, w, [], 'low', PR_ROLES.has(f.role) ? 'No finished, ranked task yet' : 'No pull request of its own to compare: it delivers through its team');
  const ids = new Set(f.runs.map((r) => r.id));
  const others = ranked(base.runs.filter((r) => !ids.has(r.id)));
  const sameModel = others.filter((x) => x.r.modelLabel === f.modelLabel);
  const myScore = mean(mine.map((x) => x.s));
  const parts: Part[] = [];
  if (sameModel.length) {
    const avg = mean(sameModel.map((x) => x.s));
    parts.push({ value: relDiff(myScore - avg) / 100, weight: 0.6, line: `Task score ${myScore.toFixed(0)} vs ${f.modelLabel} average ${avg.toFixed(0)} (${plural(sameModel.length, 'other run')})` });
    const myCost = mean(mine.map((x) => x.r.cost));
    const theirCost = mean(sameModel.map((x) => x.r.cost));
    if (myCost > 0 && theirCost > 0) parts.push({ value: relRatio(theirCost / myCost) / 100, weight: 0.1, line: `Cost per task ${usd(myCost)} vs ${f.modelLabel} average ${usd(theirCost)}` });
    const myTime = mean(mine.map((x) => x.r.activeMs));
    const theirTime = mean(sameModel.map((x) => x.r.activeMs));
    if (myTime > 0 && theirTime > 0) parts.push({ value: relRatio(theirTime / myTime) / 100, weight: 0.1, line: `Working time per task ${mins(myTime)} vs ${f.modelLabel} average ${mins(theirTime)}` });
  }
  if (others.length) {
    const avg = mean(others.map((x) => x.s));
    parts.push({ value: relDiff(myScore - avg) / 100, weight: 0.2, line: `Task score ${myScore.toFixed(0)} vs every model's average ${avg.toFixed(0)} (${plural(others.length, 'run')})` });
  }
  const conf = sameModel.length ? confidenceOf(Math.min(sameModel.length, mine.length * 3), 3, 8) : 'low';
  return criterion('benchmark', label, w, parts, conf, 'Nothing to compare with yet: the first ranked task in the building', sameModel.length ? [] : [`No other ${f.modelLabel} runs yet: compared with every model only`]);
}

/** 2. What it delivered: its pull requests' fate, CI on them, and the quality scorecard. */
export function delivery(f: WorkerFacts): Criterion {
  const label = STANDARD_LABEL.delivery;
  const w = STANDARD_WEIGHTS.delivery;
  const done = finished(f.runs);
  // A role that delivers through its team isn't marked down for tasks without a PR of its own.
  const mine = counted(f);
  const parts: Part[] = [];
  if (mine.length) {
    const n = (o: string) => mine.filter((r) => r.outcome === o).length;
    const bits = [n('merged') && `${n('merged')} merged`, n('open') && `${n('open')} open`, n('closed') && `${n('closed')} closed unmerged (rework)`, n('no-pr') && `${n('no-pr')} without a PR`].filter(Boolean);
    parts.push({ value: mean(mine.map((r) => (r.outcome === 'running' ? 0 : SUCCESS_VALUE[r.outcome]))), weight: 0.5, line: `${plural(mine.length, 'finished task')}: ${bits.join(', ')}` });
  }
  const checked = mine.filter((r) => r.pr?.checks === 'pass' || r.pr?.checks === 'fail');
  if (checked.length) {
    const green = checked.filter((r) => r.pr!.checks === 'pass').length;
    parts.push({ value: green / checked.length, weight: 0.3, line: `CI green on ${green} of ${plural(checked.length, 'PR')}` });
  }
  const q = mine.map((r) => ({ r, q: qualityOf(r.scorecard) })).filter((x): x is { r: RunRecord; q: number } => x.q !== undefined);
  if (q.length) {
    const self = q.some((x) => x.r.scorecard?.source === 'self-reported');
    parts.push({ value: mean(q.map((x) => x.q)), weight: 0.2, line: `Quality scorecard ${(mean(q.map((x) => x.q)) * 100).toFixed(0)}/100 over ${plural(q.length, 'PR')}${self ? ' (partly self-reported)' : ''}` });
  }
  const missing = done.length ? 'Its tasks had no pull request of its own: its delivery is in its specialist ranking' : f.runs.length ? 'Still on its first task' : 'No recorded task yet';
  return criterion('delivery', label, w, parts, confidenceOf(mine.length, 2, 4), missing, f.autonomy !== undefined ? [`Floor autonomy level L${f.autonomy}`] : []);
}

/** 3. How far it got on its own: people stepping in per task, escalations that were warranted, its proposals taken up. */
export function autonomy(f: WorkerFacts): Criterion {
  const label = STANDARD_LABEL.autonomy;
  const w = STANDARD_WEIGHTS.autonomy;
  const parts: Part[] = [];
  const runs = working(f.runs);
  const tasks = runs.length;
  if (tasks || f.liveInputs) {
    const prompts = runs.reduce((n, r) => n + r.humanPrompts, 0) + f.liveInputs;
    const stops = runs.reduce((n, r) => n + r.needsInput, 0);
    const waited = runs.reduce((n, r) => n + r.needsInputMs, 0);
    const per = (prompts + stops) / Math.max(1, tasks);
    const bits = [plural(prompts, 'human prompt'), plural(stops, 'stop on a question or permission', 'stops on a question or permission')];
    parts.push({ value: autonomyOf(per), weight: 0.6, line: `${bits.join(', ')} over ${plural(Math.max(1, tasks), 'task')}${waited >= 60_000 ? ` (${mins(waited)} waiting on people)` : ''}` });
  }
  // A team role's escalations are graded in its specialist ranking, so they aren't counted twice.
  if (f.role === 'worker') {
    const resolved = f.escalations.filter((e) => e.status === 'resolved' && e.resolution && !e.fyi);
    if (resolved.length) {
      const warranted = resolved.filter((e) => e.resolution!.verdict !== 'dismiss').length;
      parts.push({ value: warranted / resolved.length, weight: 0.2, line: `${warranted} of ${plural(resolved.length, 'escalation')} needed the Project Manager (the rest were dismissed)` });
    }
  }
  const decided = f.proposals.filter((p) => p.status !== 'pending');
  if (decided.length) {
    const taken = decided.filter((p) => p.status === 'approved' || p.status === 'auto').length;
    parts.push({ value: taken / decided.length, weight: 0.2, line: `${taken} of ${plural(decided.length, 'standup proposal')} approved` });
  }
  return criterion('autonomy', label, w, parts, confidenceOf(tasks, 2, 5), 'No recorded task yet', parts.length ? ['Self-correction (fixing its own CI failures) is not tracked yet'] : []);
}

/** 4. What it got for its tokens: value per dollar and per million tokens against the building's medians, and its cache hits. */
export function efficiency(f: WorkerFacts, base: Baseline): Criterion {
  const label = STANDARD_LABEL.efficiency;
  const w = STANDARD_WEIGHTS.efficiency;
  const parts: Part[] = [];
  const mine = counted(f);
  const v = valueOf(mine);
  const done = mine.length;
  if (done && v.cost > 0) {
    if (v.value <= 0) parts.push({ value: 0, weight: 0.8, line: `Spent ${usd(v.cost)} on ${plural(done, 'task')} with nothing merged or open (churn)` });
    else {
      if (base.valuePerUsd) {
        const mine = v.value / v.cost;
        parts.push({ value: relRatio(mine / base.valuePerUsd) / 100, weight: 0.5, line: `${mine.toFixed(2)} delivered per dollar vs the building's median ${base.valuePerUsd.toFixed(2)} (${usd(v.cost)} in all)` });
      }
      if (base.valuePerMtok && v.tokens > 0) {
        const mine = v.value / (v.tokens / 1e6);
        parts.push({ value: relRatio(mine / base.valuePerMtok) / 100, weight: 0.3, line: `${mine.toFixed(2)} delivered per million tokens vs the median ${base.valuePerMtok.toFixed(2)} (${round1(v.tokens / 1e6)}M tokens)` });
      }
    }
  }
  const t = working(f.runs).reduce((a, r) => ({ read: a.read + r.tokens.cacheRead, all: a.all + r.tokens.input + r.tokens.cacheWrite + r.tokens.cacheRead }), { read: 0, all: 0 });
  if (t.all > 0) parts.push({ value: clamp100((t.read / t.all) * 100) / 100, weight: 0.2, line: `${Math.round((t.read / t.all) * 100)}% of input tokens were cache hits` });
  const note = !done && parts.length ? [PR_ROLES.has(f.role) ? 'No finished task yet: only its cache hits count so far' : 'No pull request of its own: only its cache hits count'] : [];
  return criterion('efficiency', label, w, parts, done ? confidenceOf(done, 2, 5) : 'low', 'No token usage recorded yet', note);
}

export function standardCriteria(f: WorkerFacts, base: Baseline): Criterion[] {
  return [benchmark(f, base), delivery(f), autonomy(f), efficiency(f, base)];
}
