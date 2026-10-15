// The "couldn't confirm" card's feed (client/ui/dispatch/feed.ts) stays out of project switches: a floor's
// first fetch waits for an idle moment, a floor seen before isn't fetched again on switching back, and a
// fetch that has nothing to draw (none before, none now) doesn't redraw the Needs you card.
import test from 'node:test';
import assert from 'node:assert/strict';

const g = globalThis as Record<string, unknown>;
const calls: string[] = [];
let unsettled: Record<string, number> = {};
g.location = { href: 'http://localhost/' };
g.requestIdleCallback = (cb: () => void) => setTimeout(cb, 0);
g.fetch = async (url: string) => {
  calls.push(url);
  const floor = new URL(url, 'http://localhost').searchParams.get('floor') ?? '';
  const n = unsettled[floor] ?? 0;
  return { ok: true, json: async () => ({ floor, admin: true, unsettled: Array.from({ length: n }, (_, i) => ({ id: `dsp_${i}` })) }) };
};
const settle = () => new Promise((r) => setTimeout(r, 20));

test('switching projects: idle first fetch, none on switching back, and no redraw when there is nothing to draw', async () => {
  const feed = await import('../src/client/ui/dispatch/feed.js');
  let redraws = 0;
  feed.onDispatchChanged(() => redraws++);
  feed.dispatchUnknown('a');
  assert.equal(calls.length, 0, 'not fetched inside the switch itself');
  await settle();
  assert.equal(calls.length, 1, 'fetched once the browser was idle');
  assert.equal(redraws, 0, 'nothing to draw: no redraw');
  feed.dispatchUnknown('b');
  await settle();
  feed.dispatchUnknown('a');
  await settle();
  assert.equal(calls.filter((c) => c.includes('floor=a')).length, 1, 'switching back to a fetches nothing');
  // Something to draw on b: it redraws when b's dispatch changes.
  unsettled = { b: 1 };
  feed.dispatchUnknown('b');
  feed.dispatchFeedMessage({ t: 'audit.new', floor: 'b', event: { action: 'dispatch.unknown', floor: 'b' } } as never);
  await new Promise((r) => setTimeout(r, 350));
  assert.equal(redraws, 1, 'an unsettled dispatch is drawn');
  assert.equal(feed.dispatchUnknown('b')?.unsettled.length, 1);
});
