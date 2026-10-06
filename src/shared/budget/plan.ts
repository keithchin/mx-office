// The expected plan: what a project should cost, stage by stage (and build module by module once there's
// a build plan), and by when. Made from the size tier, the entry mode and the stages that mode runs,
// priced from this office's history (the analysis runs' cost per task type) where there's enough of it,
// else from the default rates below. Pure, so the server, the wizard's level cards and the tests agree.

import type { EntryMode, SizeTier } from '../wizard.js';
import type { BudgetPlan, CurvePoint, PlanLine, StageId } from './types.js';
import { STAGE_TITLE } from './types.js';

/**
 * The default rates: what each stage costs a standard-tier project at Balanced (Leads on Sonnet, the
 * Chief Analyst on Opus for Discovery, subagents on Sonnet), in USD, and how many working days it
 * takes. Set from this office's own first projects (October 2026: a Discovery with intake and Stage 0
 * ran $40-55 over two days; an Opus Lead's busy day is $8-15 and a Sonnet subagent's $3-7) and the
 * toolkit runbook's stage scope. Used for any line the history can't price.
 */
export const DEFAULT_RATES: Record<Exclude<StageId, '—'>, { usd: number; days: number }> = {
  P: { usd: 15, days: 1 },
  '0': { usd: 30, days: 1 },
  '1': { usd: 90, days: 3 },
  '2': { usd: 80, days: 3 },
  '3': { usd: 90, days: 3 },
  '4': { usd: 40, days: 1 },
  /** Per build module. */
  '5': { usd: 120, days: 2 },
  '6': { usd: 80, days: 2 },
  '7': { usd: 40, days: 1 },
};

/** The pipeline's stages in order. */
const PIPELINE: readonly Exclude<StageId, '—'>[] = ['P', '0', '1', '2', '3', '4', '5', '6', '7'];

/** A small project (at most 1 module, 8 screens, 25 use cases) costs this share of a standard one's analysis, design and test stages. */
export const SMALL_FACTOR = 0.5;
/** Build modules assumed before there's a build plan. */
export const DEFAULT_MODULES: Record<SizeTier, number> = { small: 1, standard: 4 };
/** An assurance-only project: no pipeline, one line. */
export const ASSURANCE = { small: { usd: 60, days: 2 }, standard: { usd: 150, days: 4 } };

/** The stages each entry mode runs, and how much of a full stage each is (the runbook's Entry Modes). */
export const MODE_STAGES: Record<EntryMode, Partial<Record<Exclude<StageId, '—'>, number>>> = {
  greenfield: { P: 0.5, '0': 0.5, '5': 1, '6': 1 },
  'requirements-driven': { P: 1, '0': 1, '1': 1, '2': 1, '3': 1, '4': 1, '5': 1, '6': 1 },
  'existing-app-change': { P: 1, '0': 1, '1': 0.6, '2': 0.6, '3': 0.6, '4': 0.6, '5': 1, '6': 1 },
  migration: { P: 1, '0': 1, '1': 1.3, '2': 1, '3': 1, '4': 1, '5': 1, '6': 1, '7': 1 },
  assurance: {},
};

/** The analysis runs' task types that price each kind of line, and how many runs a line takes. */
const HISTORY: Partial<Record<Exclude<StageId, '—'>, { types: string[]; runs: number }>> = {
  '1': { types: ['docs'], runs: 6 },
  '2': { types: ['docs'], runs: 5 },
  '5': { types: ['domain-model', 'logic', 'ui-pages', 'security'], runs: 4 },
  '6': { types: ['tests', 'bugfix'], runs: 4 },
};
/** Runs of a kind needed before history prices a line rather than the default rates. */
export const MIN_HISTORY = 5;

export interface HistoryRun {
  types: readonly string[];
  cost: number;
}

/** The median cost of a run of these task types, when there are enough of them. */
export function historyRate(runs: readonly HistoryRun[], types: readonly string[]): number | undefined {
  const costs = runs.filter((r) => r.cost > 0 && r.types.some((t) => types.includes(t))).map((r) => r.cost).sort((a, b) => a - b);
  if (costs.length < MIN_HISTORY) return undefined;
  const mid = Math.floor(costs.length / 2);
  return costs.length % 2 ? costs[mid] : (costs[mid - 1] + costs[mid]) / 2;
}

