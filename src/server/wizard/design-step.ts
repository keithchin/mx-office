// A plan's design system (ProjectPlan.design, server/design/) at setup: once the app step has the app there,
//   - a NEW project that chose "Use this version" gets the package applied in place (mxcli theme create +
//     apply, checked), so the setup's own commit takes it; an app whose styling turns out to be its own gets a
//     ✋ card instead, and a failed apply is said in the step's line and becomes the card too: the design
//     system never blocks the project being created;
//   - an EXISTING app (Change an existing app) is never applied here: it gets the ✋ card "Adopt … in <project>?".
// A plan without a design choice, or with Keep the app's design, runs the app step exactly as before.

import type { PlanDesign, StepId } from '../../shared/wizard.js';
import { isDesignId } from '../../shared/design/types.js';
import type { StepImpl } from './job.js';

export interface DesignSetup {
  setupNew(floor: string, dir: string, systemId: string, n: number, by: string, log?: (l: string) => void): Promise<{ ok: boolean; detail: string }>;
  propose(floor: string, systemId: string, n: number, by: string): Promise<string | undefined>;
}

/** The plan's design choice, made safe (an exact version, or Keep). */
export function cleanPlanDesign(v: unknown): PlanDesign | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const r = v as Record<string, unknown>;
  if (r.choice === 'keep') return { choice: 'keep' };
  if (r.choice === 'use' && isDesignId(r.systemId) && typeof r.n === 'number' && Number.isInteger(r.n) && r.n > 0) return { choice: 'use', systemId: r.systemId, n: r.n };
  return undefined;
}

export function withDesign(design: DesignSetup | undefined, steps: Record<StepId, StepImpl>): Record<StepId, StepImpl> {
  const app = steps.app;
  return {
    ...steps,
    async app(job, io) {
      const r = await app(job, io);
      const d = job.plan.design;
      if (!design || d?.choice !== 'use' || !d.systemId || !d.n || !job.floor || !job.dir) return r;
      const add = (said: string) => ({ ...r, detail: [r.detail, said].filter(Boolean).join(' · ') });
      if (job.plan.kind === 'change') {
        const err = await design.propose(job.floor, d.systemId, d.n, job.by);
        return add(err ? `design system not proposed: ${err}` : 'design system: waiting for your decision on the ✋ card (the existing app is not changed until you adopt it)');
      }
      io.log('  applying the design system (mxcli theme create + apply, then checked)…');
      const out = await design.setupNew(job.floor, job.dir, d.systemId, d.n, job.by, (l) => io.log(l));
      if (out.ok) return add(`design system: ${out.detail}`);
      io.log(`  ⚠️ the design system wasn't applied: ${out.detail}`);
      const err = await design.propose(job.floor, d.systemId, d.n, job.by);
      return add(`⚠️ design system not applied (${out.detail})${err ? '' : '; adopt it later from the ✋ card'}`);
    },
  };
}
