// The Team tab (see server/roster/): GET what a floor's team looks like and one standup's page, and
// POST what the Project Manager (the human; an admin) does: hire, bench, rename, change a model, run a
// standup, decide on a proposal, answer an escalation, change the team settings, ask the Coordinator
// something now or after its turn (with how its relays reach busy Leads), nudge an idle member back to work. Those that are the
// Project Manager's need an admin (anyone with the shared office password is one).

import { isEscalationVerdict } from '../../../shared/roster/escalation.js';
import { isRoleId } from '../../../shared/roster/roles.js';
import { rosterOf, teamFloor } from '../../roster/adapter.js';
import type { Decision } from '../../roster/standup-run.js';
import { changeSkill } from '../../roster/skills.js';
import { cleanSubName } from '../../roster/subagent-store.js';
import { isSubagentOp } from '../../../shared/roster/skills.js';
import { readBody, sameOrigin, send } from '../util.js';
import type { Route } from '../router.js';
import { floorParam } from './files.js';
import { audit, human } from '../../audit/index.js';
import { hireHoldOf, overrideHold } from '../../project-run/store.js';
import { isRisky } from '../../../shared/mobile.js';
import { refuseStale } from '../../phone-access/reauth.js';
import { raisesTeamCap } from '../../phone-access/risky.js';
import { levelOf } from '../../budget/index.js';
import { cleanChoices } from '../../../shared/roster/interrupt.js';

const ADMIN_ONLY = new Set(['settings', 'decide', 'rename', 'model', 'hire', 'bench', 'escalation', 'skill', 'subagent', 'subagent-decide', 'subagent-rename']);
const DECISIONS = new Set<Decision>(['approve', 'reject', 'change']);

