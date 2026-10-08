// The office going away under an open page (shared/office-down.ts, client net.ts): "Restarting…
// reconnecting" when it said it's restarting, "The office has stopped" when it said it stopped or stays
// silent through a few of the socket's own reconnects, nothing for a blip; the codes the office closes
// sockets with on the way out.
import test from 'node:test';
import assert from 'node:assert/strict';
import { closeCodeFor, downState, OFFICE_CLOSE, RESTART_GIVE_UP_AFTER, SILENT_STOP_AFTER } from '../src/shared/office-down.js';

test('what the page shows while the office is away', () => {
  assert.equal(downState({ code: OFFICE_CLOSE.restarting, failures: 0, restartExpected: false }), 'restarting');
  assert.equal(downState({ code: 1006, failures: 3, restartExpected: true }), 'restarting', 'an upgrade said so before the socket went');
  assert.equal(downState({ code: OFFICE_CLOSE.restarting, failures: RESTART_GIVE_UP_AFTER, restartExpected: true }), 'stopped', 'a restart that never came back');
  assert.equal(downState({ code: OFFICE_CLOSE.stopped, failures: 0, restartExpected: false }), 'stopped', 'Restart safely with no looping launcher, Ctrl+C');
  assert.equal(downState({ code: 1006, failures: 0, restartExpected: false }), undefined, 'a blip: nothing yet');
  assert.equal(downState({ code: 1006, failures: SILENT_STOP_AFTER - 1, restartExpected: false }), undefined);
  assert.equal(downState({ code: 1006, failures: SILENT_STOP_AFTER, restartExpected: false }), 'stopped', 'gone without a word, and not answering');
});

test('the office closes sockets with its own codes', () => {
  assert.equal(closeCodeFor('restart'), 4001);
  assert.equal(closeCodeFor('stop'), 4000);
});

// The page's socket (client/net.ts): the first close's code, then each failed reconnect counted, both
// cleared when it's back. A WebSocket stand-in drives it.
class FakeSocket {
  static all: FakeSocket[] = [];
  readyState = 0;
  onopen?: () => void;
  onclose?: (ev: { code: number }) => void;
  onmessage?: (ev: { data: string }) => void;
  constructor(public url: string) {
    FakeSocket.all.push(this);
  }
  send() {}
  close() {}
}

test('net.ts keeps the close code and counts the failed reconnects', async () => {
  const storage = new Map<string, string>();
  Object.assign(globalThis, {
    WebSocket: FakeSocket,
    location: { protocol: 'http:', host: 'office.test', pathname: '/lite', href: '' },
    localStorage: { getItem: (k: string) => storage.get(k) ?? null, setItem: (k: string, v: string) => void storage.set(k, v), removeItem: (k: string) => void storage.delete(k) },
    fetch: async () => ({ status: 200 }),
  });
  const timers: (() => void)[] = [];
  const realSetTimeout = globalThis.setTimeout;
  (globalThis as { setTimeout: unknown }).setTimeout = (fn: () => void) => (timers.push(fn), 0);
  try {
    const { Net } = await import('../src/client/net.js');
    const net = new Net(() => ({ name: 'x', color: '#fff', look: { skin: 0, hair: 0, style: 0 } }) as never, () => null, true);
    const seen: boolean[] = [];
    net.onStatus((up) => seen.push(up));
    net.connect();
    FakeSocket.all[0].onopen!();
    assert.equal(net.up, true);
    FakeSocket.all[0].onclose!({ code: OFFICE_CLOSE.stopped });
    await new Promise((r) => realSetTimeout(r, 0));
    assert.equal(net.closeCode, OFFICE_CLOSE.stopped);
    assert.equal(net.failures, 0);
    assert.equal(net.restarting, false);
    timers.shift()!(); // the reconnect
    FakeSocket.all[1].onclose!({ code: 1006 });
    await new Promise((r) => realSetTimeout(r, 0));
    assert.equal(net.failures, 1);
    assert.equal(net.closeCode, OFFICE_CLOSE.stopped, 'the failed reconnect keeps the reason the office gave');
    assert.equal(downState({ code: net.closeCode, failures: net.failures, restartExpected: net.restarting }), 'stopped');
    timers.shift()!();
    FakeSocket.all[2].onopen!();
    assert.equal(net.failures, 0);
    assert.equal(net.closeCode, undefined);
    FakeSocket.all[2].onclose!({ code: OFFICE_CLOSE.restarting });
    await new Promise((r) => realSetTimeout(r, 0));
    assert.equal(net.restarting, true, 'a restart close makes it retry every second');
    assert.equal(downState({ code: net.closeCode, failures: net.failures, restartExpected: net.restarting }), 'restarting');
    assert.deepEqual(seen, [true, false, false, true, false]);
  } finally {
    (globalThis as { setTimeout: unknown }).setTimeout = realSetTimeout;
  }
});
