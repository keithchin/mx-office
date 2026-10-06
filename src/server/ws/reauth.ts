// The socket's side of phone-access/reauth.ts: a page that connected through 📱 Phone access's tunnel
// needs a fresh sign-in to merge a PR or hire at a desk over its socket. The socket remembers, when it
// opens, whether it came through the tunnel and with which session cookie (kept here only, never sent
// anywhere); a refused message goes back to the page as { t: 'reauth', retry }, and the page sends it
// again once the password is typed (client/ui/reauth.ts).

import type http from 'node:http';
import type { ClientMsg } from '../../shared/protocol.js';
import { viaOfficeTunnel } from '../http/util.js';
import { reauthOf, sessionTokenOf } from '../mobile/reauth.js';
import type { Ctx } from '../office/context.js';
import type { Client } from '../office/client.js';
import { str } from '../office/input.js';

/** Sockets opened through the tunnel, with their session's cookie. */
const viaTunnel = new WeakMap<object, string>();

/** A socket just opened: remembered if it came through the tunnel. */
export function noteSocket(ws: object, req: http.IncomingMessage) {
  if (viaOfficeTunnel(req)) viaTunnel.set(ws, sessionTokenOf(req) ?? '');
}

/** Whether a message from the socket is a risky action: a merge, a hire, or a question that hires a station's agent. */
export function riskyMsg(ctx: Ctx, c: Client, msg: ClientMsg): boolean {
  if (msg.t === 'gh.merge' || msg.t === 'worker.spawn') return true;
  if (msg.t === 'station.prompt') {
    const floor = ctx.floorOf(c);
    return !!floor && !floor.workers.deskOccupied(str(msg.deskId, 32));
  }
  return false;
}

/** Refuses a risky message from a tunnel socket without a fresh sign-in (sends 'reauth'): true when it did. */
export function refuseStaleMsg(ctx: Ctx, c: Client, msg: ClientMsg): boolean {
  if (!viaTunnel.has(c.ws) || !riskyMsg(ctx, c, msg)) return false;
  if (reauthOf(ctx).fresh(viaTunnel.get(c.ws) || undefined)) return false;
  ctx.sendTo(c, { t: 'reauth', retry: msg });
  return true;
}
