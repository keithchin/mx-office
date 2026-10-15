// The office tells the truth about its version (shared/build-info.ts, server/restart/build.ts, the
// version banner's logic in ui/version/logic.ts, and what Restart safely says): the build it runs and
// since when, a newer one built under it, a page newer than its server saying so instead of "Unknown
// action", a restart's countdown and whom it waits on, a computer asleep under a restart, and
// "Restarted: now running …" only from the new office. On 13 Oct 2026 release 43 was built under a
// running release 42 office, and the pages ran against it for an hour and a half with nothing saying so.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, utimesSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildLabel, releaseInfo, countdown, newerBuild, pageVsServer, parseBuildInfo, releaseOf, runningLine, staleServerError, type OfficeVersionView } from '../src/shared/build-info.js';
import { BuildWatch } from '../src/server/restart/build.js';
import { audit } from '../src/server/audit/index.js';
import { resumeAfterRestart, SafeRestart, SLEPT_GAP_MS, type Busy, type RestartDeps } from '../src/server/restart/index.js';
import { pendingFile } from '../src/server/restart/index.js';
import { bannerFor, nextLookMs } from '../src/client/ui/version/logic.js';

const R45 = { sha: 'aaf30a5', release: 45, builtAt: 1_000_000 };
const R46 = { sha: 'b46b46b', release: 46, builtAt: 2_000_000 };

test('a build: its label, which is newer, the release a changelog is at, and what a stale server error says', () => {
  assert.equal(buildLabel(R45), 'release 45 (aaf30a5)');
  assert.equal(buildLabel({ sha: 'aaf30a5d00d' }), 'aaf30a5');
  assert.equal(newerBuild(R46, R45), true);
  assert.equal(newerBuild(R45, R46), false);
  assert.equal(newerBuild(R46, { sha: 'x' }), false, 'no build time: never claimed newer');
  assert.equal(pageVsServer(R46, R45), 'page-newer');
  assert.equal(pageVsServer(R45, R46), 'page-older');
  assert.equal(pageVsServer(R45, R45), 'same');
  assert.equal(pageVsServer(undefined, R45), 'same');
  assert.equal(releaseOf('# Changelog\r\n\r\n## Unreleased\r\n\r\nNothing.\r\n\r\n## 2026-10-14 · release 45 (`a`)\r\n\r\n## 2026-10-14 · release 44 (`b`)\r\n'), 45);
  assert.equal(releaseOf('## Unreleased'), undefined);
  // Entries under Unreleased: past that release, and the label says so.
  assert.deepEqual(releaseInfo('## Unreleased\r\n\r\nNothing waiting yet.\r\n\r\n## 2026-10-14 · release 45 (`a`)\r\n'), { release: 45 });
  assert.deepEqual(releaseInfo('## Unreleased\r\n\r\n### Fixed\r\n\r\n- A fix.\r\n\r\n## 2026-10-14 · release 45 (`a`)\r\n'), { release: 45, ahead: true });
  assert.equal(buildLabel({ sha: 'fc7a5a9', release: 45, ahead: true }), 'release 45+ (fc7a5a9)');
  assert.deepEqual(parseBuildInfo({ sha: 'abc', release: 45, ahead: true }), { sha: 'abc', release: 45, ahead: true });
  assert.deepEqual(parseBuildInfo({ sha: 'abc', release: 3, builtAt: 5, junk: 1 }), { sha: 'abc', release: 3, builtAt: 5 });
  assert.equal(parseBuildInfo({ release: 3 }), undefined);
  assert.equal(runningLine({ ...R45, startedAt: 7 }, () => '08:32'), 'Running release 45 (aaf30a5), started 08:32');
  assert.match(staleServerError(R46, R45, 'Unknown action'), /^This page is from release 46 \(b46b46b\), but the office server still runs release 45 \(aaf30a5\), which can't do this yet \(Unknown action\)\. Restart the office/);
  assert.match(staleServerError(R46, undefined, 'Not found'), /still runs an older build/);
  assert.equal(countdown(365_000), '6:05');
  assert.equal(countdown(-5), '0:00');
});

test('the build watch: what the office started on, and a newer build built under it', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'build-info-'));
  const file = path.join(dir, 'build-info.json');
  writeFileSync(file, JSON.stringify(R45));
  const w = new BuildWatch(file, () => ({ sha: 'fallback' }), 42);
  assert.deepEqual(w.running, { ...R45, startedAt: 42 });
  assert.equal(w.ready(), undefined, 'nothing newer yet');
  writeFileSync(file, JSON.stringify(R46));
  utimesSync(file, new Date(), new Date(Date.now() + 5_000));
  assert.deepEqual(w.ready(), R46, 'a rebuild (npm run build) under the running office');
  assert.deepEqual(w.running, { ...R45, startedAt: 42 }, 'what it runs never changes');

  // No build-info.json (a dev server, a test office's own pages): the checkout stands in, and no newer build is claimed.
  const none = new BuildWatch(path.join(dir, 'missing.json'), () => ({ sha: 'c0ffee1', release: 45 }), 7);
  assert.deepEqual(none.running, { sha: 'c0ffee1', release: 45, startedAt: 7 });
  assert.equal(none.ready(), undefined);
});

