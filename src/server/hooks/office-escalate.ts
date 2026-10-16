// POST /office/workers/escalate: an agent raising something to the Project Manager (the human), from
// `office-workers escalate` or the agent-office MCP server's `escalate` tool (bin/office-workers.js).
// The worker's own hook token says who's asking (checked by officeWorkers before it hands over); the
// escalation itself is read and judged against the floor's autonomy level by the roster
// (roster/escalations.ts), which never refuses one for being below the threshold: it files it as FYI,
// and joins it to an open one that asks the same (jeff-same.ts) instead of raising it twice.

import type http from 'node:http';
import { readEscalationAsk, type Escalation } from '../../shared/roster/escalation.js';
import type { WorkerInfo } from '../../shared/protocol.js';
import type { Floor } from '../floor.js';
import { send } from '../http/util.js';
import type { Ctx } from '../office/context.js';
import { rosterOf, teamFloor } from '../roster/adapter.js';
import { handAddReturned } from '../roster/handadd-gate.js';
import { answeredNote } from '../roster/escalation-fold.js';

export async function officeEscalate(ctx: Ctx, floor: Floor, me: WorkerInfo, body: unknown, res: http.ServerResponse) {
  const ask = readEscalationAsk(body);
  if (typeof ask === 'string') return send(res, 400, { error: ask });
  // A Studio Pro hand-add with no `Tried:` section goes back to the agent, unraised (shared/roster/handadd.ts).
  const back = handAddReturned(teamFloor(ctx, floor), me, ask);
  if (back) return send(res, 200, { ok: true, returned: true, note: back });
  // The same ask already open (its title, or in other words in Jeff's judgement) is joined as a +1.
  const { escalation: e, joined, answered } = await rosterOf(ctx).escalations.raiseOrJoinJudged(teamFloor(ctx, floor), me, ask);
  // What it names is answered already (roster/escalation-fold.ts): told the answer, nothing raised.
  if (answered) return send(res, 200, { ok: true, answered: true, escalation: { id: e.id, title: e.title }, note: answeredNote(e) });
  return send(res, 200, {
    ok: true,
    escalation: { id: e.id, urgency: e.urgency, fyi: e.fyi, level: e.level, title: e.title, ...(e.fyiCorrected ? { fyiCorrected: true } : {}) },
    ...(joined ? { joined: true } : {}),
    note: escalateNote(e, joined, me.name),
  });
}

/** What the agent is told about the escalation it raised: joined to an open one, filed as FYI, or raised (as a decision when it was corrected from FYI). */
export function escalateNote(e: Escalation, joined: boolean, me: string): string {
  if (e.permission) {
    const what = `Claude Code denied \`${e.permission.command}\``;
    const how = "Approving in the office doesn't change your permission settings: the Project Manager allows exactly that command for you in the project's settings, or keeps it blocked, and the card closes once the office sees the command run. Don't route around the denial; carry on with what doesn't need it.";
    return joined ? `Already open as a permission card (${e.id}): ${what} (asked ${e.permission.count} times). ${how} Don't raise it again.` : `Raised as a permission card: ${what}. ${how}`;
  }
  if (joined) return `Already open: ${e.by === me ? 'you' : e.by} raised the same (${e.id}, "${e.title}"). Your +1 and details are added to it, and the Project Manager's answer comes back to you as a prompt too; don't raise it again.`;
  if (e.fyi) return `Filed as FYI: below this project's escalation threshold at autonomy level ${e.level}. The Project Manager sees it on the project console without an alert; carry on.`;
  const corrected = e.fyiCorrected ? `Filed as a decision, not FYI: ${e.fyiCorrected}. FYI is for information only. ` : '';
  return `${corrected}Raised to the Project Manager on the project console${e.urgency === 'urgent' || e.urgency === 'critical' ? ' with an alert' : ''}. Their answer comes back to you as a prompt; carry on with whatever it doesn't block.`;
}
