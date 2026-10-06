// "Open in Studio Pro" on the floor page (server/studio/): GET what the button needs to know, POST to
// open the floor's .mpr in Studio Pro on the office's machine. Opening it starts a program there and
// Studio Pro locks the project the agents write with mxcli, so it's for admins only, and only from
// the office's own pages. It's written in the audit log and said in the floor's Team chatter. Studio
// mode (studio/watch.ts) then sees it open and pauses the agents' mxcli writes by itself.

import { audit, human } from '../../audit/index.js';
import { noteChatter } from '../../chatter/bus.js';
import { openInStudio } from '../../studio/open.js';
import { busyAgents, studioInfo, studioOpened } from '../../studio/index.js';
import type { StudioOpenResult } from '../../../shared/studio.js';
import { readBody, sameOrigin, send } from '../util.js';
import type { Route } from '../router.js';
import { floorParam } from './files.js';
import { refuseStale } from '../../phone-access/reauth.js';

/** Each problem as an HTTP status: nothing to open is the floor's, the rest the office machine's. */
const STATUS = { 'no-mpr': 404, 'no-desktop': 503, 'not-windows': 503, 'not-installed': 503 } as const;

export const studioRoutes = {
  /** GET /api/studio?floor=<id>: whether the floor has a project to open, and whether it can be opened from here. */
  info: {
    method: 'GET',
    path: '/api/studio',
    auth: 'session',
    handle(ctx, { res, url, session }) {
      const floor = floorParam(ctx, url);
      if (!floor) return send(res, 404, { error: 'No such floor' });
      return send(res, 200, studioInfo(floor, ctx.meOf(session.account?.id).admin));
    },
  },
  /** POST /api/studio/open {floor, by?}: opens the floor's .mpr in Studio Pro. Admins only. */
  open: {
    method: 'POST',
    path: '/api/studio/open',
    auth: 'session',
    async handle(ctx, { req, res, session }) {
      if (!sameOrigin(req, ctx.cfg)) return send(res, 403, { error: 'Forbidden' });
      if (!ctx.meOf(session.account?.id).admin) return send(res, 403, { error: 'Only admins can open the project in Studio Pro' });
      if (refuseStale(ctx, req, res)) return;
      let body: Record<string, unknown>;
      try {
        body = JSON.parse((await readBody(req, 4096)) || '{}');
      } catch {
        return send(res, 400, { error: 'Send JSON' });
      }
      const floor = typeof body.floor === 'string' ? ctx.floors.get(body.floor) : undefined;
      if (!floor) return send(res, 404, { error: 'No such floor' });
      // Who it's by: the account, or on the shared password the name on the page's profile (only ever shown).
      const named = typeof body.by === 'string' ? body.by.replace(/[^\p{L}\p{N} ._'-]/gu, '').trim().slice(0, 60) : '';
      const by = session.account?.name ?? (named || 'An admin');
      const r = openInStudio(floor.dir);
      if (!r.ok) return send(res, STATUS[r.problem], { ok: false, error: r.error, problem: r.problem } satisfies StudioOpenResult);
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
      return send(res, 200, { ok: true, mpr: r.mpr, ...(r.version ? { version: r.version } : {}) } satisfies StudioOpenResult);
    },
  },
} satisfies Record<string, Route>;
