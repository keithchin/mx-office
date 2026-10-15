// Slice 1B-4's permissions and cost: the task links are only in what an admin can open (Change answer's
// detail), "No implementation work required" is an admin's change like any other, there is no route that
// reads or writes the task record, and nothing polls: minting is a memory write plus a queued append, and
// working out a revision's links stays cheap on a big project, with git asked once per linked branch.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { Readable } from 'node:stream';
import os from 'node:os';
import path from 'node:path';
import { changeAnswerRoutes } from '../src/server/http/routes/change-answer.js';
import { routes } from '../src/server/http/routes/index.js';
import { TaskStore } from '../src/server/tasks/store.js';
import { evaluateLinks, type Commit } from '../src/server/tasks/evaluate.js';
import type { DispatchRecord } from '../src/shared/dispatch.js';

type Handle = (ctx: unknown, x: unknown) => Promise<void>;

function call(route: { path: string; handle: unknown; method: string }, o: { admin: boolean; body?: unknown; url?: string; origin?: string }) {
  const headers: Record<string, string> = { host: 'office.test', 'content-type': 'application/json', ...(o.origin ? { origin: o.origin } : {}) };
  const req = Object.assign(Readable.from([Buffer.from(JSON.stringify(o.body ?? {}))]), { method: route.method, headers });
  let status = 0;
  let body: unknown;
  const res = { writeHead: (s: number) => ((status = s), res), end: (b: string) => void (body = JSON.parse(b)), headersSent: false };
  const ctx = { cfg: { trustProxy: false }, meOf: () => ({ admin: o.admin }), floors: new Map() };
  return Promise.resolve((route.handle as Handle)(ctx, { req, res, url: new URL(o.url ?? `http://office.test${route.path}`), path: route.path, session: { account: { id: 'u1', name: 'Guest' } } })).then(() => ({ status, body: body as { error?: string } }));
}

test('task-links-perms: links are only in the admin-only detail; No implementation work required is an admin change; no route serves the task record', async () => {
  assert.equal((await call(changeAnswerRoutes.detail, { admin: false, url: 'http://office.test/api/answers/detail?floor=f&decision=esc:x' })).status, 403);
  const noWork = await call(changeAnswerRoutes.change, { admin: false, origin: 'http://office.test', body: { floor: 'f', decision: 'esc:x', expectedRev: 1, noWork: true, text: 'already done' } });
  assert.equal(noWork.status, 403);
  assert.equal((await call(changeAnswerRoutes.change, { admin: true, origin: 'https://evil.test', body: { floor: 'f', decision: 'esc:x', expectedRev: 1, noWork: true } })).status, 403, 'another site');
  assert.ok(!routes.some((r) => /\/api\/tasks\b/.test(r.path)), 'the task record has no route of its own (no task-register UI yet)');
  // The acceptance that alone means "implemented as decided" is the admin-only accept.
  const progress = readFileSync(path.join(import.meta.dirname, '..', 'src/server/http/routes/progress.ts'), 'utf8');
  assert.match(progress, /The Project Manager \(an admin\) only/);
});

test('task-ids-perf: no timers in the task module; minting 2000 tasks is quick; a big revision evaluates fast with git asked once per branch', async () => {
  const dir = path.join(import.meta.dirname, '..', 'src/server/tasks');
  for (const f of readdirSync(dir)) assert.doesNotMatch(readFileSync(path.join(dir, f), 'utf8'), /setInterval|setTimeout\(/, `${f} polls`);
  const s = new TaskStore(mkdtempSync(path.join(os.tmpdir(), 'tid-perf-')));
  const t0 = performance.now();
  for (let i = 0; i < 2000; i++) {
    const t = s.create('big', { source: 'console', text: `Task ${i}` });
    s.attempt('big', t.id, { worker: 'a1' });
  }
  const mint = performance.now() - t0;
  assert.ok(mint < 500, `minting took ${mint.toFixed(0)} ms`);
  await s.flushed('big');
  assert.equal((await s.all('big')).length, 2000);

  const dispatches: DispatchRecord[] = Array.from({ length: 40 }, (_, i) => ({ id: `dsp_01JB00000000000000000000${String(i).padStart(2, '0')}`, decision: 'esc:abc', answerRev: 1, workerName: `W${i}`, payload: 'x', marker: 'm', channel: 'type', state: 'submitted', confirmedBy: 'system', task: { taskId: `tsk_01JB0000000000000000000${String(i).padStart(3, '0')}`, text: `t${i}`, branch: `feat/b${i}` }, createdAt: 1, updatedAt: 1, history: [] }));
  const commits: Commit[] = Array.from({ length: 1000 }, (_, i) => ({ sha: i.toString(16).padStart(40, '0'), at: 2000 + i, message: i % 50 ? `chore ${i}` : `feat: thing\n\nDecided per ESC-abc rev 1` }));
  const pulls = Array.from({ length: 300 }, (_, i) => ({ number: i + 1, title: `PR ${i}`, body: 'nothing here', checks: 'pass', headRefOid: 'f'.repeat(40) }));
  const planRows = Array.from({ length: 500 }, (_, i) => ({ file: 'architecture/build-plan.md', line: i, text: `${i} | Row ${i} | planned` }));
  let branchAsks = 0;
  const t1 = performance.now();
  const out = await evaluateLinks({ decision: 'esc:abc', rev: 1, answerAt: 1000, dispatches, commits, pulls, planRows, verifications: [], acceptances: [], now: 1 }, { acknowledged: async () => false, onBranch: async () => (branchAsks++, new Set()), contains: async () => false });
  const took = performance.now() - t1;
  assert.ok(took < 300, `evaluation took ${took.toFixed(0)} ms`);
  assert.equal(branchAsks, 40, 'one git log per linked branch, no more');
  assert.ok(out.links.length >= 40);
});
