// The setup panel's requests (client/ui/setup-panel.ts, ui/setup-cache.ts): however many redraws ask at
// once, one GET /api/wizard/setup per floor; a fresh answer is reused, `force` always asks again, an
// older answer never replaces a newer forced one, an answer for a floor the panel has moved off never
// draws into it, a failure is let go of so the next ask works, and the gate-check poll never piles up.
// On a stand-in for the DOM (tests/support/fakedom.ts) and a stand-in fetch.
import test from 'node:test';
import assert from 'node:assert/strict';
import { installFakeDom, FakeEl } from './support/fakedom.js';

installFakeDom();

interface Pending {
  floor: string;
  resolve(v: unknown): void;
  reject(e: Error): void;
}
const asked: Pending[] = [];
Object.assign(globalThis, {
  fetch: (url: string) => {
    const u = new URL(url, 'http://office');
    // Only the setup answers are under test; the panel's other lines (toolkit, deliverables) never answer.
    if (u.pathname !== '/api/wizard/setup') return new Promise(() => {});
    return new Promise((resolve, reject) => {
      asked.push({
        floor: u.searchParams.get('floor')!,
        resolve: (v) => resolve({ ok: true, status: 200, json: async () => v }),
        reject,
      });
    });
  },
});

// Live timers, to see the gate-check poll never piles up.
const live = new Set<unknown>();
const realSet = globalThis.setTimeout;
const realClear = globalThis.clearTimeout;
Object.assign(globalThis, {
  setTimeout: (fn: () => void, ms: number) => {
    const t = realSet(() => {
      live.delete(t);
      fn();
    }, ms);
    live.add(t);
    return t;
  },
  clearTimeout: (t: ReturnType<typeof setTimeout>) => {
    live.delete(t);
    realClear(t);
  },
});

const { renderSetup, cachedSetup, forgetSetup } = await import('../src/client/ui/setup-panel.js');
const { SetupCache } = await import('../src/client/ui/setup-cache.js');

const handlers: ((m: { t: string; floor?: string }) => void)[] = [];
const deps = { net: { onMessage: (h: (m: { t: string; floor?: string }) => void) => handlers.push(h) }, go() {} } as never;
const view = (floor: string, over: Record<string, unknown> = {}) => ({ show: true, stages: [{ id: '1', title: `stages of ${floor}`, status: 'PASS' }], questions: [], checking: false, ...over });
const tick = () => new Promise((r) => realSet(r, 0));
const answer = async (i: number, v: unknown) => {
  asked[i].resolve(v);
  await tick();
};
const forFloor = (f: string) => asked.filter((a) => a.floor === f).length;
const panelOf = () => new FakeEl('div');
let n = 0;
/** A floor no other test has used, so the module's cache starts cold for it. */
const fresh = () => `floor-${++n}`;

test('ten simultaneous cold calls for one floor send one request, and every panel draws its answer', async () => {
  asked.length = 0;
  const f = fresh();
  const els = Array.from({ length: 10 }, panelOf);
  const done = els.map((el) => renderSetup(el, f, deps));
  assert.equal(asked.length, 1);
  await answer(0, view(f));
  await Promise.all(done);
  for (const el of els) assert.match(el.textContent, new RegExp(`stages of ${f}`));
  assert.equal(cachedSetup(f)?.stages[0].title, `stages of ${f}`);
});

test('two floors at once: one request each, and neither answer lands in the other panel', async () => {
  asked.length = 0;
  const [a, b] = [fresh(), fresh()];
  const ea = panelOf();
  const eb = panelOf();
  const done = [renderSetup(ea, a, deps), renderSetup(eb, b, deps), renderSetup(ea, a, deps), renderSetup(eb, b, deps)];
  assert.equal(forFloor(a), 1);
  assert.equal(forFloor(b), 1);
  // B answers first.
  await answer(1, view(b));
  await answer(0, view(a));
  await Promise.all(done);
  assert.match(ea.textContent, new RegExp(`stages of ${a}`));
  assert.doesNotMatch(ea.textContent, new RegExp(`stages of ${b}`));
  assert.match(eb.textContent, new RegExp(`stages of ${b}`));
});

test('warm within freshness: no request; past it, or forced: one', async () => {
  let now = 1_000;
  let calls = 0;
  const c = new SetupCache<{ checking: boolean; n: number }>(async () => ({ checking: false, n: ++calls }), (v) => (v.checking ? 5_000 : 15_000), 8, () => now);
  await c.get('a');
  assert.equal(calls, 1);
  now += 14_000;
  for (let i = 0; i < 5; i++) await c.get('a');
  assert.equal(calls, 1, 'fresh: reused');
  now += 2_000;
  await Promise.all([c.get('a'), c.get('a'), c.get('a')]);
  assert.equal(calls, 2, 'expired: one request for the three');
  await c.get('a', true);
  assert.equal(calls, 3, 'force asks again while fresh');
});

