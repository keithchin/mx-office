// The three budget levels the new-project wizard offers (and the Budget tab's "Change level"), trading
// cost against speed, plus Manual. Each sets the Leads' and subagents' models, the Chief Analyst's
// Discovery model, early drafts, autonomy by stage and how many agents work at once, and has a preset
// budget: the plan's estimate for the project's tier and entry mode at that level's rates. Pure.

import type { LevelId } from './types.js';

export type ModelWord = 'haiku' | 'sonnet' | 'opus';

export interface LevelSettings {
  /** The four Leads' and the Coordinator's model from their next hire. */
  leadModel: ModelWord;
  /** The Chief Analyst's model for the Discovery issue. */
  discoveryModel: ModelWord;
  /** The Leads' subagents, where the role allows it (see SUBAGENT_FLOOR); 'default' leaves each its own. */
  subagentModel: ModelWord | 'default';
  earlyDrafts: boolean;
  /** Autonomy by stage: off, or the levels before and after the build plan passes. */
  autonomyByStage: { enabled: boolean; early: 1 | 2 | 3 | 4; build: 1 | 2 | 3 | 4 };
  /** How many agents and subagents work at once. Recorded with the level and shown; the office doesn't enforce it (yet). */
  parallel: 'fewer' | 'normal' | 'more';
  /** Alert at this % of the budget. */
  threshold: number;
}

export interface LevelDef {
  id: Exclude<LevelId, 'manual'>;
  label: string;
  icon: string;
  tagline: string;
  /** The preset budget as a multiple of the plan's estimate (which is priced at Balanced). */
  costFactor: number;
  /** Expected duration against Balanced. */
  timeFactor: number;
  settings: LevelSettings;
  /** What it changes, in a few words each. */
  changes: string[];
}

/**
 * Subagents that need a stronger model than Haiku whatever the level: the Developer drafts MDL that has
 * to pass `mxcli check`, and the UI/UX Designer writes the design system. The rest may go down to Haiku.
 */
export const SUBAGENT_FLOOR: Record<string, ModelWord> = { developer: 'sonnet', 'ui-ux-designer': 'sonnet', 'business-analyst': 'sonnet' };

export const LEVELS: readonly LevelDef[] = [
  {
    id: 'lean',
    label: 'Lean',
    icon: '🪙',
    tagline: 'Lowest cost',
    costFactor: 0.65,
    timeFactor: 1.3,
    settings: { leadModel: 'sonnet', discoveryModel: 'sonnet', subagentModel: 'haiku', earlyDrafts: false, autonomyByStage: { enabled: true, early: 2, build: 3 }, parallel: 'fewer', threshold: 80 },
    changes: ['Leads on Sonnet, Discovery on Sonnet', 'Subagents on Haiku where the role allows', 'Early drafts off', 'Autonomy by stage on (higher in build)', 'Fewer agents at once'],
  },
  {
    id: 'balanced',
    label: 'Balanced',
    icon: '⚖️',
    tagline: 'The default',
    costFactor: 1,
    timeFactor: 1,
    settings: { leadModel: 'sonnet', discoveryModel: 'opus', subagentModel: 'sonnet', earlyDrafts: true, autonomyByStage: { enabled: false, early: 2, build: 3 }, parallel: 'normal', threshold: 80 },
    changes: ['Leads on Sonnet, the Chief Analyst on Opus for Discovery', 'Subagents on Sonnet', 'Early drafts on', 'Autonomy as set on the team', 'Usual number of agents'],
  },
  {
    id: 'fast',
    label: 'Fast',
    icon: '🚀',
    tagline: 'Speed first',
    costFactor: 1.6,
    timeFactor: 0.7,
    settings: { leadModel: 'opus', discoveryModel: 'opus', subagentModel: 'sonnet', earlyDrafts: true, autonomyByStage: { enabled: true, early: 3, build: 4 }, parallel: 'more', threshold: 80 },
    changes: ['Leads on Opus', 'More subagents and agents in parallel', 'Early drafts on', 'Autonomy by stage on (Delegated, then Autonomous)', 'Opus rates plus a 15 % margin'],
  },
];

export const LEVEL_BY_ID = new Map(LEVELS.map((l) => [l.id, l]));

