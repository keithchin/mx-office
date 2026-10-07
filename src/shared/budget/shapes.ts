// What a team shape (shared/roster/coverage.ts) does to the budget plan: a share of each stage's
// Enterprise cost, who does the stage, and how much longer one or two agents take than five. Pure, so
// the plan (plan.ts), the wizard's shape cards and the tests agree.
//
// Why these shares. The default rates (plan.ts) are priced from Enterprise teams: five sessions, each
// priming on its Playbook and the project before it does anything, a Coordinator relaying and
// summarising, standups that wake four Leads, and handoffs between Leads at every stage boundary. The
// office's own numbers show what that costs against one agent doing the work: single-agent focused runs
// (the analysis store's Run 3 set) cost $0.31–2.66 each, while mx-spike's full team came to about $350.
// A small greenfield app is some 40–60 such runs of work (a scope, one module built and tested), so one
// agent doing it is roughly $60–100 at Lean, which is what Solo · Lean comes to below (about $65) for a
// small greenfield project. The analysis and design stages (1–4) shed the most (no handoffs, no
// Coordinator, one context instead of three); the build sheds less (the MDL still has to be written and
// checked, and the writer is the same either way); testing in between (the tester subagent remains).
// Startup keeps two sessions and one handoff (analyst to developer at Stage 4), so it sits between.
// The experiment in the team-scaling plan (Solo · Lean, Startup · Balanced, Enterprise · Lean on one
// small spec) is how these get tuned.

import type { TeamShape } from '../roster/coverage.js';
import type { StageId } from './types.js';

type Stage = Exclude<StageId, '—'>;

export interface ShapeRates {
  /** Each stage's cost as a share of the Enterprise default; the assurance line uses '—'. */
  share: Record<Stage | '—', number>;
  /** Working days against Enterprise's: fewer agents work less in parallel. */
  timeFactor: number;
  /** Who does each stage, for the plan's lines ("Solo Lead"); undefined for Enterprise, whose lines are as before. */
  by?: Record<Stage | '—', string>;
}

const all = (n: number): Record<Stage | '—', number> => ({ P: n, '0': n, '1': n, '2': n, '3': n, '4': n, '5': n, '6': n, '7': n, '—': n });

export const SHAPE_RATES: Readonly<Record<TeamShape, ShapeRates>> = {
  enterprise: { share: all(1), timeFactor: 1 },
  startup: {
    share: { P: 0.8, '0': 0.8, '1': 0.8, '2': 0.8, '3': 0.8, '4': 0.8, '5': 0.85, '6': 0.7, '7': 0.85, '—': 0.8 },
    timeFactor: 1.15,
    by: { P: 'Chief Analyst', '0': 'Chief Analyst', '1': 'Chief Analyst', '2': 'Chief Analyst', '3': 'Chief Analyst (design subagent)', '4': 'Chief Analyst → Lead Developer', '5': 'Lead Developer', '6': 'Lead Developer (tester subagent)', '7': 'Lead Developer', '—': 'Chief Analyst' },
  },
  solo: {
    share: { P: 0.7, '0': 0.7, '1': 0.5, '2': 0.5, '3': 0.5, '4': 0.5, '5': 0.6, '6': 0.5, '7': 0.7, '—': 0.7 },
    timeFactor: 1.4,
    by: { P: 'Solo Lead', '0': 'Solo Lead', '1': 'Solo Lead', '2': 'Solo Lead', '3': 'Solo Lead', '4': 'Solo Lead', '5': 'Solo Lead', '6': 'Solo Lead', '7': 'Solo Lead', '—': 'Solo Lead' },
  },
};

/** A stage's cost share for a shape (Enterprise, or no shape: 1). */
export const shapeShare = (shape: TeamShape | undefined, stage: StageId): number => SHAPE_RATES[shape ?? 'enterprise'].share[stage];
