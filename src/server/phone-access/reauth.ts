// Risky actions from the desktop pages that come in through 📱 Phone access's tunnel (origin.ts) need the
// same fresh sign-in as the phone's (mobile/reauth.ts): signed in, or the password typed again (POST
// /api/m/reauth), within the last 10 minutes. Anyone holding a phone (or a stolen cookie) on the tunnel
// can open the 3D office or /lite too, so merging, hiring, raising caps and budgets, approving a risky
// escalation, ⏸ / ▶ / 🔁, Connections, Studio and resolving an incident ask again there. Requests on the
// office's own address (localhost, the LAN, the tailnet) are unchanged.
//
// A route refuses with 401 { reauth: true }; the page (client/ui/reauth.ts) asks for the password and
// sends the request again. Over the socket (ws/reauth.ts) the refusal is a 'reauth' message instead.

import type http from 'node:http';
import type { Ctx } from '../office/context.js';
import { send, viaOfficeTunnel } from '../http/util.js';
import { reauthOf, sessionTokenOf } from '../mobile/reauth.js';

export const REAUTH_NEEDED = 'Type your password again: risky actions through Phone access need a sign-in from the last 10 minutes.';

/** Through the tunnel, on a session that hasn't signed in or typed its password in the last 10 minutes. */
export function staleViaTunnel(ctx: Pick<Ctx, 'cfg'>, req: http.IncomingMessage): boolean {
  return viaOfficeTunnel(req) && !reauthOf(ctx).fresh(sessionTokenOf(req));
}

/**
 * Refuses a risky action that needs the password again (401 { reauth: true }): true when it did.
 * `risky` says whether this one is, only asked for a stale request through the tunnel.
 */
export function refuseStale(ctx: Pick<Ctx, 'cfg'>, req: http.IncomingMessage, res: http.ServerResponse, risky: () => boolean = () => true): boolean {
  if (!staleViaTunnel(ctx, req) || !risky()) return false;
  send(res, 401, { error: REAUTH_NEEDED, reauth: true });
  return true;
}
