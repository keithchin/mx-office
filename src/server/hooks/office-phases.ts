// POST /office/workers/phases: the team and the phase plan (`office-workers phases …`, or the agent-office MCP
// server's propose_phases, propose_phase_change and phases_status tools, bin/office-phases.js). op propose: the
// whole set at the Build Plan gate (phases) or a change to the approved phases (ops), always with a reason;
// it waits on the Roadmap for the Project Manager, who accepts, declines or edits it, and the team hears the
// decision as a message. op status: the phases as approved, with their status and rows. The worker's own hook
// token says who's asking (checked by officeWorkers before it hands over). Exit criteria are never taken from
// an agent: the office records them itself.

import type http from 'node:http';
import type { WorkerInfo } from '../../shared/protocol.js';
import type { Floor } from '../floor.js';
import { send } from '../http/util.js';
import type { Ctx } from '../office/context.js';
import { phasesOf } from '../phases/index.js';
import { rosterOf, teamFloor } from '../roster/adapter.js';
import { ROLE_BY_ID } from '../../shared/roster/roles.js';
import type { Who } from '../../shared/phases/types.js';

function whoOf(ctx: Ctx, floor: Floor, me: WorkerInfo): Who {
  let role: string | undefined;
  try {
    const id = rosterOf(ctx).roleOf(teamFloor(ctx, floor), me.id);
    role = id ? ROLE_BY_ID.get(id)?.title : undefined;
  } catch {
    // no team on it
  }
  return { kind: 'agent', name: me.name, ...(role ? { role } : {}) };
}

export function officePhases(ctx: Ctx, floor: Floor, me: WorkerInfo, body: unknown, res: http.ServerResponse) {
  const s = phasesOf(ctx);
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  if (b.op === 'status' || b.op === undefined) {
    const p = s.plan(floor.id);
    return send(res, 200, {
      state: p.state,
      phases: p.phases.map((x, i) => ({ order: i + 1, id: x.id, name: x.name, status: x.status, foundation: x.foundation, rows: x.rows, journeys: x.journeys, estimate: x.estimate, checkpoint: x.checkpoint, publish: x.publish, ...(x.early ? { early: x.early.what } : {}) })),
      open: p.proposals.filter((x) => x.status === 'open').map((x) => ({ id: x.id, kind: x.kind, by: x.by.name, summary: x.summary })),
      recent: p.proposals.filter((x) => x.status !== 'open').slice(-5).map((x) => ({ id: x.id, status: x.status, summary: x.summary, ...(x.note ? { note: x.note } : {}) })),
    });
  }
  if (b.op !== 'propose') return send(res, 400, { error: 'op is propose or status' });
  if (me.kind !== 'agent') return send(res, 400, { error: 'Only an agent proposes this way' });
  const r = s.propose(floor.id, whoOf(ctx, floor, me), b);
  if (!r.ok) return send(res, r.status, { error: r.error });
  const p = r.proposal!;
  return send(res, 200, {
    ok: true,
    proposal: { id: p.id, kind: p.kind, summary: p.summary },
    note: `Proposed (${p.id}): the Project Manager decides on the Roadmap${p.kind === 'plan' ? ' at the Build Plan gate' : ''}, and you hear the decision as a message. Don't propose it again; carry on with the current phase's rows meanwhile.`,
  });
}
