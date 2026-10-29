// Per-stage overspend and pace: the warnings the 80 % alert can't give. A stage whose attributed spend
// passes its plan line (1×, then 2×, 5×, 10×) raises one warning per level; a person may dismiss it for
// that stage until the next level. The pace warning says the budget runs out (at the recent pace, an
// estimate) before the plan's end or a set milestone, at most once a day. Neither touches the budget's
// own alerts (shared/budget/alerts.ts) or its auto-pause. Pure: the server, the pages and the tests agree.

import type { RunOut } from './forecast.js';
import type { StageId, StageVariance } from './types.js';
import { usd, usdCents } from './money.js';

/** The plan-line multiples a stage's spend raises a warning at, each once. */
export const STAGE_MULTIPLES: readonly number[] = [1, 2, 5, 10];

/** A stage's warning as kept in the floor's budget file: the highest level raised, and whether it was dismissed at that level. */
export interface StageWarnRecord {
  stage: StageId;
  /** The multiple of the plan line raised last (1, 2, 5, 10). */
  multiple: number;
  at: number;
  planned: number;
  actual: number;
  dismissedAt?: number;
  dismissedBy?: string;
}

/** The pace warning as kept: raised on `day` (once a day at most), dismissed for that day. */
export interface PaceRecord {
  day: string;
  at: number;
  runOut: string;
  end: string;
  dismissedAt?: number;
  dismissedBy?: string;
}

/** What the end date is: the plan's end, or the project's milestone when that's earlier. */
export interface PaceEnd {
  end: string;
  endIs: 'plan' | 'milestone';
}

export interface StageWarnView {
  stage: StageId;
  label: string;
  planned: number;
  actual: number;
  /** actual ÷ planned now. */
  ratio: number;
  multiple: number;
  text: string;
  at: number;
  dismissed: boolean;
}

export interface PaceView extends PaceEnd {
  runOut: string;
  perDay: number;
  text: string;
  at: number;
  dismissed: boolean;
}

/** One row of the Budget tab's stage table. `planned` null: no plan line for that stage (missing, not $0). */
export interface StagePlanRow {
  stage: StageId;
  label: string;
  planned: number | null;
  spent: number;
  /** spent ÷ planned; null without a plan line. */
  ratio: number | null;
  done: boolean;
  current: boolean;
  /** The warning level raised for it, when one was. */
  warned?: number;
  dismissed?: boolean;
}