export interface PlanInput {
  tier: SizeTier;
  entry: EntryMode;
  /** The build plan's modules, once there is one. */
  modules?: string[];
  history?: readonly HistoryRun[];
  /** The plan's first day (YYYY-MM-DD). */
  start: string;
  now: number;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/** The plan, line by line. */
export function generatePlan(i: PlanInput): BudgetPlan {
  const lines: PlanLine[] = [];
  let fromHistory = 0;
  let fromDefaults = 0;
  if (i.entry === 'assurance') {
    const a = ASSURANCE[i.tier];
    lines.push({ id: 'assurance', stage: '—', label: 'Assurance work (no pipeline)', usd: a.usd, days: a.days, basis: 'default' });
    fromDefaults++;
  } else {
    const weights = MODE_STAGES[i.entry];
    // In pipeline order (an object's digit keys would come before P).
    for (const stage of PIPELINE) {
      const weight = weights[stage];
      if (weight === undefined) continue;
      const rate = DEFAULT_RATES[stage];
      const small = i.tier === 'small' && stage !== '5' ? SMALL_FACTOR : 1;
      const h = HISTORY[stage];
      const hist = h && i.history ? historyRate(i.history, h.types) : undefined;
      const days = Math.max(1, Math.round(rate.days * weight * (i.tier === 'small' && stage !== '5' ? 0.7 : 1)));
      if (stage === '5') {
        const mods = i.modules?.length ? i.modules : Array.from({ length: DEFAULT_MODULES[i.tier] }, (_, n) => `Module ${n + 1}`);
        const perModule = hist !== undefined ? hist * h!.runs : rate.usd;
        for (const [n, m] of mods.entries()) {
          lines.push({ id: `5:${n + 1}`, stage, label: i.modules?.length ? `Build · ${m}` : `Build · ${m} (assumed)`, usd: r2(perModule * weight), days, basis: hist !== undefined ? 'history' : 'default' });
          if (hist !== undefined) fromHistory++;
          else fromDefaults++;
        }
        continue;
      }
      const usd = hist !== undefined ? hist * h!.runs * small * weight : rate.usd * small * weight;
      lines.push({ id: stage, stage, label: `Stage ${stage} · ${STAGE_TITLE[stage]}`, usd: r2(usd), days, basis: hist !== undefined ? 'history' : 'default' });
      if (hist !== undefined) fromHistory++;
      else fromDefaults++;
    }
  }
  const days = lines.reduce((n, l) => n + l.days, 0);
  const basis = `${i.tier} ${i.entry} project${i.modules?.length ? `, ${i.modules.length} module${i.modules.length === 1 ? '' : 's'} from the build plan` : ''}: ${fromHistory ? `${fromHistory} line${fromHistory === 1 ? '' : 's'} from this office's history, ` : ''}${fromDefaults} from the default rates`;
  return { lines, start: i.start, end: addWorkDays(i.start, days), basis, generatedAt: i.now };
}

export const planTotal = (p: Pick<BudgetPlan, 'lines'>) => r2(p.lines.reduce((n, l) => n + l.usd, 0));

/** The plan's total for a tier and entry mode, at Balanced, from the defaults (and history when given). */
export const estimateFor = (tier: SizeTier, entry: EntryMode, history?: readonly HistoryRun[]) => planTotal(generatePlan({ tier, entry, history, start: '2026-01-05', now: 0 }));

const isWeekend = (day: string) => {
  const w = new Date(`${day}T12:00:00Z`).getUTCDay();
  return w === 0 || w === 6;
};
const nextDay = (day: string) => new Date(Date.parse(`${day}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10);

/** `day` plus `n` working days (Monday to Friday). */
export function addWorkDays(day: string, n: number): string {
  let d = day;
  let left = n;
  while (left > 0) {
    d = nextDay(d);
    if (!isWeekend(d)) left--;
  }
  return d;
}

/**
 * The expected cumulative spend by day: the lines one after another in pipeline order, each spread
 * evenly over its working days, from the plan's start to its end (weekends flat).
 */
export function expectedCurve(p: BudgetPlan): { day: string; expected: number }[] {
  const perDay: number[] = [];
  for (const l of p.lines) for (let k = 0; k < l.days; k++) perDay.push(l.usd / Math.max(1, l.days));
  const out: { day: string; expected: number }[] = [];
  let day = p.start;
  let cum = 0;
  let k = 0;
  // The start day counts as the first working day, whatever it is.
  for (let guard = 0; guard < 2000 && k < perDay.length; guard++) {
    if (guard === 0 || !isWeekend(day)) cum += perDay[k++];
    out.push({ day, expected: r2(cum) });
    day = nextDay(day);
  }
  return out;
}

/** Joins the expected curve and the actual daily spend into one series of days (the variance chart's points). */
export function curveOf(p: BudgetPlan | undefined, actualByDay: Record<string, number>, today: string): CurvePoint[] {
  const exp = p ? expectedCurve(p) : [];
  const days = new Set([...exp.map((e) => e.day), ...Object.keys(actualByDay).filter((d) => d <= today)]);
  const sorted = [...days].sort();
  if (!sorted.length) return [];
  // Every day from the first to the last of either, so the lines don't skip.
  const all: string[] = [];
  for (let d = sorted[0]; d <= sorted[sorted.length - 1]; d = nextDay(d)) all.push(d);
  const expMap = new Map(exp.map((e) => [e.day, e.expected]));
  const lastExp = exp[exp.length - 1];
  let cum = 0;
  let lastE = 0;
  return all.map((day) => {
    cum += actualByDay[day] ?? 0;
    const e = expMap.get(day);
    if (e !== undefined) lastE = e;
    const expected = exp.length ? (day < exp[0].day ? 0 : day > lastExp.day ? lastExp.expected : lastE) : undefined;
    return { day, ...(expected !== undefined ? { expected } : {}), ...(day <= today ? { actual: r2(cum) } : {}) };
  });
}
