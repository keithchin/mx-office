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

export async function officeEscalate(ctx: Ctx, floor: Floor, me: WorkerInfo, body: unknown, res: http.ServerResponse) {
  const ask = readEscalationAsk(body);
  if (typeof ask === 'string') return send(res, 400, { error: ask });
  // The same ask already open (its title, or in other words in Jeff's judgement) is joined as a +1.
  const { escalation: e, joined } = await rosterOf(ctx).escalations.raiseOrJoinJudged(teamFloor(ctx, floor), me, ask);
  return send(res, 200, {
    ok: true,
    escalation: { id: e.id, urgency: e.urgency, fyi: e.fyi, level: e.level, title: e.title, ...(e.fyiCorrected ? { fyiCorrected: true } : {}) },
    ...(joined ? { joined: true } : {}),
    note: escalateNote(e, joined, me.name),
  });
}

/** What the agent is told about the escalation it raised: joined to an open one, filed as FYI, or raised (as a decision when it was corrected from FYI). */
export function escalateNote(e: Escalation, joined: boolean, me: string): string {
  if (joined) return `Already open: ${e.by === me ? 'you' : e.by} raised the same (${e.id}, "${e.title}"). Your +1 and details are added to it, and the Project Manager's answer comes back to you as a prompt too; don't raise it again.`;
  if (e.fyi) return `Filed as FYI: below this project's escalation threshold at autonomy level ${e.level}. The Project Manager sees it on the project console without an alert; carry on.`;
  const corrected = e.fyiCorrected ? `Filed as a decision, not FYI: ${e.fyiCorrected}. FYI is for information only. ` : '';
  return `${corrected}Raised to the Project Manager on the project console${e.urgency === 'urgent' || e.urgency === 'critical' ? ' with an alert' : ''}. Their answer comes back to you as a prompt; carry on with whatever it doesn't block.`;
}
