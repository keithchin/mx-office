// "Open in Studio Pro" on the floor page (server/studio/): GET what the button needs to know, POST to
// open the floor's .mpr in Studio Pro on the office's machine. Opening it starts a program there and
// Studio Pro locks the project the agents write with mxcli, so it's for admins only, and only from
// the office's own pages. It's written in the audit log and said in the floor's Team chatter. Studio
// mode (studio/watch.ts) then sees it open and pauses the agents' mxcli writes by itself. Before it
// opens, the floor's folder is brought up to date with GitHub when that's safe (floor-sync/), so Studio
// Pro opens what main has; when it isn't, the answer says why and what to do. Every answer that isn't a
// success is JSON with the real reason in `error`, whatever went wrong (a throw included), so the page
// can always say it.

import type http from 'node:http';
import { audit, human } from '../../audit/index.js';
import { noteChatter } from '../../chatter/bus.js';
import { openInStudio } from '../../studio/open.js';
import { busyAgents, studioInfo, studioOpened } from '../../studio/index.js';
import type { StudioOpenResult, StudioSyncResult } from '../../../shared/studio.js';
import { floorSyncOf, syncFloorNow } from '../../floor-sync/index.js';
import { whyNoMpr } from '../../floor-sync/sync.js';
import { readBody, sameOrigin, send } from '../util.js';
import type { Route } from '../router.js';
import type { Ctx } from '../../office/context.js';
import { floorParam } from './files.js';
import { refuseStale } from '../../phone-access/reauth.js';

/**
 * What the routes call to do the work, so the tests can stand in for any of it (and make it throw). The
 * office uses the real ones; in test mode the opener never starts Studio Pro (studio/open.ts fakeMachine).
 */
export const studioRouteDeps = { syncFloorNow, studioInfo, whyNoMpr, openInStudio };

/** Each problem as an HTTP status: nothing to open is the floor's, the rest the office machine's. */
const STATUS = { 'no-mpr': 404, 'no-desktop': 503, 'not-windows': 503, 'not-installed': 503 } as const;

/** The refusal a page on another address gets, saying what didn't match (never a bare "Forbidden"). */
export const crossOriginText = (req: http.IncomingMessage) =>
  `Refused: the request didn't come from the office's own page (its Origin is ${req.headers.origin ?? 'missing'}, the office is at ${req.headers.host ?? 'an unknown address'})`;

/** Runs a route's work and turns anything it throws into a JSON answer with the real reason: never a bare 500. */
async function explained(res: http.ServerResponse, what: string, work: () => Promise<unknown>) {
  try {
    await work();
  } catch (err) {
    const why = err instanceof Error ? err.message : String(err);
    console.error(`agent-office: couldn't ${what}`, err);
    if (!res.headersSent) send(res, 500, { ok: false, error: `Couldn't ${what}: ${why || 'an unexpected error in the office'}` });
  }
}

/** The floor a POST names, from its JSON body; or the answer already sent. */
async function postedFloor(ctx: Ctx, req: http.IncomingMessage, res: http.ServerResponse) {
  let body: Record<string, unknown>;
  try {
    body = JSON.parse((await readBody(req, 4096)) || '{}');
  } catch (err) {
    send(res, 400, { ok: false, error: `The office couldn't read the request: ${(err as Error).message || 'send JSON'}` });
    return undefined;
  }
  const floor = typeof body.floor === 'string' ? ctx.floors.get(body.floor) : undefined;
  if (!floor) send(res, 404, { ok: false, error: `No such project${typeof body.floor === 'string' ? ` (${body.floor})` : ''}` });
  return floor ? { floor, body } : undefined;
}

