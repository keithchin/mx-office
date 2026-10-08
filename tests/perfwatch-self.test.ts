// The performance watch telling a sleeping computer from a stalled server, and the office profiling
// itself when it stalls again (server/perfwatch/: index.ts gapKind and watchEventLoop, profile.ts,
// office.ts selfProfiler), so the next stall names the functions that blocked the loop.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SLEEP_GAP, gapKind, watchEventLoop } from '../src/server/perfwatch/index.js';
import { recordProfile, summarize, summaryText, type CpuProfile } from '../src/server/perfwatch/profile.js';
import { SELF_PROFILE, selfProfiler } from '../src/server/perfwatch/office.js';
import { routes } from '../src/server/http/routes/index.js';

test('a long gap with next to no CPU spent, or the wall clock running ahead, is the computer asleep', () => {
  // The live office's 155 s "stall": the PC slept.
  assert.equal(gapKind({ monoMs: 155_000, wallMs: 155_000, cpuMs: 300 }), 'sleep');
  // Linux and macOS: the monotonic clock stops while suspended, the wall clock doesn't.
  assert.equal(gapKind({ monoMs: 5_100, wallMs: 160_000, cpuMs: 50 }), 'sleep');
  // A blocked loop burns CPU the whole time, however long.
  assert.equal(gapKind({ monoMs: 155_000, wallMs: 155_000, cpuMs: 150_000 }), 'stall');
  // Short gaps are always taken at their word.
  assert.equal(gapKind({ monoMs: 7_400, wallMs: 7_400, cpuMs: 10 }), 'stall');
  assert.equal(gapKind({ monoMs: SLEEP_GAP.minMs - 1, wallMs: SLEEP_GAP.minMs - 1, cpuMs: 0 }), 'stall');
});

test('the event-loop watch logs a sleep as a notice and raises no incident for it', async () => {
  let mono = 0;
  let wall = 1_000_000;
  let cpu = 0;
  const clocks = { mono: () => mono, wall: () => wall, cpuMs: () => cpu };
  const raised: string[] = [];
  const slept: number[] = [];
  const stalled: number[] = [];
  const stop = watchEventLoop((d) => raised.push(d.title), { stallMs: 1000, windowMs: 20, throttleMs: 0, clocks, onSleep: (ms) => slept.push(ms), onStall: (ms) => stalled.push(ms) });
  // The machine sleeps for 155 s: both clocks jump, the process spends 0.2 s of CPU.
  mono += 155_000;
  wall += 155_000;
  cpu += 200;
  await new Promise((r) => setTimeout(r, 60));
  assert.deepEqual(raised, [], 'no incident');
  assert.equal(slept.length, 1);
  assert.ok(slept[0] >= 155_000);
  // A real 2 s block: the CPU was busy all along.
  mono += 2_000;
  wall += 2_000;
  cpu += 2_000;
  await new Promise((r) => setTimeout(r, 60));
  stop();
  assert.equal(raised.length, 1, 'the block is a stall');
  assert.match(raised[0], /stalled for \d+ ms/);
  assert.equal(stalled.length, 1);
});

test('a second stall soon after the first starts one self-profile, which stops just after the next stall', async () => {
  let t = 0;
  const started: Promise<void>[] = [];
  let ended = 0;
  const p = selfProfiler(
    (until) => {
      started.push(until);
      return until.then(() => void ended++);
    },
    { now: () => t },
  );
  assert.equal(p.onStall(), false, 'one stall alone starts nothing');
  t += SELF_PROFILE.repeatWithinMs + 1;
  assert.equal(p.onStall(), false, 'nor one long after the last');
  t += 60_000;
  assert.equal(p.onStall(), true, 'a second within the window starts a profile');
  assert.equal(started.length, 1);
  t += 90_000;
  // The stall it waited for: the profile ends a moment after it (SELF_PROFILE.afterStallMs).
  assert.equal(p.onStall(), false);
  await new Promise((r) => setTimeout(r, SELF_PROFILE.afterStallMs + 200));
  assert.equal(ended, 1);
  t += 60_000;
  assert.equal(p.onStall(), false, 'at most one an hour');
  t += SELF_PROFILE.everyMs;
  p.onStall();
  t += 1000;
  assert.equal(p.onStall(), true, 'an hour later, again');
  const busy = selfProfiler(() => Promise.resolve(), { now: () => t, busy: () => true });
  busy.onStall();
  assert.equal(busy.onStall(), false, 'never while an admin is recording one');
});

test('a profile is summed up: top functions by self time, and the longest stretch with no idle in it', () => {
  const frame = (id: number, functionName: string, url = '', children: number[] = []) => ({ id, callFrame: { functionName, url, lineNumber: 9, columnNumber: 0 }, children });
  const profile: CpuProfile = {
    nodes: [
      frame(1, '(root)', '', [2, 3, 5]),
      frame(2, '(idle)'),
      frame(3, 'settle', 'file:///C:/office/dist/server/analysis/index.js', [4]),
      frame(4, 'readSession', 'file:///C:/office/dist/server/analysis/transcript.js'),
      frame(5, '(garbage collector)'),
    ],
    startTime: 0,
    endTime: 3_000_000,
    // idle, then 2 s in readSession under settle (with a GC in it), then idle.
    samples: [2, 4, 4, 5, 4, 2, 2],
    timeDeltas: [0, 1000, 700_000, 600_000, 100_000, 600_000, 1000],
  };
  const s = summarize(profile);
  assert.equal(s.durationMs, 3000);
  assert.equal(s.top[0].frame, 'readSession analysis/transcript.js:10');
  assert.ok(!s.top.some((f) => f.frame === '(idle)'), 'idle is not work');
  assert.equal(s.longest?.ms, 2000);
  assert.ok(s.longest?.stack.some((f) => f.frame === 'settle analysis/index.js:10'), 'the caller that started it');
  const text = summaryText({ file: path.join('x', 'y.cpuprofile'), ...s });
  assert.match(text, /Longest block: 2000 ms/);
  assert.match(text, /settle analysis\/index\.js:10/);
});

test('the office records a CPU profile of itself, in-process, and names what kept it busy', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'perf-profile-test-'));
  try {
    const p = recordProfile(dir, 400);
    function burnTheLoopForTheProfiler() {
      const until = performance.now() + 200;
      let x = 0;
      while (performance.now() < until) x += Math.sqrt(x + 1);
      return x;
    }
    setTimeout(burnTheLoopForTheProfiler, 50);
    const s = await p;
    assert.ok(existsSync(s.file), 'the .cpuprofile is saved');
    assert.ok(JSON.parse(readFileSync(s.file, 'utf8')).nodes.length > 0);
    assert.ok(s.longest && s.longest.ms >= 150, `longest ${s.longest?.ms} ms`);
    assert.ok([...s.longest!.top, ...s.top].some((f) => /burnTheLoopForTheProfiler|sqrt|now/.test(f.frame)), JSON.stringify(s.top));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('recording and downloading profiles are routes for signed-in admins', () => {
  const rec = routes.find((x) => 'path' in x && x.path === '/api/perf/profile');
  const list = routes.find((x) => 'prefix' in x && x.prefix === '/api/perf/profiles');
  assert.equal(rec?.auth, 'session');
  assert.equal(rec?.method, 'POST');
  assert.equal(list?.auth, 'session');
  const src = readFileSync(new URL('../src/server/http/routes/perf.ts', import.meta.url), 'utf8');
  assert.match(src, /Only admins can profile the office/);
});
