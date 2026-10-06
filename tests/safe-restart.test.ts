// 🔁 Restart safely (server/restart/) with stubs for the office: pausing the floors it may (not the
// ones a person paused), waiting on agents mid-turn with a fake clock, the timeout's three choices,
// building first and stopping when the build fails, the exit code a looping launcher restarts on, and
// the next office resuming exactly the floors the restart paused.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { LAUNCHER_ENV, LAUNCHER_SNIPPET, RESTART_EXIT_CODE } from '../src/shared/project-run.js';
import { audit } from '../src/server/audit/index.js';
import { launcherLoops } from '../src/server/restart/exit.js';
import { pendingFile, readPending, resumeAfterRestart, SafeRestart, type Busy, type RestartDeps } from '../src/server/restart/index.js';

function stub(o: Partial<RestartDeps> = {}) {
  const clock = { now: 1_000_000 };
  const s = { paused: new Set<string>(['personal']), pausedNow: [] as string[], resumed: [] as string[], exits: [] as number[], busy: [] as Busy[], builds: 0 };
  const deps: RestartDeps = {
    dataDir: mkdtempSync(path.join(os.tmpdir(), 'restart-')),
    floors: () => ['a', 'b', 'personal'],
    paused: (id) => s.paused.has(id),
    pause: (id) => void s.pausedNow.push(id),
    resume: async (id) => void s.resumed.push(id),
    busy: () => s.busy,
    newCommits: () => true,
    build: async () => ((s.builds += 1), { ok: true, log: 'built' }),
    exit: (code) => void s.exits.push(code),
    loop: true,
    now: () => clock.now,
    ...o,
  };
  return { clock, s, deps, r: new SafeRestart(deps) };
}

test('it pauses only the floors nobody paused, writes them down, and exits with the restart code once nobody is mid-turn', async () => {
  const events: string[] = [];
  const record = audit.record;
  audit.record = (e) => (events.push(e.action), undefined);
  try {
    const { s, deps, r } = stub();
    s.busy = [{ name: 'Anita', floor: 'a', doing: 'mid-turn' }, { name: 'Hedy', floor: 'b', doing: 'mid-turn' }];
    assert.equal(r.start('Keith'), undefined);
    assert.deepEqual(s.pausedNow, ['a', 'b']);
    assert.deepEqual(readPending(deps.dataDir)?.floors, ['a', 'b']);
    await r.tick();
    assert.equal(r.phase, 'waiting');
    assert.deepEqual(r.view(true).waitingOn, ['Anita mid-turn', 'Hedy mid-turn']);
    s.busy = [];
    await r.tick();
    assert.equal(r.phase, 'exiting');
    assert.deepEqual(s.exits, [RESTART_EXIT_CODE]);
    assert.ok(existsSync(pendingFile(deps.dataDir)), 'the next office finds what to resume');
    assert.deepEqual(events, ['restart.requested', 'restart.waiting', 'restart.exiting']);
    assert.equal(r.start('Keith'), 'A safe restart is already under way');
  } finally {
    audit.record = record;
  }
});

test('the timeout: keep waiting, restart anyway (interrupting only those still working), or cancel (resuming what it paused)', async () => {
  const a = stub();
  a.s.busy = [{ name: 'Anita', floor: 'a', doing: 'mid-turn' }];
  a.r.start('Keith', { timeoutMin: 10 });
  a.clock.now += 9 * 60_000;
  await a.r.tick();
  assert.equal(a.r.phase, 'waiting');
  a.clock.now += 60_000;
  await a.r.tick();
  assert.equal(a.r.phase, 'timed-out');
  assert.equal(await a.r.choose('wait'), undefined);
  assert.equal(a.r.phase, 'waiting');
  a.clock.now += 10 * 60_000;
  await a.r.tick();
  assert.equal(a.r.phase, 'timed-out');
  const record = audit.record;
  let interrupting: unknown;
  audit.record = (e) => (e.action === 'restart.exiting' && (interrupting = e.details?.interrupting), undefined);
  try {
    await a.r.choose('anyway');
  } finally {
    audit.record = record;
  }
  assert.deepEqual(a.s.exits, [RESTART_EXIT_CODE]);
  assert.deepEqual(interrupting, [{ name: 'Anita', floor: 'a', doing: 'mid-turn' }]);

  const c = stub();
  c.s.busy = [{ name: 'Anita', floor: 'a', doing: 'mid-turn' }];
  c.r.start('Keith');
  assert.equal(await c.r.choose('cancel'), undefined);
  assert.equal(c.r.phase, 'cancelled');
  assert.deepEqual(c.s.resumed, ['a', 'b'], 'only what it paused');
  assert.equal(readPending(c.deps.dataDir), undefined);
  assert.deepEqual(c.s.exits, []);
});

test('on the latest build: built first; a failed build stops it with the log, and the office keeps running', async () => {
  const ok = stub();
  ok.r.start('Keith', { build: true });
  await ok.r.tick();
  assert.equal(ok.s.builds, 1);
  assert.deepEqual(ok.s.exits, [RESTART_EXIT_CODE]);

  const bad = stub({ build: async () => ({ ok: false, log: 'error TS2304: Cannot find name' }) });
  bad.r.start('Keith', { build: true });
  await bad.r.tick();
  assert.equal(bad.r.phase, 'failed');
  assert.match(bad.r.view(true).log ?? '', /TS2304/);
  assert.deepEqual(bad.s.exits, []);
  assert.equal(await bad.r.cancel(), undefined);
  assert.deepEqual(bad.s.resumed, ['a', 'b']);

  // No new commits: nothing to build, whatever was asked.
  const none = stub({ newCommits: () => false });
  none.r.start('Keith', { build: true });
  assert.equal(none.r.view(true).build, false);
});

test('without a looping launcher it only pauses, waits and exits (code 0); the launcher is told by its env', async () => {
  const { s, r } = stub({ loop: false });
  r.start('Keith');
  await r.tick();
  assert.deepEqual(s.exits, [0]);
  assert.equal(r.view(true).loop, false);
  assert.equal(launcherLoops({ [LAUNCHER_ENV]: '1' }), true);
  assert.equal(launcherLoops({}), false);
  assert.match(LAUNCHER_SNIPPET, /while \(\$code -eq 75\)/);
});

test('the next office resumes exactly the floors the restart paused, then deletes the file', async () => {
  const { deps, r } = stub();
  r.start('Keith');
  const resumed: string[] = [];
  // Floor b was paused by a person since (no longer the restart's), and floor c is gone.
  const got = await resumeAfterRestart({ dataDir: deps.dataDir, floors: () => ['a', 'b'], pausedForRestart: (id) => id === 'a', resume: async (id) => void resumed.push(id) });
  assert.deepEqual(got, ['a']);
  assert.deepEqual(resumed, ['a']);
  assert.equal(readPending(deps.dataDir), undefined);
  assert.deepEqual(await resumeAfterRestart({ dataDir: deps.dataDir, floors: () => ['a'], pausedForRestart: () => true, resume: async () => undefined }), []);
});
