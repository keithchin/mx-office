// The live app follows main through the project's own folder, never by asking GitHub itself (a private
// repo gave the live clone no credentials, and it silently never updated: a migration project, release 56); a
// refresh that can't fetch is said on the state and in Needs you; an app that stops by itself is a crash
// with its time and last lines; and the office's live apps read what the running build has (milestones,
// main ahead of it), event-driven, and tell a milestone ready once. Synthetic repos and a fake mxcli.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { LiveApp } from '../src/server/liveapp/app.js';
import { LIVE_APP_DEFAULTS } from '../src/server/liveapp/config.js';
import { LiveApps } from '../src/server/liveapp/index.js';
import { readReadiness } from '../src/server/liveapp/readiness.js';
import { originNews } from '../src/server/floor-sync/bus.js';
import { testingStore } from '../src/server/testing/index.js';
import { commitLine, liveNeeds } from '../src/shared/liveapp/status.js';
import { isRedNeed } from '../src/shared/notify-teams.js';
import type { LiveAppState } from '../src/shared/protocol.js';
import type { Floor } from '../src/server/floor.js';
import { PLAN } from './fixtures/liveapp/plan.js';

const tmp = () => mkdtempSync(path.join(tmpdir(), 'liveapp-r-'));
const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'core.autocrlf=false', ...args], { cwd, encoding: 'utf8' }).trim();

/** Stands in for `mxcli run --local …`: serves --app-port; with crash.txt in the project it says what mxcli says when the runtime dies, and exits. */
const FAKE_MXCLI = `const fs = require('fs');
const port = Number(process.argv[process.argv.indexOf('--app-port') + 1]);
require('http').createServer((q, s) => s.end('fake app')).listen(port, () => console.log('App is running at http://127.0.0.1:' + port + '/'));
if (fs.existsSync('crash.txt')) setTimeout(() => { console.log('Error: the app stopped: the Mendix runtime is no longer running'); process.exit(1); }, 4500);`;

async function until(what: string, fn: () => boolean, ms = 30_000) {
  const end = Date.now() + ms;
  while (!fn()) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 100));
  }
}

/** origin (the "GitHub" repo) with an app, and the floor's folder cloned from it. */
function repos(dir: string) {
  const origin = path.join(dir, 'origin');
  mkdirSync(origin);
  git(origin, 'init', '-q', '-b', 'main');
  writeFileSync(path.join(origin, 'App.mpr'), '');
  writeFileSync(path.join(origin, 'run'), FAKE_MXCLI);
  git(origin, 'add', '.');
  git(origin, 'commit', '-q', '-m', 'Starter app');
  const floorDir = path.join(dir, 'floor');
  git(dir, 'clone', '-q', origin, floorDir);
  return { origin, floorDir };
}

const commit = (repo: string, file: string, text: string, msg: string) => {
  mkdirSync(path.dirname(path.join(repo, file)), { recursive: true });
  writeFileSync(path.join(repo, file), text);
  git(repo, 'add', '.');
  git(repo, 'commit', '-q', '-m', msg);
  return git(repo, 'rev-parse', 'HEAD');
};

function liveApp(dir: string, floorDir: string, ports: { from: number; to: number }, states: LiveAppState[] = []) {
  return new LiveApp({ cfg: { ...LIVE_APP_DEFAULTS, ports, readyTimeoutMs: 30_000 }, mxcli: process.execPath, floorId: 'demo', floorDir, liveDir: path.join(dir, 'live'), taken: () => new Set(), changed: (s) => states.push(s) });
}

test('refresh: an old live clone pointed at an unreachable GitHub follows main through the floor folder; a failed fetch is said, not only logged', { timeout: 120_000 }, async () => {
  const dir = tmp();
  const { origin, floorDir } = repos(dir);
  // A live clone made by an older office: its origin is the private GitHub URL it can't reach.
  mkdirSync(path.join(dir, 'live'));
  git(dir, 'clone', '-q', '--no-checkout', floorDir, path.join(dir, 'live', 'demo'));
  git(path.join(dir, 'live', 'demo'), 'remote', 'set-url', 'origin', 'https://github.invalid/private/repo.git');
  const app = liveApp(dir, floorDir, { from: 8120, to: 8139 });
  try {
    await app.start('Probe');
    await until('running', () => app.status === 'running');
    assert.equal(path.resolve(git(path.join(dir, 'live', 'demo'), 'remote', 'get-url', 'origin')), path.resolve(floorDir), 'pointed back at the floor folder');
    assert.equal(app.state.started, true);
    assert.ok(app.state.commitAt && app.state.builtAt, 'when the commit was made and when the build came up');

    // A PR merged on "GitHub": the poll has the floor folder fetch it (no credentials of the live clone's), then follows.
    const second = commit(origin, 'version.txt', 'two', 'Merge pull request #8');
    await app.poll();
    await until('running on the new main', () => app.status === 'running' && app.state.sha === second);
    assert.deepEqual(app.state.refresh && { ok: app.state.refresh.ok, error: app.state.refresh.error }, { ok: true, error: undefined });
    assert.equal(app.state.by, 'auto-refresh');

    // The floor folder can't reach its remote any more: said on the state and in Needs you, the app left running.
    git(floorDir, 'remote', 'set-url', 'origin', path.join(dir, 'gone'));
    await app.poll();
    assert.equal(app.status, 'running');
    assert.equal(app.state.refresh?.ok, false);
    assert.match(app.state.refresh?.error ?? '', /gone|not appear to be a git repository|does not exist/i);
    const rows = liveNeeds(app.state, 'demo');
    assert.equal(rows.length, 1);
    assert.match(rows[0].text, new RegExp(`^Live app can't check for updates: .+ \\(running main @${second.slice(0, 7)} from `));
    assert.equal(rows[0].level, 'info');
  } finally {
    await app.stop('Probe');
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
  }
});