export const studioRoutes = {
  /** GET /api/studio?floor=<id>: whether the floor has a project to open, and whether it can be opened from here. */
  info: {
    method: 'GET',
    path: '/api/studio',
    auth: 'session',
    handle: (ctx, { res, url, session }) =>
      explained(res, 'ask about the project', async () => {
        const floor = floorParam(ctx, url);
        if (!floor) return send(res, 404, { error: 'No such project' });
        return send(res, 200, studioRouteDeps.studioInfo(floor, ctx.meOf(session.account?.id).admin, undefined, floorSyncOf(floor.id)));
      }),
  },
  /** POST /api/studio/sync {floor}: brings the floor's folder up to date with GitHub when it's safe, and answers what the button needs to know now. Admins only. */
  sync: {
    method: 'POST',
    path: '/api/studio/sync',
    auth: 'session',
    handle: (ctx, { req, res, session }) =>
      explained(res, 'bring the project folder up to date', async () => {
        if (!sameOrigin(req, ctx.cfg)) return send(res, 403, { error: crossOriginText(req) });
        const admin = ctx.meOf(session.account?.id).admin;
        if (!admin) return send(res, 403, { error: 'Only admins can open the project in Studio Pro' });
        const got = await postedFloor(ctx, req, res);
        if (!got) return;
        const { floor } = got;
        const sync = await studioRouteDeps.syncFloorNow(floor, { fetch: true });
        const info = studioRouteDeps.studioInfo(floor, admin, undefined, sync);
        if (!info.hasMpr) info.error = studioRouteDeps.whyNoMpr(floor.dir, sync);
        return send(res, 200, { sync, info } satisfies StudioSyncResult);
      }),
  },
  /** POST /api/studio/open {floor, by?}: brings the folder up to date when it's safe, then opens the floor's .mpr in Studio Pro. Admins only. */
  open: {
    method: 'POST',
    path: '/api/studio/open',
    auth: 'session',
    handle: (ctx, { req, res, session }) =>
      explained(res, 'open the project in Studio Pro', async () => {
        if (!sameOrigin(req, ctx.cfg)) return send(res, 403, { ok: false, error: crossOriginText(req) });
        if (!ctx.meOf(session.account?.id).admin) return send(res, 403, { ok: false, error: 'Only admins can open the project in Studio Pro' });
        if (refuseStale(ctx, req, res)) return;
        const got = await postedFloor(ctx, req, res);
        if (!got) return;
        const { floor, body } = got;
        // Who it's by: the account, or on the shared password the name on the page's profile (only ever shown).
        const named = typeof body.by === 'string' ? body.by.replace(/[^\p{L}\p{N} ._'-]/gu, '').trim().slice(0, 60) : '';
        const by = session.account?.name ?? (named || 'An admin');
        // Up to date with GitHub first, when that's safe; when it isn't, the folder opens as it is and the answer says why.
        const sync = await studioRouteDeps.syncFloorNow(floor, { fetch: true });
        const r = studioRouteDeps.openInStudio(floor.dir);
        if (!r.ok) return send(res, STATUS[r.problem], { ok: false, error: r.problem === 'no-mpr' ? studioRouteDeps.whyNoMpr(floor.dir, sync) : r.error, problem: r.problem, sync } satisfies StudioOpenResult);
        const busy = busyAgents(floor);
        const v = r.version ? ` ${r.version}` : '';
        studioOpened({ floor: floor.id, by, at: Date.now(), mpr: r.mpr, ...(r.version ? { version: r.version } : {}) });
        audit.record({
          floor: floor.id,
          actor: human(by, session.account?.id),
          action: 'studio.open',
          target: { kind: 'project', id: floor.id, label: floor.def.name },
          summary: `Opened the project in Studio Pro${v}`,
          details: { mpr: r.mpr, ...(r.version ? { version: r.version } : {}), via: r.via, busy },
          severity: 'notice',
        });
        noteChatter(floor.id, {
          kind: 'nudge',
          from: { name: by, kind: 'human', role: 'Project Manager' },
          to: { group: 'team' },
          text: `I've opened the project in Studio Pro${v}. Studio Pro locks the .mpr: the office pauses your mxcli writes until I've closed it.`,
        });
        ctx.toastFloor(floor, `🧱 ${by} opened the project in Studio Pro${v}: the agents' mxcli writes pause while it's open`, 'warn');
        console.log(`  ${by} opened ${r.mpr} in Studio Pro${v}`);
        return send(res, 200, { ok: true, mpr: r.mpr, ...(r.version ? { version: r.version } : {}), sync } satisfies StudioOpenResult);
      }),
  },
} satisfies Record<string, Route>;
