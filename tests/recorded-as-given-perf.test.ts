// Recorded as given: who may act (followthrough-perms) and what it costs (followthrough-perf). The feed is
// one request per floor (never one per card), built from what's in memory; a look's scan reuses the asks
// look's reads and caches its git (a few calls per look however many citations), off the event loop.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import type { AnswerLine } from '../src/server/answers/store.js';
import type { Escalation } from '../src/shared/roster/escalation.js';
import type { Dispatcher } from '../src/server/dispatch/service.js';
import { followThroughRoutes } from '../src/server/http/routes/followthrough.js';
import { FollowThrough } from '../src/server/followthrough/service.js';
import { placesOf, readEverywhere } from '../src/server/asks/sources.js';
import { git, JOURNAL, project } from './followthrough-helpers.js';
import { mkdtempSync } from 'node:fs';
import os from 'node:os';

type Handle = (ctx: unknown, x: unknown) => Promise<void>;

function call(route: { path: string; handle: unknown }, o: { admin: boolean; body?: unknown; method?: string; url?: string; origin?: string }) {
  const headers: Record<string, string> = { host: 'office.test', 'content-type': 'application/json', ...(o.origin ? { origin: o.origin } : {}) };
  const req = Object.assign(Readable.from([Buffer.from(JSON.stringify(o.body ?? {}))]), { method: o.method ?? 'POST', headers });
  let status = 0;
  let body: unknown;
  const res = { writeHead: (s: number) => ((status = s), res), end: (b: string) => void (body = JSON.parse(b)), headersSent: false };
  const ctx = { cfg: { trustProxy: false }, meOf: () => ({ admin: o.admin }), floors: new Map() };
  return Promise.resolve((route.handle as Handle)(ctx, { req, res, url: new URL(o.url ?? `http://office.test${route.path}`), path: route.path, session: { account: { id: 'u1', name: 'Guest' } } })).then(() => ({ status, body: body as { error?: string } }));
}

test('followthrough-perms: only the Project Manager (an admin) can accept, correct or dismiss, from the office’s own page', async () => {
  for (const action of ['accept-as-recorded', 'send-correction', 'dismiss']) {
    const r = await call(followThroughRoutes.act, { admin: false, origin: 'http://office.test', body: { floor: 'f', decision: 'esc:x', action, expectedRev: 1 } });
    assert.equal(r.status, 403, action);
    assert.match(r.body.error ?? '', /Project Manager \(an admin\)/);
  }
  assert.equal((await call(followThroughRoutes.act, { admin: true, origin: 'https://evil.test', body: { floor: 'f', decision: 'esc:x', action: 'dismiss' } })).status, 403, 'another site');
  assert.equal((await call(followThroughRoutes.act, { admin: true, origin: 'http://office.test', body: { floor: 'f', decision: 'esc:x', action: 'dismiss' } })).status, 404, 'an admin gets past the check');
});

/** A dispatcher stand-in holding `n` answered escalations' revisions in memory. */
function fakeDispatcher(lines: Map<string, AnswerLine>) {
  return {
    ready: async () => {},
    answers: { latest: (_f: string, d: string) => lines.get(d), history: async (_f: string, d: string) => (lines.get(d) ? [lines.get(d)!] : []) },
    store: { get: () => undefined, list: () => [] },
  } as unknown as Dispatcher;
}

function escalations(n: number) {
  const es: Escalation[] = [];
  const lines = new Map<string, AnswerLine>();
  for (let i = 0; i < n; i++) {
    const id = `e${i.toString(36).padStart(6, '0')}`;
    es.push({ id, at: i, workerId: 'w', by: 'Ada', urgency: 'important', fyi: false, level: 'L2' as never, title: `Question ${i}?`, details: '', options: [], status: 'resolved', resolution: { verdict: 'reply', text: `Go with: option ${i}`, by: 'Keith', at: i, delivered: true, answerRev: 1 }, refs: {} });
    lines.set(`esc:${id}`, { decision: `esc:${id}`, rev: 1, kind: 'reply', text: `Go with: option ${i}`, by: 'Keith', at: i, prev: '', hash: '' });
  }
  return { es, lines };
}

test('followthrough-perf: the feed over 3,000 answered escalations is built in memory, fast; a look’s scan of 300 citations keeps the event loop free', async () => {
  const { es, lines } = escalations(3000);
  const ft = new FollowThrough({ dataDir: mkdtempSync(path.join(os.tmpdir(), 'ftp-')), now: () => 1, dispatcher: fakeDispatcher(lines), escalations: () => es, escTarget: () => 'n/a', qTarget: async () => 'n/a', flush: async () => {}, record: () => {} });
  await ft.view('f', true);
  const t0 = performance.now();
  const v = await ft.view('f', true);
  const ms = performance.now() - t0;
  assert.equal(v.items.length, 60, 'the feed is bounded');
  assert.ok(ms < 150, `view took ${ms.toFixed(1)} ms`);

  // 300 of them cited in one journal, committed and merged: one look's scan.
  const repo = project();
  const cited = es.slice(0, 300);
  writeFileSync(path.join(repo.dir, JOURNAL), `# Journal\n\n${cited.map((e, i) => `- Decided per ESC-${e.id} rev 1: option ${i}`).join('\n')}\n`);
  git(repo.dir, 'commit', '-qam', 'journal');
  git(repo.dir, 'push', '-q', 'origin', 'main');
  const reads = await readEverywhere(repo.dir, await placesOf(repo.dir, []), [JOURNAL, 'PROJECT.md']);
  let lag = 0;
  let last = performance.now();
  const tick = setInterval(() => {
    const now = performance.now();
    lag = Math.max(lag, now - last - 10);
    last = now;
  }, 10);
  const s0 = performance.now();
  await ft.scan({ id: 'f', dir: repo.dir }, reads);
  const cold = performance.now() - s0;
  const s1 = performance.now();
  await ft.scan({ id: 'f', dir: repo.dir }, reads);
  const warm = performance.now() - s1;
  clearInterval(tick);
  const recs = (await ft.store.get('f')).recordings;
  assert.equal(Object.values(recs).filter((r) => r.outcome === 'recorded' && r.location?.where === 'merged-into-main').length, 300);
  assert.ok(warm < 1500, `warm scan took ${warm.toFixed(0)} ms (cold ${cold.toFixed(0)} ms)`);
  assert.ok(lag < 250, `the event loop was held ${lag.toFixed(0)} ms`);
  // The merged, as-given ones are off the feed; the rest still on it, bounded.
  assert.ok((await ft.view('f', true)).items.every((i) => !cited.some((e) => `esc:${e.id}` === i.decision)));
});
