// App Insights › Testing (server/testing/): a floor's test-run records and what they say against the
// files at main, read-only. Signed-in users, like the other App Insights pages. `part=plan` hands the
// test plan's markdown, asked only when its panel opens; `part=verification` the Verification panel's
// data (release 2). Only an admin changes the verification policy (the project's or a task's) or gives
// a waiver, from the office's own page (or a script sending JSON), each audited (server/testing/verify.ts).
// Release 1b: `part=quality` is the Quality header (scores per commit, and the office's mxcli runs), and
// POST /api/testing/run starts one of the office's own mxcli runs on main, admins only, one at a time.
// Release 39: /api/testing/switches reads (signed-in users) and changes (admins, audited) the two
// office-wide safety switches, judging merged tasks and scoring main automatically (testing/switches.ts).
import type http from 'node:http';
import type { Ctx } from '../../office/context.js';
import { refuseStale } from '../../phone-access/reauth.js';
import { rosterOf, teamFloor } from '../../roster/adapter.js';
import { officeDeps, testingView, testPlanText } from '../../testing/index.js';
import { setProjectPolicy, setTaskPolicy, verificationView, waive } from '../../testing/verify.js';
import { reverify } from '../../testing/verify-office.js';
import { qualityPart, startMicroflowTests, startQuality } from '../../testing/mxcli-office.js';
import { setTestingSwitches, testingSwitches } from '../../testing/switches.js';
import { readBody, send } from '../util.js';
import { fromOffice } from '../origin.js';
import type { Route } from '../router.js';
import type { SwitchesView } from '../../../shared/testing/switches.js';
import { floorParam } from './files.js';
import { audit, human } from '../../audit/index.js';
import { fixPrereq, testPrereqs } from '../../testing/prereqs.js';
import { raiseForPm } from '../../agent-app/raise.js';
import { testBlocker } from '../../../shared/testing/test-reason.js';

const fromUs = (req: http.IncomingMessage, ctx: Ctx) => fromOffice(req, ctx.cfg);

