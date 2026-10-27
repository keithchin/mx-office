// What only the Project Manager can clear, raised by the office itself as a Needs-you escalation, so a check
// that can't run never ends as an agent going quietly idle (the real rebuild test: a smoke run that couldn't
// sign in left the lead idle with nothing raised; microflow tests blocked by the machine's mxcli were said only
// on the Testing page). It is filed as the agent's own escalation (the one who asked, else the project's first
// agent), so the PM's answer goes back to it as a prompt; the same title joins the open one instead of raising
// it twice (roster/escalations.ts raiseOrJoin). Nothing here calls a model.

import type { Floor } from '../floor.js';
import type { Ctx } from '../office/context.js';
import { readEscalationAsk } from '../../shared/roster/escalation.js';
import { rosterOf, teamFloor } from '../roster/adapter.js';

export interface PmAsk {
  title: string;
  details: string;
  recommendation?: string;
}

/** Raises (or joins) the ask for the PM, as `workerId`'s (else the project's first agent's); its id, or undefined when there's no agent to file it under. */
export function raiseForPm(ctx: Ctx, floor: Floor, workerId: string | undefined, ask: PmAsk): string | undefined {
  try {
    const w = (workerId ? floor.workers.get(workerId) : undefined) ?? floor.workers.list().find((x) => x.kind === 'agent');
    if (!w) return undefined;
    const parsed = readEscalationAsk({ urgency: 'important', trigger: 'blocked', title: ask.title, details: `${ask.details}\n\n(Raised by the office for ${w.name}: an office check couldn't run.)`, ...(ask.recommendation ? { recommendation: ask.recommendation } : {}) });
    if (typeof parsed === 'string') return undefined;
    return rosterOf(ctx).escalations.raiseOrJoin(teamFloor(ctx, floor), w, parsed).escalation.id;
  } catch {
    return undefined;
  }
}