/** A budget figure people would type: to the nearest $10 under $1,000, the nearest $50 above. */
export const roundBudget = (usd: number) => (usd < 1000 ? Math.max(10, Math.round(usd / 10) * 10) : Math.round(usd / 50) * 50);

export interface LevelCard {
  id: LevelDef['id'];
  label: string;
  icon: string;
  tagline: string;
  /** The preset total budget, USD. */
  budget: number;
  /** "~1.0×", "~0.7× time". */
  time: string;
  /** Expected working days. */
  days: number;
  changes: string[];
  settings: LevelSettings;
}

/** The three cards for a project whose plan estimate (at Balanced) is `estimate` over `days` working days. */
export function levelCards(estimate: number, days: number): LevelCard[] {
  return LEVELS.map((l) => ({
    id: l.id,
    label: l.label,
    icon: l.icon,
    tagline: l.tagline,
    budget: roundBudget(estimate * l.costFactor),
    time: `~${l.timeFactor.toFixed(1)}× time`,
    days: Math.max(1, Math.round(days * l.timeFactor)),
    changes: l.changes,
    settings: l.settings,
  }));
}

/** The model a subagent runs on at a level: the level's, but never below what its role needs. */
export function subagentModelAt(level: LevelSettings, subagent: string, own: ModelWord): ModelWord {
  if (level.subagentModel === 'default') return own;
  const rank: Record<ModelWord, number> = { haiku: 0, sonnet: 1, opus: 2 };
  const floor = SUBAGENT_FLOOR[subagent];
  return floor && rank[level.subagentModel] < rank[floor] ? floor : level.subagentModel;
}

/** What the wizard sends with the plan: the level picked (or manual), the budget and the settings. */
export interface BudgetChoice {
  level: LevelId;
  total: number;
  threshold: number;
  autoPause: boolean;
  settings: LevelSettings;
}

const MODELS: readonly ModelWord[] = ['haiku', 'sonnet', 'opus'];
const isModel = (v: unknown): v is ModelWord => MODELS.includes(v as ModelWord);
const lvl = (v: unknown, d: 1 | 2 | 3 | 4) => (v === 1 || v === 2 || v === 3 || v === 4 ? v : d);

/** A choice from a request or a saved plan; undefined when it isn't one. */
export function cleanChoice(raw: unknown): BudgetChoice | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Record<string, unknown>;
  const level: LevelId = r.level === 'lean' || r.level === 'balanced' || r.level === 'fast' || r.level === 'manual' ? r.level : 'balanced';
  const total = Number(r.total);
  if (!(total > 0 && total < 10_000_000)) return undefined;
  const base = LEVEL_BY_ID.get(level === 'manual' ? 'balanced' : level)!.settings;
  const s = (r.settings && typeof r.settings === 'object' ? r.settings : {}) as Record<string, unknown>;
  const abs = (s.autonomyByStage && typeof s.autonomyByStage === 'object' ? s.autonomyByStage : {}) as Record<string, unknown>;
  const threshold = Number(r.threshold);
  return {
    level,
    total: Math.round(total * 100) / 100,
    threshold: threshold >= 1 && threshold <= 99 ? Math.round(threshold) : base.threshold,
    autoPause: r.autoPause !== false,
    settings: {
      leadModel: isModel(s.leadModel) ? s.leadModel : base.leadModel,
      discoveryModel: isModel(s.discoveryModel) ? s.discoveryModel : base.discoveryModel,
      subagentModel: isModel(s.subagentModel) || s.subagentModel === 'default' ? (s.subagentModel as LevelSettings['subagentModel']) : base.subagentModel,
      earlyDrafts: typeof s.earlyDrafts === 'boolean' ? s.earlyDrafts : base.earlyDrafts,
      autonomyByStage: { enabled: typeof abs.enabled === 'boolean' ? abs.enabled : base.autonomyByStage.enabled, early: lvl(abs.early, base.autonomyByStage.early), build: lvl(abs.build, base.autonomyByStage.build) },
      parallel: s.parallel === 'fewer' || s.parallel === 'normal' || s.parallel === 'more' ? s.parallel : base.parallel,
      threshold: threshold >= 1 && threshold <= 99 ? Math.round(threshold) : base.threshold,
    },
  };
}
