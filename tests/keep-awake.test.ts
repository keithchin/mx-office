// Keep-awake while agents work (src/server/keep-awake/): hold while anything works, let go after the
// idle minutes, at once when switched off or when the office stops, retry a helper that died, and the
// helper itself: the right command per platform, and on Windows one that ends with the office.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { awakeLine } from '../src/shared/keep-awake.js';
import { KeepAwake, RESPAWN_MS, type Spawner } from '../src/server/keep-awake/machine.js';
import { helperCommand, windowsScript } from '../src/server/keep-awake/spawn.js';

/** A spawner that records what it started and stopped, and can make a helper die. */
function stubSpawner() {
  const log: string[] = [];
  const deaths: ((why: string) => void)[] = [];
  let n = 0;
  const spawner: Spawner = (exited) => {
    const id = ++n;
    log.push(`start ${id}`);
    deaths.push(exited);
    return { stop: () => log.push(`stop ${id}`) };
  };
  return { spawner, log, die: (why = 'gone') => deaths.at(-1)!(why) };
}

const MIN = 60_000;
const busy = (workers = 1, jobs = 0) => ({ workers, jobs });
const idle = { workers: 0, jobs: 0 };

test('working holds the computer awake; idle for N minutes lets go', () => {
  const clock = { t: 0 };
  const s = stubSpawner();
  const k = new KeepAwake(s.spawner, () => clock.t);
  k.update(idle, true, 10 * MIN);
  assert.deepEqual(s.log, [], 'nothing running: nothing held');
  k.update(busy(3), true, 10 * MIN);
  assert.equal(k.holding, true);
  clock.t += MIN;
  k.update(busy(1, 1), true, 10 * MIN);
  assert.deepEqual(s.log, ['start 1'], 'still busy: the same helper');
  const lastBusy = clock.t;
  clock.t += MIN;
  k.update(idle, true, 10 * MIN);
  assert.equal(k.snapshot().releaseAt, lastBusy + 10 * MIN, 'idle counts from the last time anything was running');
  clock.t = lastBusy + 10 * MIN - 1;
  k.update(idle, true, 10 * MIN);
  assert.equal(k.holding, true, 'not idle long enough');
  clock.t += 1;
  k.update(idle, true, 10 * MIN);
  assert.equal(k.holding, false);
  assert.deepEqual(s.log, ['start 1', 'stop 1']);
  // Work again: held again.
  k.update(busy(), true, 10 * MIN);
  assert.deepEqual(s.log, ['start 1', 'stop 1', 'start 2']);
});

test('a job (the queue, the Firm, a gate-check) holds as a worker does; off lets go at once', () => {
  const s = stubSpawner();
  const k = new KeepAwake(s.spawner, () => 0);
  k.update(busy(0, 1), true, MIN);
  assert.equal(k.holding, true);
  k.update(busy(0, 1), false, MIN);
  assert.equal(k.holding, false);
  assert.deepEqual(s.log, ['start 1', 'stop 1']);
  k.update(busy(2), false, MIN);
  assert.deepEqual(s.log, ['start 1', 'stop 1'], 'off: never holds');
});

test('the office stopping lets go, so the helper exits with it', () => {
  const s = stubSpawner();
  const k = new KeepAwake(s.spawner, () => 0);
  k.update(busy(), true, MIN);
  k.stop();
  assert.deepEqual(s.log, ['start 1', 'stop 1']);
  k.stop();
  assert.deepEqual(s.log, ['start 1', 'stop 1'], 'twice is harmless');
});

test('a helper that died is started again after a wait, and says why meanwhile', () => {
  const clock = { t: 0 };
  const s = stubSpawner();
  const k = new KeepAwake(s.spawner, () => clock.t);
  k.update(busy(), true, MIN);
  s.die('powershell.exe stopped (exit 1): Add-Type is not allowed');
  assert.equal(k.holding, false);
  assert.match(k.snapshot().error!, /Add-Type/);
  clock.t += RESPAWN_MS - 1;
  k.update(busy(), true, MIN);
  assert.deepEqual(s.log, ['start 1']);
  clock.t += 1;
  k.update(busy(), true, MIN);
  assert.deepEqual(s.log, ['start 1', 'start 2']);
  // A helper we stopped that reports late doesn't count as dying.
  k.update(busy(), false, MIN);
  s.die('late');
  assert.equal(k.snapshot().error, undefined);
});

test('no way to keep awake on this platform: it only tracks what runs', () => {
  const k = new KeepAwake(undefined, () => 0);
  k.update(busy(), true, MIN);
  assert.equal(k.holding, false);
  assert.equal(k.supported, false);
  assert.match(awakeLine({ on: true, holding: false, activity: busy(), supported: false }, 0), /isn’t available/);
});

test('what Settings says', () => {
  assert.equal(awakeLine({ on: true, holding: true, activity: busy(3), supported: true }, 0), 'Keeping this computer awake: 3 agents working.');
  assert.equal(awakeLine({ on: true, holding: true, activity: busy(1, 2), supported: true }, 0), 'Keeping this computer awake: 1 agent working, 2 jobs running.');
  assert.equal(awakeLine({ on: true, holding: true, activity: idle, releaseAt: 4 * MIN, supported: true }, 0), 'Keeping this computer awake: everything is idle, letting go in 4 min.');
  assert.match(awakeLine({ on: false, holding: false, activity: idle, supported: true }, 0), /^Off/);
});

test('the helper per platform: system sleep only (never the display), and it watches the office', () => {
  const script = windowsScript(4242);
  assert.match(script, /SetThreadExecutionState\(\[uint32\]2147483649\)/, 'ES_CONTINUOUS | ES_SYSTEM_REQUIRED');
  assert.ok(!/2147483651|0x80000003|ES_DISPLAY/.test(script), 'no ES_DISPLAY_REQUIRED');
  assert.match(script, /\$parent = 4242/);
  assert.match(script, /OpenStandardInput\(\)\.ReadAsync/);
  assert.equal(helperCommand('win32', 1)!.cmd, 'powershell.exe');
  assert.deepEqual(helperCommand('darwin', 77), { cmd: 'caffeinate', args: ['-i', '-w', '77'] });
  assert.equal(helperCommand('linux', 77)!.cmd, 'systemd-inhibit');
  assert.ok(helperCommand('linux', 77)!.args.includes('--what=sleep:idle'));
  assert.equal(helperCommand('aix', 1), undefined);
});

test('on Windows the helper holds, then exits on its own once the office is gone', { skip: process.platform !== 'win32' }, async () => {
  // A stand-in office that lives a few seconds.
  const office = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 3000)']);
  const how = helperCommand('win32', office.pid!)!;
  const helper = spawn(how.cmd, how.args, { stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true });
  let out = '';
  helper.stdout.on('data', (d) => (out += d));
  const code = await new Promise<number | null>((resolve, reject) => {
    const t = setTimeout(() => (helper.kill(), reject(new Error('the helper outlived the office'))), 30_000);
    helper.on('exit', (c) => (clearTimeout(t), resolve(c)));
  });
  assert.match(out, /held/);
  assert.equal(code, 0);
});
