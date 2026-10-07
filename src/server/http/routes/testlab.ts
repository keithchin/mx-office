// The Test Mode page (/lite?tab=tests, server/testlab/): admins see the suites, the history and a run's
// results, start a run against a throwaway test office (never this one), stop it, and open an incident
// from a failure. Everything here is admins only; starting, stopping and opening an incident are risky
// actions, so through 📱 Phone access they need the password again (phone-access/reauth.ts), and a POST
// must come from the office's own page.

import { readFile } from 'node:fs/promises';
import { audit, human } from '../../audit/index.js';
import { createIncident, incidentStore } from '../../incidents/index.js';
import { refuseStale } from '../../phone-access/reauth.js';
import { testLabOf } from '../../testlab/index.js';
import { incidentDraft, isRunId, isSuite } from '../../testlab/logic.js';
import type { Ctx } from '../../office/context.js';
import type { Session } from '../../auth.js';
import { readBody, sameOrigin, send } from '../util.js';
import type { Route, RouteRequest } from '../router.js';

const isAdmin = (ctx: Ctx, session: Session) => !!ctx.meOf(session.account?.id).admin;
const actorOf = (session: Session) => human(session.account?.name ?? 'An admin', session.account?.id);
const ADMINS_ONLY = 'Only admins can use the Test Mode page';

/** A POST an admin may make: same origin, an admin, fresh through the tunnel, and a JSON body; or the answer already sent. */
async function adminPost(ctx: Ctx, r: RouteRequest & { session: Session }): Promise<Record<string, unknown> | undefined> {
  if (!sameOrigin(r.req, ctx.cfg)) return void send(r.res, 403, { error: 'Forbidden' });
  if (!isAdmin(ctx, r.session)) return void send(r.res, 403, { error: ADMINS_ONLY });
  if (refuseStale(ctx, r.req, r.res)) return;
  try {
    const body = JSON.parse((await readBody(r.req, 16 * 1024)) || '{}');
    if (body && typeof body === 'object' && !Array.isArray(body)) return body as Record<string, unknown>;
  } catch {
    // below
  }
  return void send(r.res, 400, { error: 'Send JSON' });
}

export const testlabRoutes = {
  /** GET /api/testlab: test mode, the suites with their last run, the history and the run going. Admins only. */
  view: {
    method: 'GET',
    path: '/api/testlab',
    auth: 'session',
    handle(ctx, { res, session }) {
      if (!isAdmin(ctx, session)) return send(res, 403, { error: ADMINS_ONLY });
      return send(res, 200, testLabOf(ctx).view());
    },
  },
  /** POST /api/testlab/runs {suite}: starts a run. Admins only, risky. */
  start: {
    method: 'POST',
    path: '/api/testlab/runs',
    auth: 'session',
    async handle(ctx, r) {
      const body = await adminPost(ctx, r);
      if (!body) return;
      if (!isSuite(body.suite)) return send(r.res, 400, { error: 'Pick a suite: unit, pages, journey or command-center' });
      const by = r.session.account?.name ?? 'An admin';
      const s = testLabOf(ctx).runner.start(body.suite, by);
      if (typeof s === 'string') return send(r.res, 409, { error: s });
      audit.record({ actor: actorOf(r.session), action: 'testlab.start', target: { kind: 'office', id: s.id, label: `Test run ${s.id}` }, summary: `Started a test run: ${s.suite}`, details: { suite: s.suite, root: testLabOf(ctx).root }, severity: 'notice' });
      return send(r.res, 200, { run: s });
    },
  },
  /**
   * GET /api/testlab/runs/<id>: a run's summary, result and summary.md. GET …/log?from=<byte>: its log
   * from there on. GET …/file/<name>: a screenshot it took. POST …/stop: stops it. POST …/incident
   * {view?|step?}: opens an incident from what failed. Admins only.
   */
  run: {
    prefix: '/api/testlab/runs/',
    auth: 'session',
    async handle(ctx, r) {
      const [id, sub, name] = r.path.slice('/api/testlab/runs/'.length).split('/');
      if (r.req.method === 'GET' && !isAdmin(ctx, r.session)) return send(r.res, 403, { error: ADMINS_ONLY });
      const lab = testLabOf(ctx);
      const s = id && isRunId(id) ? lab.store.get(id) : undefined;
      if (r.req.method === 'GET') {
        if (!s) return send(r.res, 404, { error: 'No such run' });
        if (!sub) return send(r.res, 200, { run: lab.runner.running()?.id === s.id ? lab.runner.running() : s, result: lab.store.result(s.id), summary: lab.store.summaryMd(s.id) });
        if (sub === 'log') return send(r.res, 200, lab.store.log(s.id, Number(r.url.searchParams.get('from') ?? 0)));
        if (sub === 'file' && name) {
          const file = lab.store.file(s.id, name);
          if (!file || !file.endsWith('.png')) return send(r.res, 404, { error: 'No such file' });
          const png = await readFile(file);
          r.res.writeHead(200, { 'content-type': 'image/png', 'content-length': String(png.length), 'cache-control': 'private, max-age=86400', 'x-content-type-options': 'nosniff' });
          return r.res.end(png);
        }
        return send(r.res, 404, { error: 'No such thing' });
      }
      if (r.req.method !== 'POST') return send(r.res, 405, { error: 'Method not allowed' });
      const body = await adminPost(ctx, r);
      if (!body) return;
      if (!s) return send(r.res, 404, { error: 'No such run' });
      if (sub === 'stop') {
        const err = lab.runner.stop(s.id);
        if (err) return send(r.res, 409, { error: err });
        audit.record({ actor: actorOf(r.session), action: 'testlab.stop', target: { kind: 'office', id: s.id, label: `Test run ${s.id}` }, summary: `Stopped a test run: ${s.suite}`, severity: 'notice' });
        return send(r.res, 200, { ok: true });
      }
      if (sub === 'incident') {
        if (!incidentStore()) return send(r.res, 503, { error: 'Incidents are off' });
        const what = typeof body.view === 'string' ? body.view : typeof body.step === 'string' ? body.step : undefined;
        const key = what ?? 'run';
        if (s.incidents?.[key]) return send(r.res, 409, { error: `Incident INC-${s.incidents[key]} is already open for that` });
        const draft = incidentDraft(s, lab.store.result(s.id), what);
        if (typeof draft === 'string') return send(r.res, 400, { error: draft });
        const i = createIncident({ title: draft.title, severity: 'sev3', summary: draft.summary, floors: [] }, actorOf(r.session));
        if (!i) return send(r.res, 503, { error: 'Incidents are off' });
        lab.store.put({ ...s, incidents: { ...s.incidents, [key]: i.number } });
        return send(r.res, 200, { incident: i });
      }
      return send(r.res, 404, { error: 'No such action' });
    },
  },
} satisfies Record<string, Route>;
