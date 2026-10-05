// POST /office/workers/subagent: a Lead managing its subagents, from `office-workers subagent …` or the
// agent-office MCP server's `subagent` tool (bin/office-subagent.js): list them with their track
// record, record a review verdict, and warn / bench / swap the model of / reinstate one. The worker's
// own hook token says who's asking (checked by officeWorkers before it hands over), and only a Lead
// of the floor's team may; the roster enforces the gate its skill has (roster/subagents.ts).

import type http from 'node:http';
import { isSubagentOp } from '../../shared/roster/skills.js';
import type { WorkerInfo } from '../../shared/protocol.js';
import type { Floor } from '../floor.js';
import { send } from '../http/util.js';
import type { Ctx } from '../office/context.js';
import { rosterOf, teamFloor } from '../roster/adapter.js';

const str = (v: unknown, n: number) => (typeof v === 'string' && v.trim() ? v.replace(/\r\n?/g, '\n').trim().slice(0, n) : undefined);

export function officeSubagent(ctx: Ctx, floor: Floor, me: WorkerInfo, body: unknown, res: http.ServerResponse) {
  const b = (body ?? {}) as Record<string, unknown>;
  const roster = rosterOf(ctx);
  const team = teamFloor(ctx, floor);
  const lead = roster.roleOf(team, me.id);
  if (!lead || lead === 'pm') return send(res, 403, { error: "Only a Lead of this floor's team manages subagents (office-workers subagent): you aren't one" });
  const op = String(b.op ?? '');
  if (op === 'list') return send(res, 200, { ok: true, text: roster.subagents.list(team, lead), subagents: roster.subagents.views(team).filter((v) => v.lead === lead) });
  if (op === 'review') {
    if (b.verdict !== 'accept' && b.verdict !== 'rework') return send(res, 400, { error: '--verdict accept or rework' });
    const run = roster.subagents.review(team, lead, b.name, b.verdict, str(b.note, 300));
    if (typeof run === 'string') return send(res, 400, { error: run });
    const v = roster.subagents.views(team).find((x) => x.lead === lead && x.name === b.name);
    const s = v?.score;
    return send(res, 200, { ok: true, text: `Recorded: ${b.verdict} for ${String(b.name)}${run.task ? ` (“${run.task}”)` : ''}.${s ? ` Track record on ${s.model}: ${s.grade ? `grade ${s.grade} (${s.score}%)` : `${s.reviewed} reviewed runs, graded from 3`}${s.underperforming ? ` · underperforming: ${s.why}` : ''}.` : ''}` });
  }
  if (!isSubagentOp(op)) return send(res, 400, { error: 'op is one of list, review, warn, bench, swap-model, reinstate' });
  const answer = roster.subagents.request(team, lead, me, op, b.name, { reason: str(b.reason, 300), model: str(b.model, 64) });
  if (!answer.ok) return send(res, 400, { error: answer.message });
  return send(res, 200, { ok: true, outcome: answer.outcome, text: answer.message, ...(answer.actionId ? { action: answer.actionId } : {}) });
}
