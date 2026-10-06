// ▶ Resume / ⏸ Pause project (server/project-run/) and 🔁 Restart safely (server/restart/): GET a floor's
// pause and latest run, GET a resume's preview, and admins POST what they do. POST /api/office/restart
// is for scripts too: a signed-in cookie, and JSON (a cross-site form can't send that).

import type http from 'node:http';
import { cleanPacing, type ResumeAction, type ResumeChoice } from '../../../shared/project-run.js';
import { audit, human } from '../../audit/index.js';
import { projectRunsOf } from '../../project-run/adapter.js';
import { setPacing } from '../../project-run/store.js';
import { safeRestartOf } from '../../restart/office.js';
import type { Ctx } from '../../office/context.js';
import { readBody, sameOrigin, send } from '../util.js';
import type { Route } from '../router.js';
import { floorParam } from './files.js';
import { whoOf } from './notify-teams.js';

const ACTIONS = new Set<ResumeAction>(['wake', 'rehire', 'send-home', 'skip']);

/** The office's own page, or a script sending JSON with no Origin at all. */
const fromUs = (req: http.IncomingMessage, ctx: Ctx) => sameOrigin(req, ctx.cfg) || (!req.headers.origin && /^application\/json\b/i.test(req.headers['content-type'] ?? ''));

async function body(req: http.IncomingMessage): Promise<Record<string, unknown> | undefined> {
  try {
    const v = JSON.parse((await readBody(req, 64 * 1024)) || '{}');
    return v && typeof v === 'object' ? v : undefined;
  } catch {
    return undefined;
  }
}

function choiceOf(v: unknown): ResumeChoice {
  const c = (v && typeof v === 'object' ? v : {}) as { mode?: unknown; picks?: unknown };
  const mode = c.mode === 'all' || c.mode === 'pick' ? c.mode : 'work';
  const picks: Record<string, ResumeAction> = {};
  for (const [k, a] of Object.entries(c.picks && typeof c.picks === 'object' ? c.picks : {})) if (typeof k === 'string' && k.length < 80 && ACTIONS.has(a as ResumeAction)) picks[k] = a as ResumeAction;
  return { mode, picks };
}

export const projectRunRoutes = {
  /** GET /api/project-run?floor=<id>: the floor's pause, its latest resume or pause run, its pacing. */
  view: {
    method: 'GET',
    path: '/api/project-run',
    auth: 'session',
    handle(ctx, { res, url, session }) {
      const floor = floorParam(ctx, url);
      if (!floor) return send(res, 404, { error: 'No such floor' });
      return send(res, 200, projectRunsOf(ctx).view(floor.id, ctx.meOf(session.account?.id).admin));
    },
  },
  /** GET /api/project-run/preview?floor=<id>: the dry run (who'd wake and why); wakes nobody. */
  preview: {
    method: 'GET',
    path: '/api/project-run/preview',
    auth: 'session',
    async handle(ctx, { res, url }) {
      const floor = floorParam(ctx, url);
      if (!floor) return send(res, 404, { error: 'No such floor' });
      const p = await projectRunsOf(ctx).preview(floor.id);
      return typeof p === 'string' ? send(res, 400, { error: p }) : send(res, 200, p);
    },
  },
  /** POST /api/project-run {floor | all, action: resume|pause|cancel|hold|continue|pacing, choice?, pacing?}. Admins only. */
  act: {
    method: 'POST',
    path: '/api/project-run',
    auth: 'session',
    async handle(ctx, { req, res, session }) {
      if (!fromUs(req, ctx)) return send(res, 403, { error: 'Forbidden' });
      if (!ctx.meOf(session.account?.id).admin) return send(res, 403, { error: 'Only the Project Manager (an admin) can resume or pause a project' });
      const b = await body(req);
      if (!b) return send(res, 400, { error: 'Send JSON' });
      const who = whoOf(session.account?.name, b.by);
      const floors = b.all === true ? [...ctx.floors.keys()] : typeof b.floor === 'string' && ctx.floors.has(b.floor) ? [b.floor] : [];
      if (!floors.length) return send(res, 404, { error: 'No such floor' });
      const runs = projectRunsOf(ctx);
      const out: Record<string, unknown> = {};
      for (const id of floors) {
        switch (b.action) {
          case 'resume':
            out[id] = await runs.resume(id, choiceOf(b.choice), who, session.account?.id);
            break;
          case 'pause':
            out[id] = runs.pause(id, who, session.account?.id);
            break;
          case 'cancel':
            out[id] = runs.cancel(id) || 'Nothing is running there';
            break;
          case 'hold':
            out[id] = runs.hold(id) || 'Nothing is running there';
            break;
          case 'continue':
            out[id] = runs.resumeRun(id) || 'Nothing to carry on there';
            break;
          case 'pacing': {
            const before = runs.view(id, true).pacing;
            const after = setPacing(id, cleanPacing(b.pacing, before));
            audit.record({ floor: id, actor: human(who, session.account?.id), action: 'roster.settings', target: { kind: 'settings', id, label: 'Resume pacing' }, summary: `Set resume pacing to ${after.concurrent} at once, ${after.gapSec}s apart`, details: { before, after }, severity: 'info' });
            out[id] = after;
            break;
          }
          default:
            return send(res, 400, { error: 'Unknown action' });
        }
      }
      if (floors.length === 1 && typeof out[floors[0]] === 'string') return send(res, 400, { error: out[floors[0]] });
      return send(res, 200, b.all === true ? { floors: out } : out[floors[0]]);
    },
  },
  /** GET /api/office/restart: where a safe restart is, and whether the office has a restart loop. */
  restartView: {
    method: 'GET',
    path: '/api/office/restart',
    auth: 'session',
    handle(ctx, { res, session }) {
      return send(res, 200, safeRestartOf(ctx).view(ctx.meOf(session.account?.id).admin));
    },
  },
  /** POST /api/office/restart {action?: start|wait|anyway|cancel, build?, timeoutMin?}. Admins only; start by default. */
  restart: {
    method: 'POST',
    path: '/api/office/restart',
    auth: 'session',
    async handle(ctx, { req, res, session }) {
      if (!fromUs(req, ctx)) return send(res, 403, { error: 'Forbidden' });
      if (!ctx.meOf(session.account?.id).admin) return send(res, 403, { error: 'Only admins can restart the office' });
      const b = await body(req);
      if (!b) return send(res, 400, { error: 'Send JSON' });
      const r = safeRestartOf(ctx);
      const action = typeof b.action === 'string' ? b.action : 'start';
      const err =
        action === 'start'
          ? r.start(whoOf(session.account?.name, b.by), { build: b.build === true, timeoutMin: typeof b.timeoutMin === 'number' ? b.timeoutMin : undefined, byId: session.account?.id })
          : action === 'wait' || action === 'anyway' || action === 'cancel'
            ? await r.choose(action)
            : 'Unknown action';
      if (err) return send(res, 400, { error: err });
      return send(res, 200, r.view(true));
    },
  },
} satisfies Record<string, Route>;
