// A new project created in a portfolio (ProjectPlan.portfolio): once the init step has scaffolded it and
// written the pin instructions, the project joins its portfolio and, when the portfolio has a company
// brain, is wired to it with the toolkit's wire-company-brain.sh and checked by the office (server/
// portfolios/). Never through `init-project.sh --company`, which wires before CLAUDE.md and AGENTS.md
// exist. A plan without a portfolio runs the init step exactly as before (P01).

import type { StepId } from '../../shared/wizard.js';
import type { StepImpl } from './job.js';
import type { SetupDeps } from './steps.js';

export function withPortfolio(deps: SetupDeps, steps: Record<StepId, StepImpl>): Record<StepId, StepImpl> {
  const init = steps.init;
  return {
    ...steps,
    async init(job, io) {
      const r = await init(job, io);
      if (!job.plan.portfolio || !job.floor || !deps.joinPortfolio) return r;
      io.log('  joining the client (and wiring its company brain, if it has one)…');
      const said = await deps.joinPortfolio(job.floor, job.plan.portfolio, job.by);
      return { ...r, detail: `${r.detail ? `${r.detail} · ` : ''}${said}` };
    },
  };
}