test('the panel too: warm reuses, force asks again', async () => {
  asked.length = 0;
  const f = fresh();
  const el = panelOf();
  const p = renderSetup(el, f, deps);
  await answer(0, view(f));
  await p;
  for (let i = 0; i < 5; i++) await renderSetup(el, f, deps);
  assert.equal(asked.length, 1);
  const q = renderSetup(el, f, deps, true);
  assert.equal(asked.length, 2);
  await answer(1, view(f));
  await q;
});

test('a failed request is let go of: the panel empties and the next ask succeeds', async () => {
  asked.length = 0;
  const f = fresh();
  const el = panelOf();
  el.append(new FakeEl('p'));
  const p = renderSetup(el, f, deps);
  asked[0].reject(new Error('office down'));
  await p;
  assert.equal(el.childNodes.length, 0);
  assert.equal(cachedSetup(f), undefined);
  const q = renderSetup(el, f, deps);
  assert.equal(asked.length, 2, 'retried');
  await answer(1, view(f));
  await q;
  assert.match(el.textContent, new RegExp(`stages of ${f}`));
});

test('a late older answer never replaces a newer forced refresh, in the cache or the panel', async () => {
  asked.length = 0;
  const f = fresh();
  const el = panelOf();
  const old = renderSetup(el, f, deps);
  const forced = renderSetup(el, f, deps, true);
  assert.equal(asked.length, 2);
  await answer(1, view(f, { stages: [{ id: '1', title: 'newer', status: 'PASS' }] }));
  await forced;
  await answer(0, view(f, { stages: [{ id: '1', title: 'older', status: 'FAIL' }] }));
  await old;
  assert.match(el.textContent, /newer/);
  assert.doesNotMatch(el.textContent, /older/);
  assert.equal(cachedSetup(f)?.stages[0].title, 'newer');
  // And an ordinary ask after that reuses the newer answer.
  await renderSetup(el, f, deps);
  assert.equal(asked.length, 2);
});

test("an answer for a floor the panel has moved off doesn't draw into it", async () => {
  asked.length = 0;
  const [a, b] = [fresh(), fresh()];
  const el = panelOf();
  const pa = renderSetup(el, a, deps);
  const pb = renderSetup(el, b, deps);
  await answer(1, view(b));
  await pb;
  await answer(0, view(a));
  await pa;
  assert.match(el.textContent, new RegExp(`stages of ${b}`));
  assert.doesNotMatch(el.textContent, new RegExp(`stages of ${a}`));
  // Off to no floor at all: a late answer doesn't bring the panel back either.
  const c = fresh();
  const pc = renderSetup(el, c, deps);
  await renderSetup(el, undefined, deps);
  await answer(2, view(c));
  await pc;
  assert.equal(el.childNodes.length, 0);
});

test('rapid floor switching while gates are checking: one poll at most, none once off the floor', async () => {
  asked.length = 0;
  const before = live.size;
  const floors = [fresh(), fresh(), fresh()];
  const el = panelOf();
  for (let round = 0; round < 3; round++)
    for (const f of floors) {
      const p = renderSetup(el, f, deps);
      const pending = asked.find((a) => a.floor === f && !(a as { done?: boolean }).done);
      if (pending) {
        (pending as { done?: boolean }).done = true;
        pending.resolve(view(f, { checking: true }));
      }
      await p;
      await tick();
      assert.ok(live.size - before <= 1, `at most one poll (${live.size - before})`);
    }
  for (const f of floors) assert.equal(forFloor(f), 1, 'a checking answer is reused for 5 s');
  await renderSetup(el, undefined, deps);
  assert.equal(live.size, before, 'no poll left once the panel shows no floor');
});

test('a deleted project is forgotten; the cache keeps at most its bound', async () => {
  asked.length = 0;
  const f = fresh();
  const el = panelOf();
  const p = renderSetup(el, f, deps);
  await answer(0, view(f));
  await p;
  assert.ok(cachedSetup(f));
  assert.ok(handlers.length === 1, 'one handler, however many draws');
  for (const h of handlers) h({ t: 'project.deleted', floor: f });
  assert.equal(cachedSetup(f), undefined);
  forgetSetup(f);
  const c = new SetupCache<{ checking: boolean }>(async () => ({ checking: false }), () => 15_000, 3);
  for (const k of ['a', 'b', 'c', 'd', 'e']) await c.get(k);
  assert.equal(c.size, 3);
  assert.equal(c.peek('a'), undefined);
  assert.ok(c.peek('e'));
  c.keepOnly(['e']);
  assert.equal(c.size, 1);
});
