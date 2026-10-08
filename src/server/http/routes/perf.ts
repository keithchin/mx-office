// POST /api/perf/longtask: a page telling the office one of its tasks ran too long (the live warnings,
// server/perfwatch/). Anyone signed in may report; what they send is only ever shown in an incident.
// POST /api/perf/profile and GET /api/perf/profiles[/<file>]: an admin records a CPU profile of the office
// itself (perfwatch/profile.ts) and downloads it, or one the office recorded on its own after a stall.

import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { audit, human } from '../../audit/index.js';
import { readPageReport } from '../../perfwatch/index.js';
import { profileDir, profileOffice, recordedStalls, reportPage } from '../../perfwatch/office.js';
import { profiling } from '../../perfwatch/profile.js';
import { refuseStale } from '../../phone-access/reauth.js';
import type { Ctx } from '../../office/context.js';
import type { Session } from '../../auth.js';
import { readBody, sameOrigin, send } from '../util.js';
import type { Route } from '../router.js';

export const perfRoutes = {
  longTask: {
    path: '/api/perf/longtask',
    auth: 'session',
    async handle(ctx, { req, res, session }) {
      if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed' });
      if (!sameOrigin(req, ctx.cfg)) return send(res, 403, { error: 'Forbidden' });
      let body: unknown;
      try {
        body = JSON.parse((await readBody(req, 16 * 1024)) || '{}');
      } catch {
        return send(res, 400, { error: 'Send JSON' });
      }
      const r = readPageReport(body);
      if (!r) return send(res, 400, { error: 'Send { view, ms, stack? } for a task over the threshold' });
      const raised = reportPage(r, session.account?.name ?? 'Someone');
      return send(res, 202, { raised });
    },
  },
  stalls: {
    // GET /api/perf/stalls?since=<epoch ms>: the event-loop blocks over 100 ms a TEST office recorded
    // (the journey's server budget). 404 outside test mode.
    path: '/api/perf/stalls',
    auth: 'session',
    async handle(_ctx, { req, res, url }) {
      if (req.method !== 'GET') return send(res, 405, { error: 'Method not allowed' });
      const stalls = recordedStalls(Number(url.searchParams.get('since')) || 0);
      if (!stalls) return send(res, 404, { error: 'Only a test office records its stalls' });
      return send(res, 200, { stalls });
    },
  },
  profile: {
    // POST /api/perf/profile {seconds}: records the office's main thread for that long (5–300 s) and
    // answers with what took the time and where the .cpuprofile went. Admins only; one at a time.
    method: 'POST',
    path: '/api/perf/profile',
    auth: 'session',
    async handle(ctx, { req, res, session }) {
      if (!sameOrigin(req, ctx.cfg)) return send(res, 403, { error: 'Forbidden' });
      if (!isAdmin(ctx, session)) return send(res, 403, { error: ADMINS_ONLY });
      if (refuseStale(ctx, req, res)) return;
      let body: { seconds?: unknown };
      try {
        body = JSON.parse((await readBody(req, 1024)) || '{}');
      } catch {
        return send(res, 400, { error: 'Send JSON' });
      }
      if (profiling()) return send(res, 409, { error: 'A profile is being recorded already' });
      const seconds = Math.min(300, Math.max(5, Math.round(Number(body?.seconds) || 60)));
      audit.record({ actor: human(session.account?.name ?? 'An admin', session.account?.id), action: 'perf.profile', target: { kind: 'office', id: 'office', label: 'The office server' }, summary: `Recorded a ${seconds} s CPU profile of the office server`, details: { seconds }, severity: 'info' });
      const s = await profileOffice(ctx, seconds * 1000, { label: 'manual' });
      return send(res, 200, { ...s, file: path.basename(s.file) });
    },
  },
  profiles: {
    // GET /api/perf/profiles: the profiles kept (newest first). GET /api/perf/profiles/<file>: one, to open in DevTools. Admins only.
    method: 'GET',
    prefix: '/api/perf/profiles',
    auth: 'session',
    async handle(ctx, { res, session, path: p }) {
      if (!isAdmin(ctx, session)) return send(res, 403, { error: ADMINS_ONLY });
      const dir = profileDir(ctx.cfg.dataDir);
      const name = p.slice('/api/perf/profiles'.length).replace(/^\//, '');
      if (!name) {
        const files = await readdir(dir).catch(() => [] as string[]);
        const list = await Promise.all(files.filter((f) => f.endsWith('.cpuprofile')).map(async (f) => ({ file: f, ...(await stat(path.join(dir, f)).then((st) => ({ at: st.mtimeMs, bytes: st.size }))) })));
        return send(res, 200, { recording: profiling(), profiles: list.sort((a, b) => b.at - a.at) });
      }
      if (!/^[\w-]{1,80}\.cpuprofile$/.test(name)) return send(res, 404, { error: 'No such profile' });
      const data = await readFile(path.join(dir, name)).catch(() => undefined);
      if (!data) return send(res, 404, { error: 'No such profile' });
      res.writeHead(200, { 'content-type': 'application/json', 'content-disposition': `attachment; filename="${name}"` }).end(data);
    },
  },
} satisfies Record<string, Route>;

const isAdmin = (ctx: Ctx, session: Session) => !!ctx.meOf(session.account?.id).admin;
const ADMINS_ONLY = 'Only admins can profile the office';
