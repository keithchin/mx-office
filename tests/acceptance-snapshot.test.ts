import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { accept, acceptanceDraft, acceptanceStore, reopen } from '../src/server/acceptance/index.js';
import { draftOf } from '../src/server/acceptance/evidence.js';
import { budgetOf } from '../src/server/budget/index.js';
import { deliverablesOf } from '../src/server/deliverables/index.js';
import type { Floor } from '../src/server/floor.js';
import type { Ctx } from '../src/server/office/context.js';
import { progressRoutes } from '../src/server/http/routes/progress.js';
import { rosterOf } from '../src/server/roster/adapter.js';

function fixture(t: { after(fn: () => void): void }) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'acceptance-snapshot-'));
  const dir = path.join(root, 'repo');
  mkdirSync(dir);
  const git = (...args: string[]) => execFileSync('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', ...args], { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git('init', '-b', 'main');
  const write = (file: string, text: string) => { mkdirSync(path.dirname(path.join(dir, file)), { recursive: true }); writeFileSync(path.join(dir, file), text); };
  write('test-report.html', 'report A');
  write('PROJECT.md', '# Project\n\nEntry mode: Requirements-driven\n\n## Decisions\n\n| Stage | Decision | Status |\n|---|---|---|\n');
  write('index.html', '<table><tr><td>0</td><td>Triage</td><td>PASS</td><td>why</td></tr></table>');
  const commit = () => { git('add', '-A'); git('commit', '--allow-empty', '-m', 'fixture'); return git('rev-parse', 'HEAD'); };
  const a = commit();
  const floor = { id: path.basename(root), dir, def: { name: 'Shop', projectId: 'prj_fixture' }, workers: { list: () => [] }, github: { pulls: { items: [] } } } as unknown as Floor;
  const ctx = { cfg: { dataDir: path.join(root, 'data'), trustProxy: false }, floors: new Map([[floor.id, floor]]), meOf: () => ({ admin: true }), workerFloor: () => undefined } as unknown as Ctx;
  const b = budgetOf(ctx);
  b.file({ id: floor.id, name: 'Shop', dir }).plan = { edited: true, start: '2026-10-10', lines: [] } as never;
  t.after(async () => { await rosterOf(ctx).file(floor.id).flushSoon(); b.flush(); rmSync(root, { recursive: true, force: true }); });
  return { ctx, floor, git, write, commit, a, b, dir };
}

async function post(ctx: Ctx, body: object) {
  const req = Object.assign(Readable.from([Buffer.from(JSON.stringify(body))]), { method: 'POST', headers: { host: 'office.test', origin: 'http://office.test', 'content-type': 'application/json' } });
  let status = 0;
  let data: any;
  const res = { writeHead: (s: number) => ((status = s), res), end: (s: string) => void (data = JSON.parse(s)), headersSent: false };
  await progressRoutes.act.handle(ctx, { req, res, session: {} } as never);
  return { status, data };
}

test('a warm deliverables cache at A cannot cite a deleted report at B, even with the checkout at A', async (t) => {
  const f = fixture(t);
  f.git('update-ref', 'refs/remotes/origin/main', f.a);
  const cached = await deliverablesOf(f.ctx, f.floor);
  assert.equal(cached.sourceCommit, f.a);
  assert.equal(cached.items.find((i) => i.id === 'test-report')?.status, 'present');
  f.git('rm', 'test-report.html');
  f.write('index.html', '<table><tr><td>0</td><td>Triage</td><td>FAIL</td><td>changed</td></tr></table>');
  const b = f.commit();
  f.git('update-ref', 'refs/remotes/origin/main', b);
  f.git('checkout', '--detach', f.a);
  assert.equal(await deliverablesOf(f.ctx, f.floor), cached, 'the live UI cache is still at A');
  const d = await acceptanceDraft(f.ctx, f.floor, true);
  assert.equal(d.source.commit, b);
  assert.equal(d.tests.find((line) => line.label === 'Gate 0 · Triage')?.status, 'fail');
  assert.equal(d.tests.find((line) => line.label === 'Gate 0 · Triage')?.locator, `git:${b}:index.html`);
  assert.ok(!d.docs.some((line) => line.label === 'test-report.html' && line.status === 'present'));
  assert.equal(d.tests.find((line) => line.label === 'Test report / e2e evidence')?.status, 'missing');
  const result = await accept(f.ctx, f.floor, { reviewToken: d.reviewToken }, { name: 'Pat' });
  assert.notEqual(typeof result, 'string');
  if (typeof result !== 'string') for (const ref of result.refs.filter((r) => r.locator.startsWith('git:'))) f.git('cat-file', '-e', ref.locator.slice(4));
});

