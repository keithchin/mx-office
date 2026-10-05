// Who may SSH-tunnel into an office deployed with deploy/aws.sh or deploy/azure.sh.
import type { TeamClientMsg } from '../../../shared/protocol.js';
import type { Ctx } from '../../office/context.js';
import { str } from '../../office/input.js';
import type { HandlerMap } from './types.js';
import { audit, human } from '../../audit/index.js';

const teamState = async (ctx: Ctx) => ({ ...(await ctx.team.state()), deploy: ctx.cfg.deployScript });
const teamChanged = async (ctx: Ctx) => ctx.broadcast({ t: 'team', state: await teamState(ctx) });

export const teamHandlers = {
  'team.get'(ctx, c) {
    void teamState(ctx).then((state) => ctx.sendTo(c, { t: 'team', state }));
  },
  'team.invite'(ctx, c, msg) {
    const who = c.peer.name;
    const user = str(msg.github, 64);
    void ctx.team.invite(user).then(async (r) => {
      ctx.sendTo(c, { t: 'team.invited', github: user, ...r });
      if ('error' in r) return;
      ctx.toastAll(`${who} invited ${r.name} to the office`);
      audit.record({ actor: human(who, c.accountId), action: 'account.tunnelInvite', target: { kind: 'github', id: user, label: r.name }, summary: `Gave ${r.name} SSH access to the office`, severity: 'notice' });
      await teamChanged(ctx);
    });
  },
  'team.remove'(ctx, c, msg) {
    const who = c.peer.name;
    const name = str(msg.name, 64);
    void ctx.team.remove(name).then(async (err) => {
      if (err) return ctx.warn(c, err);
      ctx.toastAll(`${who} removed ${name}'s access`);
      audit.record({ actor: human(who, c.accountId), action: 'account.tunnelRemove', target: { kind: 'github', id: name, label: name }, summary: `Removed ${name}'s SSH access`, severity: 'warning' });
      await teamChanged(ctx);
    });
  },
} satisfies HandlerMap<TeamClientMsg>;
