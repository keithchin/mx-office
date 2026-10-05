// POST /office/workers/escalate: an agent raising something to the Project Manager (the human), from
// `office-workers escalate` or the agent-office MCP server's `escalate` tool (bin/office-workers.js).
// The worker's own hook token says who's asking (checked by officeWorkers before it hands over); the
// escalation itself is read and judged against the floor's autonomy level by the roster
// (roster/escalations.ts), which never refuses one for being below the threshold: it files it as FYI.

import type http from 'node:http';
import { readEscalationAsk } from '../../shared/roster/escalation.js';
import type { WorkerInfo } from '../../shared/protocol.js';
import type { Floor } from '../floor.js';
import { send } from '../http/util.js';
import type { Ctx } from '../office/context.js';
import { rosterOf, teamFloor } from '../roster/adapter.js';

export function officeEscalate(ctx: Ctx, floor: Floor, me: WorkerInfo, body: unknown, res: http.ServerResponse) {
  const ask = readEscalationAsk(body);
  if (typeof ask === 'string') return send(res, 400, { error: ask });
  const e = rosterOf(ctx).escalations.raise(teamFloor(ctx, floor), me, ask);
  return send(res, 200, {
    ok: true,
    escalation: { id: e.id, urgency: e.urgency, fyi: e.fyi, level: e.level, title: e.title },
    note: e.fyi
      ? `Filed as FYI: below this floor's escalation threshold at autonomy level ${e.level}. The Project Manager sees it on the project console without an alert; carry on.`
      : `Raised to the Project Manager on the project console${e.urgency === 'urgent' || e.urgency === 'critical' ? ' with an alert' : ''}. Their answer comes back to you as a prompt; carry on with whatever it doesn't block.`,
  });
}
