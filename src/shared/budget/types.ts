// What the Budget tab, the top bar's budget chips and the home page's all-projects view are sent
// (GET /api/budget?floor=, GET /api/budget/office; see server/budget/). Pure types and no Node imports,
// so the browser and the server agree on them.

/** A toolkit stage (P, 0-7), or "—" for spend outside any pipeline (or before the stage was known). */
export type StageId = 'P' | '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '—';
export const STAGE_IDS: readonly StageId[] = ['P', '0', '1', '2', '3', '4', '5', '6', '7', '—'];

export const STAGE_TITLE: Record<StageId, string> = {
  P: 'Kickoff',
  '0': 'Triage & scope',
  '1': 'Analysis',
  '2': 'Requirements',
  '3': 'Architecture & design',
  '4': 'Build plan',
  '5': 'Build',
  '6': 'Test',
  '7': 'Cutover',
  '—': 'No stage',
};

/** Who an agent in the ledger is: a worker at a desk, a subagent inside a Lead's session, or one of the office's own background calls. */
export type AgentKind = 'worker' | 'subagent' | 'background';

export interface AgentInfo {
  /** The ledger's key: the worker id, `<worker id>/<subagent type>`, or `bg:<source>`. */
  key: string;
  name: string;
  /** The role's title (Lead Developer), "Worker" for one outside the team, the subagent type, or the background source. */
  role: string;
  kind: AgentKind;
  /** A subagent's Lead (its worker key). */
  lead?: string;
  provider?: string;
}

/** One line of the detailed ledger: a day × agent × model × stage × piece of work. */
export interface SpendRow {
  day: string;
  agent: string;
  model: string;
  stage: StageId;
  issue?: number;
  pr?: number;
  cost: number;
  calls: number;
  /** Estimated from history (back-filled when the ledger started), not booked as it happened. */
  est?: boolean;
  /** A provider the office can't price (Codex, OpenCode, Jev…): calls are counted, cost is not. */
  unmetered?: boolean;
}

/** A day of the ledger, kept forever: the total and its splits. */
export interface DayRollup {
  cost: number;
  calls: number;
  /** Of `cost`, what was estimated from history. */
  est: number;
  /** Calls the office couldn't price. */
  unmetered: number;
  stage: Record<string, number>;
  role: Record<string, number>;
  model: Record<string, number>;
  agent: Record<string, number>;
  /** By piece of work: "#12" for an issue, "PR #3" for a pull request with no issue. */
  work: Record<string, number>;
}

/** One row of a breakdown table: what it is, what it cost, and its share of the whole. */
export interface BreakdownRow {
  key: string;
  label: string;
  cost: number;
  share: number;
  /** Of `cost`, estimated from history. */
  est?: number;
  /** A small line under the label (a subagent's "hired by Dylan"). */
  hint?: string;
  /** A Lead's subagents, nested under it. */
  sub?: BreakdownRow[];
}

/** The exchange rate for showing dollars in a local currency too. */
export interface FxView {
  /** ISO 4217, like SGD. */
  currency: string;
  /** Units of `currency` per US dollar. */
  rate: number;
  /** The day the rate is from (YYYY-MM-DD). */
  asOf?: string;
  /** Typed in the settings, fetched from the ECB's reference rates (frankfurter.app), or none yet. */
  source: 'manual' | 'ecb' | 'none';
  /** The last fetch failed: the last good rate is kept. */
  error?: string;
}

export interface FxSettings {
  currency: string;
  mode: 'manual' | 'daily';
  /** The rate typed in (manual mode). */
  manualRate?: number;
}

/** Green within budget, amber within 10 % of it, red over; none with no budget. */
export type BudgetTone = 'good' | 'warn' | 'bad' | 'none';

/** A project's budget settings (Budget tab → Settings; the wizard's Budget step). */
export interface BudgetSettings {
  /** The total for the project, USD; none = no budget, just the spend. */
  total?: number;
  /** Alert at this % of the budget (default: the office's, 80). */
  threshold?: number;
  /** Pause the project at 100 % (on by default). */
  autoPause: boolean;
  /** The budget level the project runs at (shared/budget/levels.ts). */
  level?: LevelId;
  updatedBy?: string;
  updatedAt?: number;
}