test('crash: an app that was running and stops by itself is "stopped (crashed at …)" with mxcli’s last words, and a red Needs-you row', { timeout: 120_000 }, async () => {
  const dir = tmp();
  const { origin, floorDir } = repos(dir);
  commit(origin, 'crash.txt', 'yes', 'A build whose runtime dies');
  git(floorDir, 'pull', '-q');
  const states: LiveAppState[] = [];
  const app = liveApp(dir, floorDir, { from: 8140, to: 8149 }, states);
  try {
    await app.start('Probe');
    await until('running', () => app.status === 'running');
    await until('stopped by itself', () => app.status === 'failed', 20_000);
    const f = app.state.failure!;
    assert.equal(f.kind, 'crash');
    assert.match(f.why, /^the app stopped: the Mendix runtime is no longer running \(mxcli exited, code 1\)$/);
    assert.ok(f.lines.some((l) => /the Mendix runtime is no longer running/.test(l)), 'the last lines are kept with it');
    assert.equal(f.sha, app.state.sha);
    assert.match(app.state.message ?? '', /^The app stopped by itself: /);
    const rows = liveNeeds(app.state, 'demo');
    assert.equal(rows[0].key, `live-crash@${f.at}`);
    assert.equal(isRedNeed(rows[0]), true);
  } finally {
    await app.stop('Probe');
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
  }
});

