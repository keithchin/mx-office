// The new-project wizard's three shape cards (Solo, Startup, Enterprise), each with its budget per level
// (Lean, Balanced, Fast) and the working days it expects: the plan priced for that shape (plan.ts with
// shapes.ts's shares) times each level's factor (levels.ts). Pure, so GET /api/budget/estimate, the
// wizard and the tests show the same numbers.

import type { EntryMode, SizeTier } from '../wizard.js';
import { SHAPES, TEAM_SHAPES, type TeamShape } from '../roster/coverage.js';
import { levelCards, type LevelCard } from './levels.js';
import { generatePlan, planTotal, type HistoryRun } from './plan.js';

export interface ShapeCard {
  shape: TeamShape;
  label: string;
  icon: string;
  tagline: string;
  who: string;
  /** The plan's total at Balanced for this shape, USD, and its working days. */
  estimate: number;
  days: number;
  /** The Lean, Balanced and Fast cards at this shape's estimate. */
  levels: LevelCard[];
}

/** The three shape cards for a project of this tier and entry mode. */
export function shapeCards(tier: SizeTier, entry: EntryMode, history?: readonly HistoryRun[], start = '2026-01-05', now = 0): ShapeCard[] {
  return TEAM_SHAPES.map((shape) => {
    const plan = generatePlan({ tier, entry, history, shape, start, now });
    const estimate = planTotal(plan);
    const days = plan.lines.reduce((n, l) => n + l.days, 0);
    const s = SHAPES[shape];
    return { shape, label: s.label, icon: s.icon, tagline: s.tagline, who: s.who, estimate, days, levels: levelCards(estimate, days) };
  });
}
