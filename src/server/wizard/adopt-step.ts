// Start from another app at setup (ProjectPlan.adopt, server/adopt-from/), each choice by the mechanism that owns it:
//   - toolkit: before init, the project starts on the source's pinned commit (job.toolkit, the same pin the init
//     step makes for every new project, only not the newest one); a pin that can't be made falls back to the newest;
//   - design system: plan.design was set to the source's exact version at start, so the design step (design-step.ts)
//     binds it after the app step; here it's only checked and recorded;
//   - company brain: the client's own step wires it during init (portfolio-step.ts); here it's checked and recorded;
//   - role skills: before the team step, the source's per-role skill changes are set on the new project's roster
//     (as the Team tab's 🧰 Skills would), so each Playbook is written with them at hire.
// What was adopted, and whether it's there, is recorded for Project Settings (adopt-from/store.ts): "available to
// agents", never "applied". A plan without `adopt` runs exactly as before.

import type { AdoptItem } from '../../shared/adopt-from.js';
import type { StepId, ProjectPlan } from '../../shared/wizard.js';
import type { RoleId } from '../../shared/roster/roles.js';
import type { SkillOverrides } from '../../shared/roster/skills.js';
import type { StepImpl } from './job.js';

export interface AdoptSetup {
  /** The toolkit pin of `sha` (toolkit-pin/pins.ts ensurePin). */
  pin(sha: string): Promise<{ sha: string; dir: string; date?: string }>;
  /** Sets the per-role skill changes on the project's roster; how many were set. */
  copySkills(floor: string, map: Partial<Record<RoleId, SkillOverrides>>): number;
  /** The project's design-system binding now. */
  bound(floor: string): { systemId: string; n: number } | undefined;
  /** A ✋ proposal waiting on the project (an existing app, or an app with its own styling). */
  proposed(floor: string): { systemId: string; n: number } | undefined;
  /** The office's wiring check of the project (undefined: not checked, or no brain). */
  wired(floor: string): Promise<boolean | undefined>;
  note(floor: string, plan: ProjectPlan, by: string, items: AdoptItem[]): Promise<void>;
}

const short = (sha: string) => sha.slice(0, 7);
/** Two spellings of one commit (a short sha is a prefix of the full one). */
const sameSha = (a: string, b: string) => {
  const [x, y] = [a.toLowerCase(), b.toLowerCase()].sort((m, n) => m.length - n.length);
  return x.length >= 7 && y.startsWith(x);
};

export function withAdopt(setup: AdoptSetup | undefined, steps: Record<StepId, StepImpl>): Record<StepId, StepImpl> {
  if (!setup) return steps;
  const { init, team } = steps;
  return {
    ...steps,
    async init(job, io) {
      const r = job.plan.adopt?.resolved;
      const from = r?.sourceName ?? '';
      if (r?.toolkit && job.plan.adopt?.toolkit && !job.toolkit && job.plan.kind === 'new') {
        try {
          job.toolkit = await setup.pin(r.toolkit.sha);
          io.log(`  toolkit: the same pin as ${from} (${short(r.toolkit.sha)})`);
        } catch (err) {
          io.log(`  ⚠️ couldn't make ${from}'s toolkit pin ${short(r.toolkit.sha)} (${(err as Error).message}): the newest toolkit instead`);
        }
      }
      const out = await init(job, io);
      if (!r || !job.floor) return out;
      const items: AdoptItem[] = [];
      if (r.design) {
        const b = setup.bound(job.floor);
        const p = setup.proposed(job.floor);
        const same = (x?: { systemId: string; n: number }) => x?.systemId === r.design!.systemId && x.n === r.design!.n;
        const what = `${r.design.name} v${r.design.n} (from ${from})`;
        if (same(b)) items.push({ kind: 'design', status: 'available', text: `${what}: bound at setup; its guidance is available to agents` });
        else if (same(p)) items.push({ kind: 'design', status: 'failed', text: `${what}: waiting for the Project Manager on the ✋ card (nothing applied yet)` });
        else items.push({ kind: 'design', status: 'failed', text: `${what}: not bound (see the setup's app step)` });
      }
      if (r.toolkit && job.plan.adopt?.toolkit) {
        const same = !!job.toolkit && sameSha(job.toolkit.sha, r.toolkit.sha);
        items.push(same ? { kind: 'toolkit', status: 'available', text: `Toolkit pinned at ${short(r.toolkit.sha)}, the same as ${from}` } : { kind: 'toolkit', status: 'failed', text: `Toolkit not on ${from}'s pin ${short(r.toolkit.sha)}${job.toolkit ? ` (on ${short(job.toolkit.sha)})` : ''}` });
      }
      if (r.brain) {
        const ok = await setup.wired(job.floor).catch(() => undefined);
        items.push(ok === false ? { kind: 'brain', status: 'failed', text: `${r.brain.client} company brain: wiring incomplete (see Needs you)` } : { kind: 'brain', status: 'available', text: `${r.brain.client} company brain connected: its pointer is available to agents (the client’s own wiring${ok ? ', checked' : ''})` });
      }
      await setup.note(job.floor, job.plan, job.by, items).catch((err: Error) => io.log(`  ⚠️ couldn't record what was adopted: ${err.message}`));
      return out;
    },
    async team(job, io) {
      const r = job.plan.adopt?.resolved;
      // Before the team's hires (and only on the setup's first run of it, not after an edit), so each Playbook is written with them.
      if (r?.roleSkills && job.plan.adopt?.roleSkills && job.floor && !job.addRoles) {
        const n = setup.copySkills(job.floor, r.roleSkills);
        io.log(`  role skills: ${n} change${n === 1 ? '' : 's'} from ${r.sourceName}`);
        const roles = Object.keys(r.roleSkills).length;
        await setup.note(job.floor, job.plan, job.by, [{ kind: 'role-skills', status: 'available', text: `Role skill selections from ${r.sourceName}: ${n} change${n === 1 ? '' : 's'} across ${roles} role${roles === 1 ? '' : 's'}, in each Playbook` }]).catch((err: Error) => io.log(`  ⚠️ couldn't record what was adopted: ${err.message}`));
      }
      return team(job, io);
    },
  };
}
