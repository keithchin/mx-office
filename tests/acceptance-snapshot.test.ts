import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { accept, acceptanceDraft, acceptanceStore, acceptanceView, reopen, STALE_REVIEW } from '../src/server/acceptance/index.js';
import { acceptanceSource } from '../src/server/acceptance/snapshot.js';
import { book } from '../src/server/budget/ledger.js';
import { useTunnelOrigin } from '../src/server/http/util.js';
import { removeDir } from './support/cleanup.js';
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
  // No daily exchange-rate fetch from the network in a test.
  b.store.office().fx = { currency: 'USD', mode: 'manual' };
  t.after(async () => { await rosterOf(ctx).file(floor.id).flushSoon(); b.flush(); removeDir(root); });
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
  assert.equal(stale.data.error, STALE_REVIEW);
  assert.equal(stale.data.stale, true, 'the dialog refreshes the evidence on a stale review');
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

/** Spend booked on the floor today, as an agent's turn would. */
function spend(f: ReturnType<typeof fixture>, cost: number) {
  const ledger = f.b.file({ id: f.floor.id, name: 'Shop', dir: f.dir }).ledger;
  book(ledger, { day: new Date().toISOString().slice(0, 10), agent: 'w1', model: 'claude-test', stage: '6', cost, calls: 1 }, { key: 'w1', name: 'Tess', role: 'Lead Tester', kind: 'worker' } as never);
}

test('spend and the exchange rate moving while someone reads do not refuse the confirm; the record freezes the spend then; crossing the budget does', async (t) => {
  const f = fixture(t);
  f.b.file({ id: f.floor.id, name: 'Shop', dir: f.dir }).settings.total = 100;
  const d = await acceptanceDraft(f.ctx, f.floor, true);
  assert.equal(d.cost.spent, 0);
  spend(f, 1.25);
  f.b.store.office().fx = { currency: 'SGD', mode: 'manual', manualRate: 1.3 };
  const r1 = await post(f.ctx, { floor: f.floor.id, action: 'accept', confirm: true, reviewToken: d.reviewToken });
  // The currency itself is a term of the review: switching it asks again.
  assert.equal(r1.status, 409);
  const d2 = await acceptanceDraft(f.ctx, f.floor, true);
  f.b.store.office().fx = { currency: 'SGD', mode: 'manual', manualRate: 1.31 };
  spend(f, 0.5);
  const over = await acceptanceDraft(f.ctx, f.floor, true);
  assert.equal(over.reviewToken, d2.reviewToken, 'a new rate and a little more spend are the same review');
  spend(f, 150);
  const r2 = await post(f.ctx, { floor: f.floor.id, action: 'accept', confirm: true, reviewToken: d2.reviewToken });
  assert.equal(r2.status, 409, 'going over the budget is a material change');
  const d3 = await acceptanceDraft(f.ctx, f.floor, true);
  spend(f, 2);
  const ok = await post(f.ctx, { floor: f.floor.id, action: 'accept', confirm: true, reviewToken: d3.reviewToken });
  assert.equal(ok.status, 200);
  assert.equal(ok.data.record.cost.spent, 153.75, 'the spend at the moment of confirming');
  assert.equal(acceptanceStore(f.ctx.cfg.dataDir, f.floor.id).all().length, 1);
});