test('readiness at git level: rows in the running commit, merged to main, only on a branch with its PR; commits behind', { timeout: 60_000 }, async () => {
  const dir = tmp();
  const { origin, floorDir } = repos(dir);
  try {
    commit(origin, 'architecture/build-plan.md', PLAN, 'Stage 4: build plan');
    commit(origin, 'mdlsource/seed/labels.json', '{}', 'Row 4: bilingual definition labels file');
    const live = commit(origin, 'mdlsource/1-frame/01-frame.mdl', 'x', 'Rows 6-8: frame, domain and stubs applied');
    commit(origin, 'mdlsource/3-sheet/07.mdl', 'x', 'Row 19: save/submit microflows applied');
    commit(origin, 'docs/journal.md', 'x', 'Journal: row 20 next');
    git(origin, 'checkout', '-q', '-b', 'office/pixel-b1e9');
    commit(origin, 'mdlsource/3-sheet/08.mdl', 'x', 'Row 20: sheet pages applied');
    commit(origin, 'mdlsource/4-approval/09.mdl', 'x', 'Draft row 23 approval microflows');
    git(origin, 'checkout', '-q', 'main');
    git(floorDir, 'fetch', '-q', 'origin');
    const pulls = [{ number: 6, headRefName: 'office/pixel-b1e9', state: 'OPEN', isDraft: false }] as never;
    const got = await readReadiness({ dataDir: dir, floorId: 'demo', floorDir, live, running: true, pulls });
    assert.equal(got.main?.behind, 2);
    const by = Object.fromEntries(got.readiness!.milestones.map((m) => [m.id, m]));
    assert.deepEqual([by['phase-0'].state, by['phase-0'].inLive], ['ready', [4]]);
    assert.deepEqual([by['phase-1'].state, by['phase-1'].inLive], ['ready', [6, 7, 8]], 'no journey at main tied to it');
    assert.deepEqual([by['phase-3'].onMain, by['phase-3'].onBranch], [[19], [{ branch: 'office/pixel-b1e9', pr: 6, rows: [20] }]]);
    assert.match(by['phase-3'].line, /row 19 merged to main, not in the live app yet; row 20 in PR #6, open, not merged/);
    assert.deepEqual(by['phase-4'].missing, [23, 24], 'a draft is not evidence');
    assert.equal(commitLine({ floor: 'demo', status: 'running', log: [], available: true, sha: live, branch: 'main', main: got.main }).replace(/ from .*? ·/, ' ·'), `main @${live.slice(0, 7)} · 2 commits behind main @${got.main!.sha.slice(0, 7)}`);
    // A commit the folder doesn't have: said, not guessed.
    const unknown = await readReadiness({ dataDir: dir, floorId: 'demo', floorDir, live: 'f'.repeat(40), running: true, pulls: [] });
    assert.match(unknown.readiness?.note ?? '', /isn't in the project's folder/);
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
  }
});

test('the office’s live apps: event-driven readings, ready only after the journey passed on this build, told once, follow a fetch', { timeout: 120_000 }, async () => {
  const dir = tmp();
  const { origin, floorDir } = repos(dir);
  const dataDir = path.join(dir, 'data');
  mkdirSync(dataDir);
  writeFileSync(path.join(dataDir, 'live-app.json'), JSON.stringify({ mxcli: process.execPath, ports: '8170-8189' }));
  commit(origin, 'architecture/build-plan.md', PLAN, 'Stage 4: build plan');
  commit(origin, 'tests/e2e/skeleton.journey.json', JSON.stringify({ id: 'skeleton', requirement: ['build-plan row 10'] }), 'Walking skeleton journey');
  commit(origin, 'tests/e2e/skeleton-broken.journey.json', JSON.stringify({ id: 'skeleton-broken', requirement: ['build-plan row 10'] }), 'Its broken control');
  commit(origin, 'mdlsource/seed/labels.json', '{}', 'Row 4: labels file');
  commit(origin, 'mdlsource/1-frame/01.mdl', 'x', 'Rows 6-8 applied');
  git(floorDir, 'pull', '-q');
  const floor = { id: 'demo', dir: floorDir, github: { pulls: { items: [] } } } as unknown as Floor;
  const sent: LiveAppState[] = [];
  const toasts: string[] = [];
  const ctx = { cfg: { dataDir }, floors: new Map([['demo', floor]]), toFloor: (_f: Floor, m: { t: string; state: LiveAppState }) => sent.push(m.state), toastFloor: (_f: Floor | undefined, text: string) => toasts.push(text) };
  const apps = new LiveApps(ctx as never);
  const app = apps.of(floor);
  try {
    await app.start('Probe');
    await until('running', () => app.status === 'running');
    await until('read', () => !!apps.peek('demo')?.readiness?.sha);
    await apps.settled('demo');
    let r = apps.peek('demo')!.readiness!;
    assert.equal(r.milestones.find((m) => m.id === 'phase-0')!.state, 'ready');
    assert.equal(r.milestones.find((m) => m.id === 'phase-1')!.state, 'unverified', 'the skeleton journey has not run against this build');
    assert.deepEqual(r.milestones.find((m) => m.id === 'phase-1')!.journeys, [{ id: 'skeleton', result: 'not-run' }], 'the broken control is not a journey to pass');
    assert.deepEqual(toasts, ['✅ Live app ready: Prerequisites. Try it on the Live app tab']);
    assert.ok(sent.at(-1)?.readiness, 'the floor was told');

    // Test evidence for exactly this build lands: read again (no polling), ready, told once.
    const sha = app.state.sha!;
    const draft = (key: string) => ({ source: 'report-file' as const, sourceKey: key, suite: 'journey skeleton', testedRevision: sha, definitionRevision: sha, evidence: { kind: 'office' as const, revision: sha, locator: 'office:test' }, results: [{ name: 'skeleton', status: 'passed' as const, links: [] }], links: [], actor: { kind: 'office' as const, name: 'test' }, importer: 'test' });
    await testingStore(dataDir, 'demo').ingest([draft('k1')]);
    await until('phase 1 ready', () => apps.peek('demo')?.readiness?.milestones.find((m) => m.id === 'phase-1')?.state === 'ready', 10_000);
    await testingStore(dataDir, 'demo').ingest([draft('k2')]);
    await new Promise((res) => setTimeout(res, 800));
    await apps.settled('demo');
    assert.deepEqual(toasts.filter((t) => /Frame, domain and skeleton/.test(t)), ['✅ Live app ready: Frame, domain and skeleton. Try it on the Live app tab'], 'once');
    r = apps.peek('demo')!.readiness!;
    assert.deepEqual(r.news?.map((n) => n.milestone), ['phase-0', 'phase-1'], 'the day’s news, for Needs you');

    // Main moves and the floor folder's fetch lands: behind is said, then the app follows the fetch by itself.
    const next = commit(origin, 'version.txt', 'two', 'Merge pull request #9');
    git(floorDir, 'fetch', '-q', 'origin');
    apps.schedule('demo');
    await apps.settled('demo');
    assert.equal(apps.peek('demo')!.main?.behind, 1);
    originNews(floorDir, 'fetched');
    await until('running on the fetched main', () => app.status === 'running' && app.state.sha === next, 60_000);
    await apps.settled('demo');
    await until('read again', () => apps.peek('demo')?.main?.behind === 0, 10_000);
    // A new build: its journeys haven't run against it, so phase 1 is unverified again, not "unready" news.
    assert.equal(apps.peek('demo')!.readiness!.milestones.find((m) => m.id === 'phase-1')!.state, 'unverified');
    assert.equal(toasts.length, 2);

    // A restart of the office: nothing told again.
    const again = new LiveApps({ ...ctx } as never);
    assert.equal(again.stateOf(floor).status, 'stopped');
    await again.settled('demo');
    await again.shutdown();
  } finally {
    await apps.shutdown();
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
  }
});