export const rosterRoutes = {
  /** GET /api/roster?floor=<id>: the floor's team, its standups, proposals and approvals queue. */
  view: {
    method: 'GET',
    path: '/api/roster',
    auth: 'session',
    handle(ctx, { res, url, session }) {
      const floor = floorParam(ctx, url);
      if (!floor) return send(res, 404, { error: 'No such floor' });
      // With the project's budget level, for the "Solo · Lean" chip.
      const level = levelOf(ctx, floor.id);
      return send(res, 200, { ...rosterOf(ctx).view(teamFloor(ctx, floor), ctx.meOf(session.account?.id).admin), ...(level ? { level } : {}) });
    },
  },
  /** GET /api/roster/standup?floor=<id>&id=<standup>: one standup in full, its page included. */
  standup: {
    method: 'GET',
    path: '/api/roster/standup',
    auth: 'session',
    handle(ctx, { res, url }) {
      const floor = floorParam(ctx, url);
      if (!floor) return send(res, 404, { error: 'No such floor' });
      const all = rosterOf(ctx).data(floor.id).standups;
      const id = url.searchParams.get('id');
      const s = id ? all.find((x) => x.id === id) : all[all.length - 1];
      return s ? send(res, 200, s) : send(res, 404, { error: 'No standup yet' });
    },
  },
  /** POST /api/roster/action {floor, action, …}: what the Project Manager did on the Team tab or the project console. */
  action: {
    method: 'POST',
    path: '/api/roster/action',
    auth: 'session',
    async handle(ctx, { req, res, session }) {
      if (!sameOrigin(req, ctx.cfg)) return send(res, 403, { error: 'Forbidden' });
      let body: Record<string, unknown>;
      try {
        body = JSON.parse((await readBody(req, 64 * 1024)) || '{}');
      } catch {
        return send(res, 400, { error: 'Send JSON' });
      }
      const floor = typeof body.floor === 'string' ? ctx.floors.get(body.floor) : undefined;
      if (!floor) return send(res, 404, { error: 'No such floor' });
      const action = String(body.action ?? '');
      const me = ctx.meOf(session.account?.id);
      if (ADMIN_ONLY.has(action) && !me.admin) return send(res, 403, { error: 'Only the Project Manager (an admin) can do that' });
      const roster = rosterOf(ctx);
      const team = teamFloor(ctx, floor);
      // A person's name for toasts and the record: their account's, else what their browser calls them.
      const by = session.account?.name ?? (typeof body.by === 'string' && body.by.trim() ? body.by.trim().slice(0, 32) : 'The Project Manager');
      const owner = session.account?.id;
      const role = isRoleId(body.role) ? body.role : undefined;
      const needRole = ['hire', 'bench', 'rename', 'model', 'skill', 'subagent', 'subagent-rename', 'nudge'].includes(action);
      if (needRole && !role) return send(res, 400, { error: 'Which role?' });
      // Through Phone access, what lets more be spent or code land needs the password again (phone-access/reauth.ts).
      const risky = () =>
        action === 'hire' ||
        (action === 'settings' && raisesTeamCap(roster.data(floor.id).settings, body.settings)) ||
        (action === 'escalation' && isRisky({ do: 'escalation', verdict: String(body.verdict) }, roster.escalations.view(team).find((e) => e.id === body.escalation)));
      if (refuseStale(ctx, req, res, risky)) return;
      let error: string | undefined;
      switch (action) {
        case 'hire': {
          const hire = () => roster.members.hire(team, role!, by, owner, typeof body.task === 'string' ? body.task.slice(0, 4000) : undefined);
          // A paused floor hires nobody (project-run/store.ts), unless the Project Manager confirmed hiring anyway.
          const override = body.override === true && !!hireHoldOf(floor.id);
          error = override ? await overrideHold(floor.id, hire) : await hire();
          if (override && !error) audit.record({ floor: floor.id, actor: human(by, owner), action: 'roster.hire-override', target: { kind: 'role', id: role, label: roster.data(floor.id).members[role!].name }, summary: `Hired ${roster.data(floor.id).members[role!].name} on a paused project (confirmed)`, details: { role }, severity: 'notice' });
          break;
        }
        case 'bench':
          error = roster.members.bench(team, role!, by);
          break;
        case 'rename': {
          const was = roster.data(floor.id).members[role!].name;
          error = roster.members.rename(team, role!, body.name);
          const now = roster.data(floor.id).members[role!].name;
          if (!error) audit.record({ floor: floor.id, actor: human(by, owner), action: 'roster.rename', target: { kind: 'role', id: role, label: now }, summary: `Renamed ${was} to ${now}`, details: { role, before: { name: was }, after: { name: now } } });
          break;
        }
        case 'model':
          error = roster.members.setModel(team, role!, body.model, by);
          break;
        case 'settings':
          error = roster.members.settings(team, body.settings, by, owner);
          break;
        case 'standup': {
          // What the Project Manager picked for each busy Lead in the check (after their turn when unsaid).
          const s = roster.standups.run(team, by, cleanChoices(body.choices, 'standup'));
          error = typeof s === 'string' ? s : undefined;
          break;
        }
        case 'decide': {
          const decision = String(body.decision) as Decision;
          if (!DECISIONS.has(decision)) return send(res, 400, { error: 'approve, reject or change' });
          const as = owner ? ctx.signins.ghAs(owner) : undefined;
          if (typeof as === 'string') return send(res, 400, { error: as });
          error = await roster.standups.decide(team, String(body.proposal ?? ''), decision, by, typeof body.reason === 'string' ? body.reason : undefined, as?.env);
          break;
        }
        case 'escalation': {
          // The Project Manager's answer to an escalation: back to the agent that raised it, and resolved.
          if (!isEscalationVerdict(body.verdict)) return send(res, 400, { error: 'reply, approve, reject or dismiss' });
          error = roster.escalations.resolve(team, String(body.escalation ?? ''), body.verdict, body.text, by);
          break;
        }
        case 'tell':
          // A question for the Coordinator from the console: now or after its current turn, and its relays to busy Leads as picked.
          if (typeof body.prompt !== 'string') return send(res, 400, { error: 'Say what to ask' });
          error = roster.interrupts.tell(team, body.prompt, by, body.when === 'after' ? 'after' : 'now', cleanChoices(body.leads, 'ask'), owner);
          break;
        case 'nudge':
          // Needs you's Nudge: an idle member with an open task, told to carry on or escalate.
          error = roster.backToWork.nudgeNow(team, role!, by);
          break;
        case 'skill':
          // One member's skill: on/off, its gate, or back to the project's default (🧰 Skills).
          error = changeSkill(roster, team, role!, { skill: body.skill, enabled: body.enabled, gate: body.gate, reset: body.reset });
          break;
        case 'subagent': {
          // The Project Manager warns, benches, swaps or reinstates a Lead's subagent: no gate, it's theirs.
          const name = cleanSubName(body.name);
          if (!isSubagentOp(body.op) || !name || role === 'pm') return send(res, 400, { error: 'Which subagent, and warn, bench, swap-model or reinstate?' });
          error = roster.subagents.run(team, role!, body.op, name, { reason: typeof body.reason === 'string' ? body.reason : undefined, model: typeof body.model === 'string' ? body.model.trim() : undefined }, by, 'pm');
          break;
        }
        case 'subagent-rename': {
          // The Project Manager gives a Lead's subagent another first name (its type stays): audited.
          const name = cleanSubName(body.name);
          if (!name || role === 'pm') return send(res, 400, { error: 'Which subagent?' });
          const got = roster.subagents.rename(team, role!, name, body.firstName, by);
          if (typeof got === 'string') error = got;
          else if (got.was !== got.now) audit.record({ floor: floor.id, actor: human(by, owner), action: 'subagent.rename', target: { kind: 'subagent', id: `${role}/${name}`, label: got.now }, summary: `Renamed ${roster.data(floor.id).members[role!].name}'s subagent ${got.was} (${name}) to ${got.now}`, details: { role, subagent: name, before: { name: got.was }, after: { name: got.now } } });
          break;
        }
        case 'subagent-decide':
          if (body.decision !== 'approve' && body.decision !== 'reject') return send(res, 400, { error: 'approve or reject' });
          error = roster.subagents.decide(team, String(body.id ?? ''), body.decision === 'approve', by, typeof body.reason === 'string' ? body.reason : undefined);
          break;
        default:
          return send(res, 400, { error: 'Unknown action' });
      }
      if (error) return send(res, 400, { error });
      const level = levelOf(ctx, floor.id);
      return send(res, 200, { ...roster.view(team, me.admin), ...(level ? { level } : {}) });
    },
  },
} satisfies Record<string, Route>;