test('through Phone access a confirm needs the password again; a record from before the review token still reads and chains', async (t) => {
  const f = fixture(t);
  const store = acceptanceStore(f.ctx.cfg.dataDir, f.floor.id);
  // A record written by release 30 (no review token, no sourceCommit anywhere).
  store.append({ op: 'accept', record: { schemaVersion: 1, id: 'acc_old', floorId: f.floor.id, version: 'v1', cycle: 1, acceptedAt: 1, acceptedBy: { name: 'Pat' }, scope: { agreed: [], delivered: [] }, source: { branch: 'main', commit: f.a, gaps: [] }, tests: [], docs: [], exceptions: [], cost: { at: 1, spent: 3, estimated: 0, unmeteredCalls: 0, byStage: [] }, refs: [] } as never });
  const view = await acceptanceView(f.ctx, f.floor, true);
  assert.equal(view.cycles[0].record?.id, 'acc_old');
  assert.equal(view.chain.ok, true);
  assert.deepEqual(view.changed, []);
  assert.notEqual(typeof reopen(f.ctx, f.floor, { scopeNote: 'More' }, { name: 'Pat' }), 'string');
  const d = await acceptanceDraft(f.ctx, f.floor, true);
  useTunnelOrigin({ via: () => true, host: () => 'office.test' });
  try {
    const r = await post(f.ctx, { floor: f.floor.id, action: 'accept', confirm: true, reviewToken: d.reviewToken });
    assert.equal(r.status, 401);
    assert.equal(r.data.reauth, true);
  } finally {
    useTunnelOrigin(undefined);
  }
  assert.equal(store.all().length, 2, 'nothing appended through the tunnel');
  assert.equal((await post(f.ctx, { floor: f.floor.id, action: 'accept', confirm: true, reviewToken: d.reviewToken })).status, 200);
  assert.equal(store.verify().ok, true);
});

test('a dashboard gate-check rendered in memory is a dated check, never cited as the committed index.html; Stage P gets no dashboard locator', async (t) => {
  const f = fixture(t);
  f.write('PROJECT.md', '# Project\n\nEntry mode: Requirements-driven\n\n## Decisions\n\n| Stage | Decision | Status |\n|---|---|---|\n');
  f.write('intake.md', '# Intake\n\n## Q1. Who?\n\n**Answer:** Shoppers\n');
  const sha = f.commit();
  const html = '<table><tr><td>0</td><td>Triage</td><td>FAIL</td><td>rendered</td></tr></table>';
  const g = await acceptanceSource(f.floor, (_dir, at) => (at === sha ? { html, at: 1_700_000_000_000 } : undefined));
  const d = draftOf({ floor: f.floor.id, version: 'v1', ...g, pulls: [], budget: { b: f.b, ref: { id: f.floor.id, name: 'Shop', dir: f.dir } }, admin: true, now: Date.now() });
  const gate0 = d.tests.find((l) => l.label === 'Gate 0 · Triage');
  assert.equal(gate0?.status, 'fail', 'the rendered verdict, not the committed PASS');
  assert.equal(gate0?.locator, undefined);
  assert.match(gate0?.detail ?? '', /checked /);
  const gateP = d.tests.filter((x) => x.label.startsWith('Gate P'));
  assert.ok(gateP.length, 'Stage P comes from the intake');
  for (const l of gateP) assert.equal(l.locator, undefined);
  for (const l of d.tests) assert.ok(!l.locator?.endsWith(':index.html'));
  // A dashboard rendered from another commit isn't used at all.
  const other = await acceptanceSource(f.floor, () => undefined);
  const committed = draftOf({ floor: f.floor.id, version: 'v1', ...other, pulls: [], budget: { b: f.b, ref: { id: f.floor.id, name: 'Shop', dir: f.dir } }, admin: true, now: Date.now() });
  assert.equal(committed.tests.find((l) => l.label === 'Gate 0 · Triage')?.locator, `git:${sha}:index.html`);
});

test('a floor with no remote and uncommitted deliverables does not read as changed right after acceptance', async (t) => {
  const f = fixture(t);
  f.write('reports/test-plan.md', 'not committed');
  f.write('test-report.html', 'edited, not committed');
  const d = await acceptanceDraft(f.ctx, f.floor, true);
  assert.equal(d.source.commit, f.a);
  assert.notEqual(typeof (await accept(f.ctx, f.floor, { reviewToken: d.reviewToken }, { name: 'Pat' })), 'string');
  assert.deepEqual((await acceptanceView(f.ctx, f.floor, true)).changed, []);
  const b = f.commit();
  const changed = (await acceptanceView(f.ctx, f.floor, true)).changed;
  assert.ok(changed.some((c) => c.includes(b.slice(0, 8))), changed.join('; '));
});
