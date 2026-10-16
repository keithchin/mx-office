// "Ask the lead to fix the paperwork" (shared/decisions/stage-flags.ts's card): what doesn't add up between
// PROJECT.md and the office's own gate-check on main, told to whoever covers Management through the team's
// durable tell (roster/interrupts.ts: the words in the answer store, the intent on disk before typing, after
// the lead's current turn), with the gates' own words and what to do. The office never edits the project,
// runs gate-check in it or commits: the lead fixes the files, re-runs gate-check and commits.

import type { Floor } from '../floor.js';
import type { Ctx } from '../office/context.js';
import type { SetupView } from '../../shared/wizard.js';
import { checkedWhere, stageFixMessage } from '../../shared/decisions/stage-flags.js';
import { audit, byWhom } from '../audit/index.js';
import { managerRole } from '../roster/coverage.js';
import { rosterOf, teamFloor } from '../roster/adapter.js';

export interface StageFixDeps {
  setup(floor: Floor): Promise<SetupView | undefined>;
  /** Whoever covers Management, when at work. */
  lead(floor: Floor): string | undefined;
  /** The team's durable tell to the lead, after their turn: an error, or undefined when it went (or was held). */
  tell(floor: Floor, text: string, by: string, owner: string | undefined, decision: string): Promise<string | undefined>;
}

export type StageFixResult = { ok: true; message: string; lead: string } | { ok: false; status: 409; error: string };

/** Tells the lead what the office's check found, when it still finds it. */
export async function askStageFix(deps: StageFixDeps, floor: Floor, by: string, owner: string | undefined): Promise<StageFixResult> {
  const e = (await deps.setup(floor))?.stage;
  if (!e?.flags.length) return { ok: false, status: 409, error: "The office's latest gate-check on main agrees with PROJECT.md now: nothing to ask" };
  const lead = deps.lead(floor);
  if (!lead) return { ok: false, status: 409, error: "This project's team lead isn't at work to fix it: hire or wake them first" };
  const message = stageFixMessage(e.flags, checkedWhere(e.check));
  const err = await deps.tell(floor, message, by, owner, `tell:stage-fix-${(e.check.sha ?? 'main').slice(0, 12)}`);
  if (err) return { ok: false, status: 409, error: err };
  audit.record({ floor: floor.id, actor: byWhom(by, owner), action: 'stage.fix-asked', target: { kind: 'stage', id: e.stage?.id ?? '?', label: 'gate-check paperwork' }, summary: `Asked ${lead} to fix the paperwork gate-check reports on ${checkedWhere(e.check)}`, details: { flags: e.flags.map((f) => f.kind), sha: e.check.sha }, severity: 'info' });
  return { ok: true, message, lead };
}

/** The office's wiring: the wizard's setup view, the roster's lead and tell. */
export function stageFixDeps(ctx: Ctx, setup: (floor: Floor) => Promise<SetupView | undefined>): StageFixDeps {
  return {
    setup,
    lead(floor) {
      const d = rosterOf(ctx).data(floor.id);
      const m = d.members[managerRole(d)];
      return m && m.phase === 'active' ? m.name : undefined;
    },
    tell: (floor, text, by, owner, decision) => rosterOf(ctx).interrupts.tell(teamFloor(ctx, floor), text, by, 'after', {}, owner, decision),
  };
}