export type LevelId = 'lean' | 'balanced' | 'fast' | 'manual';

/** One line of the expected plan: a stage, or a build module. */
export interface PlanLine {
  id: string;
  stage: StageId;
  label: string;
  /** Expected cost, USD. */
  usd: number;
  /** Expected working days. */
  days: number;
  /** Where its number came from: the office's default rates, this office's history, a Firm audit, or a person. */
  basis: 'default' | 'history' | 'firm' | 'edited';
  editedBy?: string;
  editedAt?: number;
}

export interface BudgetPlan {
  lines: PlanLine[];
  /** Expected start (the ledger's first day, or the plan's making) and end, YYYY-MM-DD. */
  start: string;
  end: string;
  /** How it was made, in a sentence ("small requirements-driven project, default rates for 4 of 7 lines"). */
  basis: string;
  generatedAt: number;
  /** Edited by a person since it was generated. */
  edited?: boolean;
}

/** One point of the variance chart's curves. */
export interface CurvePoint {
  day: string;
  expected?: number;
  actual?: number;
}

export interface StageVariance {
  stage: StageId;
  label: string;
  planned: number;
  actual: number;
  diff: number;
  done: boolean;
}

export interface Forecast {
  /** Forecast at completion, USD. */
  atCompletion: number;
  /** actual ÷ planned for the completed work (1 with none completed yet), after the floor and cap. */
  factor: number;
  remainingPlan: number;
  /** Over the budget by this much, when it is. */
  over?: number;
}

export type AlertLevel = 'threshold' | 'full' | 'forecast';

export interface BudgetAlert {
  level: AlertLevel;
  at: number;
  text: string;
  /** The budget it was raised against: raising the budget clears it. */
  budget: number;
}

/** A cost driver or a suggestion (step 3's insights). */
export interface Insight {
  id: string;
  kind: 'driver' | 'suggestion';
  text: string;
  /** What it saves, roughly, per week (suggestions). */
  saves?: number;
  /** Where its button takes you. */
  action?: { label: string; to: 'settings' | 'org' | 'workers' | 'budget' | 'analysis' };
}

export interface FirmForecast {
  report: string;
  generatedAt: number;
  /** The audit's cost re-forecast at completion, USD, when it gave one. */
  usd?: number;
  /** Its last milestone's forecast date. */
  end?: string;
}

export interface BudgetView {
  floor: string;
  name: string;
  /** What the project has spent, USD (estimated history included). */
  spent: number;
  today: number;
  /** Of `spent`, estimated from history. */
  estimated: number;
  daysActive: number;
  firstDay?: string;
  /** Calls the office couldn't price, and which agents made them. */
  unmetered: { calls: number; agents: string[] };
  byStage: BreakdownRow[];
  byRole: BreakdownRow[];
  byAgent: BreakdownRow[];
  byModel: BreakdownRow[];
  byDay: { day: string; cost: number; est: number }[];
  topWork: BreakdownRow[];
  stage: StageId;
  settings: BudgetSettings;
  /** The office default alert threshold, %. */
  officeThreshold: number;
  tone: BudgetTone;
  fx: FxView;
  plan?: BudgetPlan;
  curve?: CurvePoint[];
  variance?: StageVariance[];
  forecast?: Forecast;
  alerts?: BudgetAlert[];
  /** Paused by the budget (auto-pause at 100 %). */
  paused?: string;
  firm?: FirmForecast;
  insights?: Insight[];
  admin: boolean;
}

export interface OfficeFloorBudget {
  id: string;
  name: string;
  spent: number;
  today: number;
  budget?: number;
  forecast?: number;
  tone: BudgetTone;
  paused?: boolean;
  /** The last 14 days' spend, oldest first. */
  spark: number[];
}

export interface OfficeBudgetView {
  today: number;
  total: number;
  /** The office's own daily budget (--budget), when set. */
  dailyBudget?: number;
  floors: OfficeFloorBudget[];
  /** The office's own model calls (Jeff, the analyzer, task naming, the summary), every floor's and none's. */
  background: { today: number; total: number; bySource: BreakdownRow[] };
  firm: { total: number; audits: number };
  fx: FxView;
  fxSettings: FxSettings;
  officeThreshold: number;
  admin: boolean;
}
