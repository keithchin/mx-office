// ✅ Accept shows its blockers before it's pressed (server/acceptance/preflight.ts, GET /api/acceptance/draft's
// gates): the same checks accept() and its route run, in the same words, without starting anything; the
// server's refusal itself is unchanged. Enforced vs informational is said for each.

import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { accept, acceptanceDraft } from '../src/server/acceptance/index.js';
import { acceptancePreflight, NOT_ADMIN, NO_COMMIT } from '../src/server/acceptance/preflight.js';
import { budgetOf } from '../src/server/budget/index.js';
import { securityOf } from '../src/server/security-gate/index.js';
import type { CheckDeps } from '../src/server/security-gate/check.js';
import { progressRoutes } from '../src/server/http/routes/progress.js';
import { rosterOf } from '../src/server/roster/adapter.js';
import type { Floor } from '../src/server/floor.js';
import type { Ctx } from '../src/server/office/context.js';
import { blockers, gatesHeadline, type AcceptGate } from '../src/shared/acceptance-gates.js';
import type { SecurityState } from '../src/shared/security.js';
import { removeDir } from './support/cleanup.js';

const PASS_OUT = 'Checking app for errors...\nThe app contains: 0 errors.\nProject check passed.\n';

function fixture(t: { after(fn: () => void): void }, admin = true) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'accept-preflight-'));
  const dir = path.join(root, 'repo');
  mkdirSync(dir);
  const git = (...args: string[]) => execFileSync('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', ...args], { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git('init', '-b', 'main');
  writeFileSync(path.join(dir, 'PROJECT.md'), '# Project\n');
  git('add', '-A');
  git('commit', '-m', 'fixture');
  const floor = { id: path.basename(root), dir, def: { name: 'Shop', projectId: 'prj_fixture' }, workers: { list: () => [] }, github: { pulls: { items: [] } } } as unknown as Floor;
  const ctx = { cfg: { dataDir: path.join(root, 'data'), trustProxy: false }, floors: new Map([[floor.id, floor]]), meOf: () => ({ admin }), workerFloor: () => undefined, toFloor: () => {} } as unknown as Ctx;
  const b = budgetOf(ctx);
  b.file({ id: floor.id, name: 'Shop', dir }).plan = { edited: true, start: '2026-10-10', lines: [] } as never;
  b.store.office().fx = { currency: 'USD', mode: 'manual' };
  // A Mendix app at every commit (security read as production) and a fake mx check that passes: no mxcli, no Docker.
  const gate = securityOf(ctx);
  let checks = 0;
  (gate.d as { reader: unknown }).reader = { read: async (_d: string, sha: string): Promise<SecurityState> => ({ commit: sha, readAt: 1, source: 'model', level: 'production', strict: true, entities: { total: 1, withoutRules: 0, sample: [] } }) };
  (gate.d as { check: CheckDeps }).check = {
    dataDir: root,
    now: () => 1,
    tool: async () => ({ bin: 'fake-mxcli', version: 'test-1' }),
    prepare: async (_f, sha) => ({ dir: path.join(root, 'mxcheck'), commit: sha, mpr: 'App.mpr' }),
    pick: () => ({ path: path.join(root, 'mxbuild.exe'), skipped: [] }),
    run: async () => ((checks++), { code: 0, stdout: PASS_OUT, stderr: '', ms: 1 }),
  } as CheckDeps;
  t.after(async () => {
    await rosterOf(ctx).file(floor.id).flushSoon();
    b.flush();
    removeDir(root);
  });
  return { ctx, floor, gate, checks: () => checks, git };
}

async function draftRoute(ctx: Ctx, floor: Floor) {
  let status = 0;
  let data: any;
  const res = { writeHead: (s: number) => ((status = s), res), end: (s: string) => void (data = JSON.parse(s)), headersSent: false };
  await progressRoutes.draft.handle(ctx, { req: { headers: {} }, res, url: new URL(`http://office.test/api/acceptance/draft?floor=${floor.id}`), session: {} } as never);
  return { status, data };
}

async function postAccept(ctx: Ctx, body: object) {
  const req = Object.assign(Readable.from([Buffer.from(JSON.stringify(body))]), { method: 'POST', headers: { host: 'office.test', origin: 'http://office.test', 'content-type': 'application/json' } });
  let status = 0;
  let data: any;
  const res = { writeHead: (s: number) => ((status = s), res), end: (s: string) => void (data = JSON.parse(s)), headersSent: false };
  await progressRoutes.act.handle(ctx, { req, res, session: {} } as never);
  return { status, data };
}

