// /office/app on the loopback hook server: an agent's own app instance and its runs (bin/office-app.js is the
// command and the MCP tools that call it). The worker's own hook token says who's asking, as for
// office-workers; an agent only ever sees and stops its own instance.
//   GET  /office/app                    its instance, and the project's microflow test run
//   POST /office/app/start {commit, constants}  a running instance at that commit ("main", or a sha the repository
//                                       has), with constants for that run only (shared/instance-constants.ts)
//   POST /office/app/stop
//   POST /office/app/journey {journey | file+text}   a journey on it, recorded against its commit
//   POST /office/app/smoke {paths, as}  a smoke click-through on it, recorded against its commit
//   POST /office/app/test {commit, files, tags}  the microflow tests at that commit (testing/mxcli-office.ts), JUnit recorded
//                                       there; files / tags: only those test files, or the ones with that @tag (release 82)
//   GET  /office/app/test               that run's state (its progress while it runs), and its record once it's in
//   POST /office/app/check {name, result, detail, shots, commit}   a check it ran itself, recorded at the commit as reported by it (./checks.ts)

import type http from 'node:http';
import type { Ctx } from '../office/context.js';
import { readBody, send } from '../http/util.js';
import { agent, audit } from '../audit/index.js';
import { mainOf } from '../testing/repo.js';
import { commitIn, startMicroflowTests, testRunOf } from '../testing/mxcli-office.js';
import { testingStore } from '../testing/index.js';
import { outcomeWords, viewLine } from '../../shared/agent-app.js';
import { agentAppsOf, journeyDeps } from './office.js';
import { runJourney, runSmoke } from './journey.js';
import { raiseForPm } from './raise.js';
import { recordAgentCheck } from './checks.js';
import { testBlocker } from '../../shared/testing/test-reason.js';
import { cleanSubset, isSubset, subsetWords } from '../../shared/testing/test-files.js';

const ACTIONS = ['', '/start', '/stop', '/journey', '/smoke', '/test', '/check'];

const strs = (v: unknown, max: number) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').map((x) => x.slice(0, 300)).slice(0, max) : []);
const str = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : undefined);