function stub(o: Partial<RestartDeps> = {}) {
  const clock = { now: 10_000_000 };
  const s = { busy: [] as Busy[], exits: [] as number[] };
  const deps: RestartDeps = {
    dataDir: mkdtempSync(path.join(os.tmpdir(), 'restart-truth-')),
    floors: () => ['a'],
    paused: () => false,
    pause: () => undefined,
    resume: async () => undefined,
    busy: () => s.busy,
    newCommits: () => false,
    build: async () => ({ ok: true, log: '' }),
    exit: (code) => void s.exits.push(code),
    loop: true,
    now: () => clock.now,
    builds: () => ({ running: { ...R45, startedAt: 5 }, ready: R46 }),
    ...o,
  };
  return { clock, s, deps, r: new SafeRestart(deps) };
}

test('Restart safely says what runs, a newer build ready, its countdown, and a computer asleep under it', async () => {
  const events: { action: string; summary: string }[] = [];
  const record = audit.record;
  audit.record = (e) => (events.push({ action: e.action, summary: e.summary }), undefined);
  try {
    const { clock, s, r } = stub();
    const idle = r.view(true);
    assert.deepEqual(idle.running, { ...R45, startedAt: 5 });
    assert.deepEqual(idle.ready, R46);
    assert.equal(idle.deadline, undefined, 'no countdown while idle');
    s.busy = [{ name: 'Dylan', floor: 'a', doing: 'mid-turn' }];
    r.start('Keith', { timeoutMin: 10 });
    clock.now += 1_000;
    await r.tick();
    const v = r.view(true);
    assert.equal(v.deadline, 10_000_000 + 10 * 60_000);
    assert.equal(v.now, clock.now);
    assert.deepEqual(v.waitingOn, ['Dylan: mid-turn']);
    assert.equal(v.slept, undefined);
    // The computer goes to sleep for 34 minutes (Modern Standby, 13 Oct 2026, 19:50–20:24).
    const before = clock.now;
    clock.now += 34 * 60_000;
    await r.tick();
    assert.deepEqual(r.view(true).slept, { from: before, to: clock.now });
    assert.ok(34 * 60_000 >= SLEPT_GAP_MS);
    assert.match(events.find((e) => e.action === 'restart.slept')?.summary ?? '', /couldn't move for 34 min: the computer slept or the office froze \(waiting on Dylan: mid-turn\)/);
    assert.equal(r.phase, 'timed-out', 'past its limit, it asks');
    s.busy = [];
    clock.now += 1_000;
    await r.tick();
    assert.equal(r.phase, 'exiting');
    assert.match(events.find((e) => e.action === 'restart.exiting')?.summary ?? '', /^Restarting the office \(it ran release 45 \(aaf30a5\)\)$/);
    assert.equal(r.view(true).deadline, undefined, 'no countdown once it exits');
  } finally {
    audit.record = record;
  }
});

test('Restart anyway is there while it waits, before the time limit too', async () => {
  const { s, r } = stub();
  s.busy = [{ name: 'Dylan', floor: 'a', doing: 'mid-turn' }];
  r.start('Keith');
  await r.tick();
  assert.equal(r.phase, 'waiting');
  const record = audit.record;
  audit.record = () => undefined;
  try {
    assert.equal(await r.choose('anyway'), undefined);
  } finally {
    audit.record = record;
  }
  assert.equal(r.phase, 'exiting');
  assert.deepEqual(s.exits, [75]);
});

test('the next office says what it runs now as it resumes the floors', async () => {
  const { deps } = stub();
  writeFileSync(pendingFile(deps.dataDir), JSON.stringify({ floors: ['a'], by: 'Keith', at: 1 }));
  const said: string[] = [];
  const chatter: string[] = [];
  const record = audit.record;
  audit.record = (e) => (said.push(e.summary), undefined);
  try {
    await resumeAfterRestart({ ...deps, builds: () => ({ running: { ...R46, startedAt: 9 } }), pausedForRestart: () => true, chatter: (_f, t) => void chatter.push(t) });
  } finally {
    audit.record = record;
  }
  assert.deepEqual(said, ['Back from the safe restart, now running release 46 (b46b46b): resumed 1 project']);
  assert.deepEqual(chatter, ['🔁 The office is back from its safe restart, on release 46 (b46b46b): resuming this project.']);
});

const view = (o: Partial<OfficeVersionView> = {}): OfficeVersionView => ({ running: { ...R45, startedAt: new Date().setHours(8, 32, 0, 0) }, admin: true, loop: true, now: Date.now(), ...o });

test('the version banner: a restart under way first, then a page newer or older than its server, a restart done, a newer build ready', () => {
  // A restart waiting on agents: whom, the countdown, Restart anyway (admins).
  const now = Date.now();
  const waiting = bannerFor({ view: view({ restart: { phase: 'waiting', waitingOn: ['Dylan: mid-turn'], deadline: now + 365_500 } }) }, R45);
  assert.equal(waiting?.kind, 'restart');
  assert.match(waiting?.text ?? '', /^🔁 Restart under way, not done yet: waiting on 1: Dylan: mid-turn\. It asks what to do in 6:0[56]\.$/);
  assert.deepEqual(waiting?.actions, ['anyway', 'settings']);
  const late = bannerFor({ view: view({ restart: { phase: 'timed-out', waitingOn: ['Dylan: mid-turn'], deadline: now - 60_000 } }) }, R45);
  assert.match(late?.text ?? '', /1:0[01] past its time limit/);
  assert.equal(late?.tone, 'warn');
  const someone = bannerFor({ view: view({ admin: false, restart: { phase: 'waiting', waitingOn: ['Dylan: mid-turn'] } }) }, R45);
  assert.deepEqual(someone?.actions, [], 'only admins act on it');
  assert.equal(nextLookMs({ view: view({ restart: { phase: 'waiting', waitingOn: [] } }) }), 2_000);
  assert.equal(nextLookMs({ view: view() }), 60_000);

  // Rebuilt, not restarted: the page is newer than its server.
  const stale = bannerFor({ view: view() }, R46);
  assert.equal(stale?.kind, 'stale-server');
  assert.match(stale?.text ?? '', /^This page is from release 46 \(b46b46b\), but the office server still runs release 45 \(aaf30a5\) \(started 08:32\): new actions fail until it restarts\. Restart safely to bring the server up to it\.$/);
  assert.match(bannerFor({ view: view({ admin: false }) }, R46)?.text ?? '', /Ask an admin to restart the office\.$/);
  assert.equal(bannerFor({ missing: true }, R46)?.kind, 'stale-server', 'an office from before the version route is older than the page');

  // Restarted, not reloaded.
  assert.equal(bannerFor({ view: view({ running: { ...R46, startedAt: 9 } }) }, R45)?.kind, 'reload');

  // Back from a restart: said once, by the new office.
  const back = bannerFor({ view: view() }, R45, { restartedFrom: 1 });
  assert.equal(back?.kind, 'restarted');
  assert.equal(back?.text, 'Restarted: now running release 45 (aaf30a5), started 08:32.');

  // A newer build ready: admins hear it; a page from the running build gets nothing else.
  assert.match(bannerFor({ view: view({ ready: R46 }) }, R45)?.text ?? '', /^A newer build is ready \(release 46 \(b46b46b\)\)\. Restart safely to use it\.$/);
  assert.equal(bannerFor({ view: view({ ready: R46, admin: false }) }, R45), undefined);
  assert.match(bannerFor({ view: view({ ready: R46, loop: false }) }, R45)?.text ?? '', /Restart the office to use it\./);
  assert.equal(bannerFor({ view: view() }, R45), undefined);
});

test('rollback-with-unresolved-operation (Restart safely): a build on disk older than unsettled dispatch records is not restarted onto', async () => {
  assert.equal(parseBuildInfo({ sha: 'abc1234', dispatchSchema: 1 })?.dispatchSchema, 1);
  assert.equal(parseBuildInfo({ sha: 'abc1234' })?.dispatchSchema, undefined, 'release 47 builds have none');
  const record = audit.record;
  audit.record = () => undefined;
  try {
    const { s, r } = stub({ dispatchGuard: () => 'The build on disk (release 47 (3055d0e)) predates durable dispatch (schema 0 < 1) and 2 answer dispatches are unsettled' });
    r.start('Keith', { timeoutMin: 10 });
    await r.tick();
    assert.equal(r.phase, 'failed');
    assert.deepEqual(s.exits, [], 'the office keeps running');
    assert.match(r.view(true).error ?? '', /predates durable dispatch .* Cancel resumes the projects it paused/);
    const ok = stub({ dispatchGuard: () => undefined });
    ok.r.start('Keith', { timeoutMin: 10 });
    await ok.r.tick();
    assert.equal(ok.r.phase, 'exiting');
  } finally {
    audit.record = record;
  }
});
