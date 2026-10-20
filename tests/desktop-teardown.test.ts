// Quitting the desktop app for good (desktop/src/core/teardown.ts): every step runs once and in order, a
// step that throws or hangs doesn't stop the rest, Electron's quit comes after the steps, and a process
// still there after the grace time logs what was open and exits anyway; a second start of the app while
// this one is quitting starts it afresh instead of handing off to it. Fakes only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { GRACE_MS, Teardown, secondInstanceAction, type TeardownDeps } from '../desktop/src/core/teardown.ts';

/** Fake timers: nothing fires until `fire` says so. */
function clock() {
  let next = 1;
  const timers = new Map<number, { fn: () => void; ms: number }>();
  return {
    setTimer: (fn: () => void, ms: number) => {
      const id = next++;
      timers.set(id, { fn, ms });
      return id;
    },
    clearTimer: (t: unknown) => void timers.delete(t as number),
    /** Fires the pending timers of exactly `ms` (the grace or a step's timeout). */
    fire(ms: number) {
      for (const [id, t] of [...timers]) if (t.ms === ms) (timers.delete(id), t.fn());
    },
    pending: () => [...timers.values()].map((t) => t.ms),
  };
}

function rig(steps: TeardownDeps['steps'], extra: Partial<TeardownDeps> = {}) {
  const c = clock();
  const calls: string[] = [];
  const logs: string[] = [];
  const t = new Teardown({
    steps,
    openNow: () => ['window "Sign in · Live app"'],
    quit: () => calls.push('quit'),
    exit: (code) => calls.push(`exit ${code}`),
    log: (l) => logs.push(l),
    setTimer: c.setTimer,
    clearTimer: c.clearTimer,
    ...extra,
  });
  return { t, c, calls, logs };
}

const flush = () => new Promise((r) => setImmediate(r));

test('every step once, in order, then the quit; the fallback stays armed until will-quit', async () => {
  const order: string[] = [];
  const { t, c, calls } = rig([
    { name: 'the polling', run: () => void order.push('polling') },
    { name: 'the Live app windows', run: () => void order.push('live') },
    { name: 'the tray', run: async () => void order.push('tray') },
  ]);
  assert.equal(t.started, false);
  const a = t.run('Quit');
  const b = t.run('Quit again');
  assert.equal(a, b, 'the same teardown for every call');
  assert.equal(t.started, true);
  await a;
  assert.deepEqual(order, ['polling', 'live', 'tray']);
  assert.deepEqual(calls, ['quit']);
  assert.deepEqual(c.pending(), [GRACE_MS], 'the fallback is armed');
  t.done();
  assert.deepEqual(c.pending(), [], 'will-quit disarms it');
  await t.run('Quit');
  assert.deepEqual(order, ['polling', 'live', 'tray'], 'nothing runs twice');
});

test('a step that throws or hangs never stops the rest or the quit', async () => {
  const order: string[] = [];
  const { t, c, calls, logs } = rig(
    [
      {
        name: 'the Show here view',
        run: () => {
          throw new Error('Object has been destroyed');
        },
      },
      { name: 'the office', run: () => new Promise<void>(() => undefined) },
      { name: 'the windows', run: () => void order.push('windows') },
    ],
    { stepTimeoutMs: 3000 },
  );
  const done = t.run('Quit');
  await flush();
  assert.deepEqual(order, [], 'waiting on the hanging step');
  c.fire(3000);
  await done;
  assert.deepEqual(order, ['windows']);
  assert.deepEqual(calls, ['quit']);
  assert.ok(logs.some((l) => /the Show here view failed \(Object has been destroyed\)/.test(l)), logs.join('\n'));
  assert.ok(logs.some((l) => /the office didn't finish in time/.test(l)), logs.join('\n'));
});

test('still running after the grace time (a page cancelled the quit): logs what was open and exits', async () => {
  const { t, c, calls, logs } = rig([{ name: 'the tray', run: () => undefined }]);
  await t.run('Quit');
  assert.deepEqual(calls, ['quit']);
  c.fire(GRACE_MS);
  assert.deepEqual(calls, ['quit', 'exit 0']);
  assert.match(logs.at(-1)!, /still running 5 s after Quit \(open: window "Sign in · Live app"\); exiting/);
});

test('a quit that throws exits at once; what was open is optional for the log', async () => {
  const { t, calls, c } = rig([], {
    quit: () => {
      throw new Error('boom');
    },
  });
  await t.run('Quit');
  assert.deepEqual(calls, ['exit 0']);
  assert.deepEqual(c.pending(), [], 'no second exit later');
  const r = rig([], {
    openNow: () => {
      throw new Error('destroyed');
    },
  });
  await r.t.run('the session ends');
  r.c.fire(GRACE_MS);
  assert.deepEqual(r.calls, ['quit', 'exit 0']);
  assert.match(r.logs[0], /quitting \(the session ends\)/);
  assert.match(r.logs.at(-1)!, /open: nothing the app knows of/);
});

test('will-quit before the steps finish: no fallback is armed at all', async () => {
  let release!: () => void;
  const { t, c, calls } = rig([{ name: 'the windows', run: () => new Promise<void>((r) => (release = r)) }], { stepTimeoutMs: 60_000 });
  const done = t.run('Quit');
  await flush();
  t.done();
  release();
  await done;
  assert.deepEqual(calls, [], 'Electron is already quitting');
  assert.deepEqual(c.pending(), []);
});

test('a second start shows the window, replaces an instance that is quitting, and leaves one still starting alone', () => {
  assert.equal(secondInstanceAction({ quitting: false, hasWindow: true }), 'show');
  assert.equal(secondInstanceAction({ quitting: true, hasWindow: true }), 'relaunch');
  assert.equal(secondInstanceAction({ quitting: false, hasWindow: false }), 'wait');
  assert.equal(secondInstanceAction({ quitting: true, hasWindow: false }), 'relaunch');
});