const gate = (gs: readonly AcceptGate[], id: AcceptGate['id']) => gs.find((g) => g.id === id)!;

test('no mx check at the delivery commit: the draft lists the refusal before pressing, starts nothing, and Accept refuses with the same words', async (t) => {
  const f = fixture(t);
  const { status, data } = await draftRoute(f.ctx, f.floor);
  assert.equal(status, 200);
  const gs = data.gates as AcceptGate[];
  const sec = gate(gs, 'security');
  assert.deepEqual([sec.enforced, sec.state], [true, 'fail']);
  assert.match(sec.text, /^Accepting this delivery needs the project's security baseline met at [0-9a-f]{7}\. Missing: No mx check at/);
  assert.equal(f.gate.runningOn(f.floor.id), undefined, 'the preview started no mx check');
  assert.equal(f.checks(), 0);
  assert.deepEqual(blockers(gs).map((g) => g.id), ['security']);
  assert.match(gatesHeadline(gs), /Accept will be refused until this is met/);
  // Informational ones are said as such.
  for (const id of ['testing', 'guided', 'reviews'] as const) assert.equal(gate(gs, id).enforced, false, id);
  // Pressing Accept: refused, starting with exactly what the gate said (the server adds that it started a check).
  const refused = await accept(f.ctx, f.floor, { reviewToken: data.reviewToken }, { name: 'Pat' });
  assert.equal(typeof refused, 'string');
  assert.ok(String(refused).startsWith(sec.text), String(refused));
  assert.match(String(refused), /has started an mx check/);
  // Once the check at that commit passed, the gate passes and Accept goes through.
  await f.gate.startCheck(f.floor, data.source.commit, 'test');
  const after = (await draftRoute(f.ctx, f.floor)).data;
  assert.equal(gate(after.gates, 'security').state, 'pass');
  assert.deepEqual(blockers(after.gates), []);
  assert.notEqual(typeof (await accept(f.ctx, f.floor, { reviewToken: after.reviewToken }, { name: 'Pat' })), 'string');
  // Accepted: the cycle gate now says what Accept would.
  const again = (await draftRoute(f.ctx, f.floor)).data;
  const cyc = gate(again.gates, 'cycle');
  assert.equal(cyc.state, 'fail');
  assert.equal(await accept(f.ctx, f.floor, { reviewToken: again.reviewToken }, { name: 'Pat' }), cyc.text);
});

test('not an admin: the gate says exactly what the route answers', async (t) => {
  const f = fixture(t, false);
  const d = await acceptanceDraft(f.ctx, f.floor, false);
  const gs = await acceptancePreflight(f.ctx, f.floor, false, d, { security: async () => ({}), testing: async () => undefined, guided: async () => undefined });
  const a = gate(gs, 'admin');
  assert.deepEqual([a.state, a.text], ['fail', NOT_ADMIN]);
  const r = await postAccept(f.ctx, { floor: f.floor.id, action: 'accept', confirm: true, reviewToken: d.reviewToken });
  assert.deepEqual([r.status, r.data.error], [403, a.text]);
});

test('no readable delivery commit: the gate says what accept() answers', async (t) => {
  const f = fixture(t);
  f.git('update-ref', '-d', 'refs/heads/main');
  const d = await acceptanceDraft(f.ctx, f.floor, true);
  assert.equal(d.source.commit, undefined);
  const gs = await acceptancePreflight(f.ctx, f.floor, true, d);
  assert.deepEqual([gate(gs, 'commit').state, gate(gs, 'commit').text], ['fail', NO_COMMIT]);
  assert.equal(await accept(f.ctx, f.floor, { reviewToken: d.reviewToken }, { name: 'Pat' }), NO_COMMIT);
});

test('an advisory security policy is shown as informational, never a blocker; the testing policy is never one', async (t) => {
  const f = fixture(t);
  const d = await acceptanceDraft(f.ctx, f.floor, true);
  const gs = await acceptancePreflight(f.ctx, f.floor, true, d, {
    security: async () => ({ advisory: 'The security policy is advisory: not met', gate: { missing: ['x'] } }),
    testing: async () => ({ verified: false, nothingRan: false, missing: ['Unit tests: failed'] }),
    guided: async () => ({ scenarios: 3, works: 1, wrong: 1 }),
  });
  assert.deepEqual([gate(gs, 'security').enforced, gate(gs, 'security').state], [false, 'info']);
  assert.match(gate(gs, 'testing').text, /Not verified .*Unit tests: failed.*not a refusal/);
  assert.match(gate(gs, 'guided').text, /1 of 3 marked "Works", 1 "Something’s wrong"/);
  assert.deepEqual(blockers(gs), []);
});