export async function officeApp(ctx: Ctx, req: http.IncomingMessage, res: http.ServerResponse, url: URL) {
  const workerId = url.searchParams.get('worker') ?? '';
  const token = (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
  const floor = ctx.workerFloor(workerId);
  const me = floor?.workers.authenticate(workerId, token);
  if (!floor || !me) return send(res, 401, { error: 'Send your own AGENT_OFFICE_WORKER_ID as ?worker= and AGENT_OFFICE_HOOK_TOKEN as the bearer token' });
  const action = url.pathname.slice('/office/app'.length);
  if (!ACTIONS.includes(action)) return send(res, 404, { error: `No /office/app${action}` });
  const apps = agentAppsOf(ctx);
  if (req.method === 'GET' && action === '') {
    // Its own agent's status call is the one place the instance's generated test password is given.
    const app = apps.view(floor.id, me.id, true, true);
    return send(res, 200, { app: app ?? null, line: viewLine(app), test: testRunOf(floor.id) });
  }
  if (req.method === 'GET' && action === '/test') return send(res, 200, await testState(ctx, floor.id));
  if (req.method !== 'POST') return send(res, 405, { error: 'GET /office/app or /office/app/test, or POST to /office/app/start, /stop, /journey, /smoke, /test or /check' });
  let body: Record<string, unknown>;
  try {
    body = (JSON.parse((await readBody(req)) || '{}') ?? {}) as Record<string, unknown>;
  } catch {
    return send(res, 400, { error: 'Send JSON' });
  }
  const who = agent(me.name, me.id);
  /** "main", or a sha the project's repository has (agents' worktrees share its objects). */
  const resolve = async (rev: string | undefined) => {
    const r = (rev ?? 'main').trim();
    if (r === 'main' || r === 'origin/main') return (await mainOf(floor.dir))?.sha;
    return commitIn(floor.dir, r);
  };

  if (action === '/start') {
    const commit = await resolve(str(body.commit, 200));
    if (!commit) return send(res, 400, { error: `The project's repository has no commit ${String(body.commit ?? 'main')}: commit (and for a worktree, that is enough: worktrees share the repository) and ask again` });
    const r = await apps.start(floor.id, { id: me.id, name: me.name }, commit, body.constants !== undefined ? { constants: body.constants } : {});
    if (typeof r === 'string') return send(res, /constants/.test(r) ? 400 : 409, { error: r });
    // The constants' names only: never a value, never the generated password.
    audit.record({ floor: floor.id, actor: who, action: 'agent-app.start', target: { kind: 'commit', id: commit, label: `@${commit.slice(0, 7)}` }, summary: `Asked for an app instance at ${commit.slice(0, 7)}${r.constants?.length ? ` with constants ${r.constants.join(', ')}` : ''}`, severity: 'info' });
    return send(res, 200, { app: r, line: viewLine(r) });
  }
  if (action === '/stop') {
    const v = await apps.stop(floor.id, me.id);
    return send(res, 200, { app: v ?? null, line: v ? viewLine(v) : 'You had no app instance' });
  }
  if (action === '/journey' || action === '/smoke') {
    const commit = body.commit ? await resolve(str(body.commit, 200)) : undefined;
    const e = apps.ready(floor.id, me.id, commit);
    if (typeof e === 'string') return send(res, 409, { error: e });
    const d = await journeyDeps(ctx, floor.id);
    if (!d) return send(res, 410, { error: 'This project closed' });
    // A sign-in the app refused reaches the PM as a Needs-you item, never as the agent going quietly idle.
    d.onSignInFailed = (_e, words) =>
      raiseForPm(ctx, floor, me.id, {
        title: `${me.name}'s checks on its app instance can't sign in`,
        details: words,
        recommendation: 'Tell the agent which test account and password the app is seeded with (or name them in tests/e2e/project.config.js), then it runs the check again.',
      });
    const o =
      action === '/journey'
        ? await runJourney(e, { ...(str(body.journey, 300) ? { journey: str(body.journey, 300) } : {}), ...(typeof body.text === 'string' ? { text: body.text.slice(0, 512 * 1024), file: str(body.file, 300) ?? 'journey.json' } : {}) }, d)
        : await runSmoke(e, { paths: strs(body.paths, 20), ...(str(body.as, 80) ? { as: str(body.as, 80) } : {}) }, d);
    e.lastUsed = Date.now();
    audit.record({ floor: floor.id, actor: who, action: 'agent-app.run', target: { kind: 'commit', id: e.commit, label: `@${e.commit.slice(0, 7)}` }, summary: `${o.suite} on its app instance @${e.commit.slice(0, 7)}: ${o.status}`, details: { record: o.record, runtimeErrors: o.runtimeErrors?.length ?? 0 }, severity: o.status === 'passed' ? 'info' : 'warning' });
    return send(res, 200, { outcome: o, words: outcomeWords(o) });
  }
  if (action === '/check') {
    const name = (str(body.name, 160) ?? '').replace(/\s+/g, ' ').trim();
    const result = body.result;
    if (!name) return send(res, 400, { error: 'Say what you checked: --name "P3 header at 390 px as nadia"' });
    if (result !== 'passed' && result !== 'failed') return send(res, 400, { error: 'result is passed or failed' });
    const commit = body.commit ? await resolve(str(body.commit, 200)) : apps.view(floor.id, me.id, false)?.commit;
    if (!commit) return send(res, 400, { error: 'Say at which commit (--commit <sha>): you have no app instance to take it from' });
    const r = await recordAgentCheck(ctx.cfg.dataDir, { floorId: floor.id, commit, worker: me.name, suite: `check: ${name} (reported by ${me.name})`, status: result, ...(str(body.detail, 600) ? { detail: str(body.detail, 600) } : {}), shots: strs(body.shots, 5), reported: true });
    audit.record({ floor: floor.id, actor: who, action: 'agent-app.check', target: { kind: 'commit', id: commit, label: `@${commit.slice(0, 7)}` }, summary: `Reported a check at ${commit.slice(0, 7)}: ${name}: ${result}`, details: { record: r.record, shots: r.kept.length }, severity: result === 'passed' ? 'info' : 'warning' });
    return send(res, 200, { record: r.record, line: `Recorded at ${commit.slice(0, 7)} as reported by you: ${name}: ${result.toUpperCase()}${r.kept.length ? ` (${r.kept.length} screenshot${r.kept.length === 1 ? '' : 's'} kept)` : ''}${r.skipped.length ? `; not kept (only .png/.jpg/.webp up to 5 MB, by full path): ${r.skipped.join(', ')}` : ''}. It shows in the change's Checks and the merge dialog.` });
  }
  // /test: the microflow tests at a commit, through the office's own runner.
  const commit = await resolve(str(body.commit, 200));
  if (!commit) return send(res, 400, { error: `The project's repository has no commit ${String(body.commit ?? 'main')}` });
  const subset = cleanSubset(body.files, body.tags);
  if (typeof subset === 'string') return send(res, 400, { error: subset });
  const r = await startMicroflowTests(ctx.cfg.dataDir, floor, { name: me.name, agentId: me.id, commit, subset }, { onDone: (d) => { const ask = testBlocker(d.harnessError); if (ask) raiseForPm(ctx, floor, me.id, ask); } });
  if (typeof r === 'string') return send(res, 409, { error: r });
  void r.done.catch(() => undefined);
  return send(res, 200, { started: r.commit, ...(isSubset(subset) ? { subset } : {}), line: `Microflow tests started at ${r.commit.slice(0, 7)}${isSubset(subset) ? ` (${subsetWords(subset)})` : ''} in the office's work folder: office-app test --wait (or GET /office/app/test) says how far they are and when they're done` });
}

/** The project's microflow test run, and its record's results once it's in. */
async function testState(ctx: Ctx, floorId: string) {
  const run = testRunOf(floorId);
  const rec = run.record ? (await testingStore(ctx.cfg.dataDir, floorId).all()).find((r) => r.id === run.record) : undefined;
  const results = rec?.results.map((t) => ({ name: t.name, status: t.status, ...(t.harness ? { harness: true } : {}), ...(t.detail ? { detail: t.detail.slice(0, 300) } : {}) }));
  return { run, ...(rec ? { record: { id: rec.id, commit: rec.testedRevision, ...(rec.harnessError ? { harnessError: rec.harnessError } : {}), ...(rec.subset ? { subset: rec.subset } : {}), ...(rec.limit ? { limit: rec.limit } : {}), results } } : {}) };
}