export interface StagePlanView {
  rows: StagePlanRow[];
  /** Spend booked to no stage (before the stage was known, or outside the pipeline). */
  unattributed: number;
  /** The project has no toolkit pipeline: spend can't be told apart by stage at all. */
  noPipeline: boolean;
  /** The stage in use is the one the team settled on a branch, because main still says an earlier one (its docs aren't merged yet). */
  stageVia?: { stage: StageId; main: StageId; branch: string };
  /** Of the spend, estimated from history (not split by stage). */
  estimated: number;
  /** Whether the plan's numbers are the office's own estimates (default rates or history) rather than set by a person. */
  planEstimated: boolean;
  runOut?: RunOut;
  end: string;
  endIs: PaceEnd['endIs'];
  warnings: StageWarnView[];
  pace?: PaceView;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/** The highest multiple `actual` has reached of `planned` (0 below the plan or without one). */
export function crossedMultiple(actual: number, planned: number): number {
  if (!(planned > 0)) return 0;
  const r = actual / planned;
  let m = 0;
  for (const x of STAGE_MULTIPLES) if (r >= x - 1e-9) m = x;
  return m;
}

/** "9×", "1.3×", "12×". */
export function ratioWord(ratio: number): string {
  const v = ratio < 10 ? Math.round(ratio * 10) / 10 : Math.round(ratio);
  return `${v}×`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "5 Nov" for 2026-11-05. */
export function dayWord(day: string): string {
  const [, m, d] = day.split('-').map(Number);
  return m && d ? `${d} ${MONTHS[m - 1]}` : day;
}

/** The earlier of the plan's end and the project's milestone (when set). */
export function paceEnd(planEnd: string, milestone?: string): PaceEnd {
  return milestone && milestone < planEnd ? { end: milestone, endIs: 'milestone' } : { end: planEnd, endIs: 'plan' };
}

const endWord = (e: PaceEnd) => (e.endIs === 'milestone' ? `the milestone (${dayWord(e.end)})` : `the plan's end (${dayWord(e.end)})`);

/** The run-out sentence: when the budget runs out at the recent pace (an estimate), against the end. */
export function runOutSentence(total: number | undefined, runOut: RunOut | undefined, e: PaceEnd): string {
  if (!total) return 'No project budget is set, so there is no run-out date.';
  if (!runOut) return `There is no recent spend to estimate when the project budget (${usd(total)}) runs out.`;
  return runOut.date < e.end
    ? `At this rate the project budget (${usd(total)}) runs out around ${dayWord(runOut.date)} (estimate), before ${endWord(e)}.`
    : `At this rate the project budget (${usd(total)}) lasts past ${endWord(e)} (estimate: runs out around ${dayWord(runOut.date)}).`;
}

/** "Stage 5 Build has spent $61.70 against its plan of $6.86 (9×). At this rate …". */
export function stageWarnText(stage: StageId, title: string, actual: number, planned: number, total: number | undefined, runOut: RunOut | undefined, e: PaceEnd): string {
  return `Stage ${stage} ${title} has spent ${usdCents(actual)} against its plan of ${usdCents(planned)} (${ratioWord(actual / planned)}). ${runOutSentence(total, runOut, e)}`;
}

export function paceText(total: number, runOut: RunOut, e: PaceEnd): string {
  return `At the last ${runOut.days} day${runOut.days === 1 ? '' : 's'}' pace (${usdCents(runOut.perDay)} a day) the project budget (${usd(total)}) runs out around ${dayWord(runOut.date)} (estimate), before ${endWord(e)}.`;
}

export interface StageCheck {
  records: StageWarnRecord[];
  raised: StageWarnRecord[];
}

/**
 * The stage warnings after spend: a stage past a new multiple of its plan line raises one (a new level
 * clears its dismissal); a stage that fell back (its plan line was raised) steps down, so crossing again
 * is news. Spend with no stage ("—") and stages without a plan line never warn: there's nothing to compare.
 * Without the toolkit's pipeline (current "—") nothing is raised.
 */
export function checkStageWarnings(variance: readonly StageVariance[], records: readonly StageWarnRecord[], current: StageId, now: number): StageCheck {
  if (current === '—') return { records: [...records], raised: [] };
  const out = new Map(records.map((r) => [r.stage, r]));
  const raised: StageWarnRecord[] = [];
  for (const v of variance) {
    if (v.stage === '—' || !(v.planned > 0)) continue;
    const m = crossedMultiple(v.actual, v.planned);
    const was = out.get(v.stage);
    if (m > (was?.multiple ?? 0)) {
      const rec: StageWarnRecord = { stage: v.stage, multiple: m, at: now, planned: r2(v.planned), actual: r2(v.actual) };
      out.set(v.stage, rec);
      raised.push(rec);
    } else if (was && m < was.multiple) {
      if (m === 0) out.delete(v.stage);
      else out.set(v.stage, { ...was, multiple: m });
    }
  }
  return { records: [...out.values()], raised };
}

/** Dismisses a stage's warning at its current level; the records after, or why not. */
export function dismissStage(records: readonly StageWarnRecord[], stage: unknown, by: string, now: number): StageWarnRecord[] | string {
  const r = records.find((x) => x.stage === stage);
  if (!r) return 'There’s no warning standing for that stage';
  if (r.dismissedAt) return [...records];
  return records.map((x) => (x === r ? { ...x, dismissedAt: now, dismissedBy: by } : x));
}

export interface PaceInput {
  runOut?: RunOut;
  end: PaceEnd;
  today: string;
  now: number;
  record?: PaceRecord;
  /** The budget's own alerts already say it (spend at the alert threshold or past it), or there's no budget. */
  suppressed: boolean;
}

/** Whether the pace warning holds now. */
export const paceActive = (i: Pick<PaceInput, 'runOut' | 'end' | 'suppressed'>) => !i.suppressed && !!i.runOut && i.runOut.date < i.end.end;

/** The pace record after a check: raised once a day at most, while the run-out is before the end. */
export function checkPace(i: PaceInput): { record?: PaceRecord; raised?: PaceRecord } {
  if (!paceActive(i) || i.record?.day === i.today) return { record: i.record };
  const rec: PaceRecord = { day: i.today, at: i.now, runOut: i.runOut!.date, end: i.end.end };
  return { record: rec, raised: rec };
}