test('POST rejects a reviewed A after same-size content changes at B; a fresh B review records B', async (t) => {
  const f = fixture(t);
  const a = await acceptanceDraft(f.ctx, f.floor, true);
  f.write('test-report.html', 'report B');
  const b = f.commit();
  const body = { floor: f.floor.id, action: 'accept', confirm: true, reviewToken: a.reviewToken };
  const stale = await post(f.ctx, body);
  assert.equal(stale.status, 409);
  assert.match(stale.data.error, /review it again/);
  assert.equal(acceptanceStore(f.ctx.cfg.dataDir, f.floor.id).all().length, 0);
  const d = await acceptanceDraft(f.ctx, f.floor, true);
  const accepted = await post(f.ctx, { ...body, reviewToken: d.reviewToken });
  assert.equal(accepted.status, 200);
  assert.equal(accepted.data.record.source.commit, b);
  assert.equal(accepted.data.record.docs.find((l: any) => l.label === 'test-report.html').locator, `git:${b}:test-report.html`);
  assert.deepEqual(accepted.data.record.docs, d.docs);
  assert.deepEqual(accepted.data.record.tests, JSON.parse(JSON.stringify(d.tests)));
});

test('local-only acceptance reads committed content; uncommitted reports never acquire Git locators', async (t) => {
  const f = fixture(t);
  f.git('rm', 'test-report.html');
  const sha = f.commit();
  f.write('test-report.html', 'uncommitted');
  const d = await acceptanceDraft(f.ctx, f.floor, true);
  assert.equal(d.source.commit, sha);
  assert.ok(!d.docs.some((l) => l.label === 'test-report.html' && l.locator));
  f.git('update-ref', '-d', 'refs/heads/main');
  const unknown = await acceptanceDraft(f.ctx, f.floor, true);
  assert.equal(unknown.source.commit, undefined);
  assert.match(String(await accept(f.ctx, f.floor, { reviewToken: unknown.reviewToken }, { name: 'Pat' })), /commit could not be read/);
});

test('missing review tokens and changed cost or CI evidence cannot append a record', async (t) => {
  const f = fixture(t);
  const body = { floor: f.floor.id, action: 'accept', confirm: true };
  assert.equal((await post(f.ctx, body)).status, 409);
  const d = await acceptanceDraft(f.ctx, f.floor, true);
  f.b.file({ id: f.floor.id, name: 'Shop', dir: f.dir }).settings.total = 200;
  assert.equal((await post(f.ctx, { ...body, reviewToken: d.reviewToken })).status, 409);
  const next = await acceptanceDraft(f.ctx, f.floor, true);
  f.floor.github.pulls.items.push({ number: 1, state: 'OPEN', checks: 'fail', title: 'Broken check' } as never);
  assert.equal((await post(f.ctx, { ...body, reviewToken: next.reviewToken })).status, 409);
  assert.equal(acceptanceStore(f.ctx.cfg.dataDir, f.floor.id).all().length, 0);
});

test('concurrent confirmations append once; reopening keeps the record and invalidates its review', async (t) => {
  const f = fixture(t);
  const d = await acceptanceDraft(f.ctx, f.floor, true);
  const results = await Promise.all([1, 2].map(() => accept(f.ctx, f.floor, { reviewToken: d.reviewToken }, { name: 'Pat' })));
  assert.equal(results.filter((r) => typeof r !== 'string').length, 1);
  const store = acceptanceStore(f.ctx.cfg.dataDir, f.floor.id);
  const first = JSON.stringify(store.all()[0]);
  assert.notEqual(typeof reopen(f.ctx, f.floor, { scopeNote: 'Next version' }, { name: 'Pat' }), 'string');
  assert.equal(typeof await accept(f.ctx, f.floor, { reviewToken: d.reviewToken }, { name: 'Pat' }), 'string');
  assert.equal(store.all().length, 2);
  assert.equal(JSON.stringify(store.all()[0]), first);
  assert.equal(store.verify().ok, true);
});

test('draft construction leaves mismatched setup and deliverables unknown instead of relabelling them', async (t) => {
  const f = fixture(t);
  f.git('update-ref', 'refs/remotes/origin/main', f.a);
  const cached = await deliverablesOf(f.ctx, f.floor);
  const draft = draftOf({ floor: f.floor.id, version: 'v1', head: { commit: 'b'.repeat(40) }, deliverables: cached,
    setup: { show: false, checking: false, stages: [], questions: [], head: { branch: 'main', sha: f.a }, verdicts: [{ id: '6', title: 'Tests', status: 'PASS' }] },
    budget: { b: f.b, ref: { id: f.floor.id, name: 'Shop', dir: f.dir } }, pulls: [], admin: true, now: Date.now() });
  assert.equal(draft.docs[0].status, 'unknown');
  assert.ok(!draft.tests.some((l) => l.status === 'pass' || l.locator));
  assert.ok(draft.source.gaps.some((g) => /left unknown/.test(g)));
});

test('a branch-only report sorted first never gets cited as a file on the accepted commit', async (t) => {
  const f = fixture(t);
  f.git('checkout', '-b', 'office/tester');
  f.write('a/test-report.html', 'branch only');
  f.commit();
  f.git('checkout', 'main');
  const d = await acceptanceDraft(f.ctx, f.floor, true);
  const line = d.tests.find((l) => l.label === 'Test report / e2e evidence');
  assert.equal(line?.locator, `git:${f.a}:test-report.html`);
  assert.equal(line?.detail, '1 listed file on main');
  for (const l of [...d.docs, ...d.tests, ...d.scope.agreed]) if (l.locator) f.git('cat-file', '-e', l.locator.slice(4));
});