export const testingRoutes = {
  /** GET /api/testing/prereqs?floor=<id>: what the project's tests need on this machine (testing/prereqs.ts). */
  prereqs: {
    method: 'GET',
    path: '/api/testing/prereqs',
    auth: 'session',
    async handle(ctx, { res, url, session }) {
      const floor = floorParam(ctx, url);
      if (!floor) return send(res, 404, { error: 'No such project' });
      return send(res, 200, { ...(await testPrereqs(floor.dir, { dataDir: ctx.cfg.dataDir })), admin: ctx.meOf(session.account?.id).admin });
    },
  },
  /** POST /api/testing/prereqs {floor, what: 'test-db' | 'playwright'}: runs that prerequisite's fix. Admins only, audited. */
  fixPrereq: {
    method: 'POST',
    path: '/api/testing/prereqs',
    auth: 'session',
    async handle(ctx, { req, res, session }) {
      if (!fromUs(req, ctx)) return send(res, 403, { error: 'Forbidden' });
      if (!ctx.meOf(session.account?.id).admin) return send(res, 403, { error: 'Only an admin can prepare the test prerequisites' });
      let body: Record<string, unknown>;
      try {
        body = JSON.parse((await readBody(req, 4 * 1024)) || '{}');
      } catch {
        return send(res, 400, { error: 'Send JSON' });
      }
      const floor = ctx.floors.get(String(body.floor ?? ''));
      if (!floor) return send(res, 404, { error: 'No such project' });
      const what = body.what === 'playwright' ? 'playwright' : body.what === 'test-db' ? 'test-db' : undefined;
      if (!what) return send(res, 400, { error: 'Which prerequisite?' });
      const err = await fixPrereq(floor.dir, what, { dataDir: ctx.cfg.dataDir });
      audit.record({ floor: floor.id, actor: human(session.account?.name ?? 'The Project Manager', session.account?.id), action: 'testing.prereq', target: { kind: 'setting', id: what, label: what === 'test-db' ? 'Test database' : 'Playwright' }, summary: err ? `Couldn't prepare ${what}: ${err}` : `Prepared ${what === 'test-db' ? 'the test database' : 'Playwright'}`, severity: 'notice' });
      if (err) return send(res, 409, { error: err });
      return send(res, 200, await testPrereqs(floor.dir, { dataDir: ctx.cfg.dataDir }));
    },
  },
  /** GET /api/testing?floor=<id>[&part=plan|verification|quality]: the TestingView (or the test plan's text, the Verification panel, the Quality header). */
  view: {
    method: 'GET',
    path: '/api/testing',
    auth: 'session',
    async handle(ctx, { res, url, session }) {
      const floor = floorParam(ctx, url);
      if (!floor) return send(res, 404, { error: 'No such project' });
      try {
        const part = url.searchParams.get('part');
        if (part === 'plan') {
          const plan = await testPlanText(floor);
          return plan ? send(res, 200, plan) : send(res, 404, { error: 'No test plan at main' });
        }
        if (part === 'verification') {
          const roster = floor.workers ? rosterOf(ctx) : undefined;
          return send(res, 200, { ...(await verificationView(ctx.cfg.dataDir, roster, floor)), admin: ctx.meOf(session.account?.id).admin, judging: testingSwitches().judge });
        }
        if (part === 'quality') return send(res, 200, await qualityPart(ctx.cfg.dataDir, floor, ctx.meOf(session.account?.id).admin));
        return send(res, 200, await testingView(ctx.cfg.dataDir, floor, officeDeps(ctx)));
      } catch (err) {
        return send(res, 500, { error: (err as Error).message });
      }
    },
  },
  /** POST /api/testing/verification {floor, action: 'policy' | 'task-policy' | 'waive', …}: admins only, each audited. */
  change: {
    method: 'POST',
    path: '/api/testing/verification',
    auth: 'session',
    async handle(ctx, { req, res, session }) {
      if (!fromUs(req, ctx)) return send(res, 403, { error: 'Forbidden' });
      if (!ctx.meOf(session.account?.id).admin) return send(res, 403, { error: 'Only an admin can change the verification policy or waive a check' });
      let body: Record<string, unknown>;
      try {
        const v = JSON.parse((await readBody(req, 32 * 1024)) || '{}');
        body = v && typeof v === 'object' ? v : {};
      } catch {
        return send(res, 400, { error: 'Send JSON' });
      }
      if (refuseStale(ctx, req, res)) return;
      const floor = typeof body.floor === 'string' ? ctx.floors.get(body.floor) : undefined;
      if (!floor) return send(res, 404, { error: 'No such project' });
      // A named person: the signed-in account, else the name the page sends (an office with a shared password only).
      const name = session.account?.name ?? (typeof body.by === 'string' ? body.by.trim().slice(0, 80) : '');
      if (!name) return send(res, 400, { error: 'Say who you are (by): a waiver or a policy change is recorded with a name' });
      const who = { name, ...(session.account?.id ? { accountId: session.account.id } : {}) };
      let r: unknown;
      if (body.action === 'policy') r = await setProjectPolicy(ctx.cfg.dataDir, floor.id, body.policy === null ? null : body.policy, who);
      else if (body.action === 'task-policy') {
        if (!floor.workers || typeof body.role !== 'string') return send(res, 400, { error: 'Say whose task (role)' });
        r = setTaskPolicy(rosterOf(ctx), teamFloor(ctx, floor), body.role, body.policy === null ? null : body.policy, who);
      } else if (body.action === 'waive') r = await waive(ctx.cfg.dataDir, floor.id, body, who);
      else return send(res, 400, { error: 'action: policy, task-policy or waive' });
      if (typeof r === 'string') return send(res, 400, { error: r });
      await reverify(ctx, floor);
      return send(res, 200, { ok: true, result: r });
    },
  },
  /** POST /api/testing/run {floor, what: 'tests' | 'quality'}: one of the office's own mxcli runs on main. Admins only, audited; answers at once (202) while it runs. */
  run: {
    method: 'POST',
    path: '/api/testing/run',
    auth: 'session',
    async handle(ctx, { req, res, session }) {
      if (!fromUs(req, ctx)) return send(res, 403, { error: 'Forbidden' });
      if (!ctx.meOf(session.account?.id).admin) return send(res, 403, { error: 'Only an admin can start the office’s mxcli runs' });
      let body: Record<string, unknown>;
      try {
        const v = JSON.parse((await readBody(req, 8 * 1024)) || '{}');
        body = v && typeof v === 'object' ? v : {};
      } catch {
        return send(res, 400, { error: 'Send JSON' });
      }
      if (refuseStale(ctx, req, res)) return;
      const floor = typeof body.floor === 'string' ? ctx.floors.get(body.floor) : undefined;
      if (!floor) return send(res, 404, { error: 'No such project' });
      if (body.what !== 'tests' && body.what !== 'quality') return send(res, 400, { error: 'what: tests or quality' });
      const name = session.account?.name ?? (typeof body.by === 'string' ? body.by.trim().slice(0, 80) : '');
      const who = { name: name || 'An admin', ...(session.account?.id ? { accountId: session.account.id } : {}) };
      const r = body.what === 'tests' ? await startMicroflowTests(ctx.cfg.dataDir, floor, who, { onDone: (d) => { const ask = testBlocker(d.harnessError); if (ask) raiseForPm(ctx, floor, undefined, ask); } }) : await startQuality(ctx.cfg.dataDir, floor, who);
      if (typeof r === 'string') return send(res, 409, { error: r });
      return send(res, 202, { ok: true, commit: r.commit });
    },
  },
  /** GET /api/testing/switches: the office-wide Testing switches, and whether you may change them. */
  switches: {
    method: 'GET',
    path: '/api/testing/switches',
    auth: 'session',
    handle: (ctx, { res, session }) => send(res, 200, { switches: testingSwitches(), admin: ctx.meOf(session.account?.id).admin } satisfies SwitchesView),
  },
  /** POST /api/testing/switches {judge?: boolean, autoScore?: boolean}: admins only, each change audited. */
  setSwitches: {
    method: 'POST',
    path: '/api/testing/switches',
    auth: 'session',
    async handle(ctx, { req, res, session }) {
      if (!fromUs(req, ctx)) return send(res, 403, { error: 'Forbidden' });
      if (!ctx.meOf(session.account?.id).admin) return send(res, 403, { error: 'Only an admin can change the Testing switches' });
      let body: Record<string, unknown>;
      try {
        const v = JSON.parse((await readBody(req, 4 * 1024)) || '{}');
        body = v && typeof v === 'object' ? v : {};
      } catch {
        return send(res, 400, { error: 'Send JSON' });
      }
      if (refuseStale(ctx, req, res)) return;
      const name = session.account?.name ?? (typeof body.by === 'string' ? body.by.trim().slice(0, 80) : '');
      const r = setTestingSwitches({ judge: body.judge, autoScore: body.autoScore }, { name: name || 'An admin', ...(session.account?.id ? { accountId: session.account.id } : {}) });
      if (typeof r === 'string') return send(res, 400, { error: r });
      return send(res, 200, { switches: r, admin: true } satisfies SwitchesView);
    },
  },
} satisfies Record<string, Route>;
