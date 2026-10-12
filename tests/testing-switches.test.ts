// Release 39's Testing safety switches (server/testing/switches.ts, docs/site/using-the-office/testing.md):
// with fresh office data both are off, so the board's PR polls and main moving make no main-branch gh
// calls, raise no verification Needs you items and start no automatic quality run. Judging, once turned
// on, judges only PRs merged after that moment. Every change is audited. Fakes only: an injected gh
// runner that only counts, a local git folder with no remote, no mxcli, no GitHub, no agents.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { GhPull, WorkerInfo } from '../src/shared/protocol.js';
import type { AuditEvent } from '../src/shared/audit.js';
import { cleanSwitches } from '../src/shared/testing/switches.js';
import { IMPORTER_VERSION, type TestRunDraft } from '../src/shared/testing/record.js';
import { Roster } from '../src/server/roster/index.js';
import type { HireAsk, TeamFloor } from '../src/server/roster/types.js';
import { testingStore } from '../src/server/testing/index.js';
import { verifyOnPulls } from '../src/server/testing/verify-office.js';
import { mergedAtOf, setTestingSwitches, testingSwitches } from '../src/server/testing/switches.js';
import { qualityPart, qualityStore } from '../src/server/testing/mxcli-office.js';
import { AuditLog, useAudit } from '../src/server/audit/index.js';
import { closeConnections, officeSettings } from '../src/server/connections/store.js';
import { routes } from '../src/server/http/routes/index.js';
import type { Ctx } from '../src/server/office/context.js';
import type { Floor } from '../src/server/floor.js';

const OLD_MERGE = 'b'.repeat(40);
const NEW_MERGE = 'c'.repeat(40);

class FakeTeam implements TeamFloor {
  id = `switch-${Math.random().toString(36).slice(2, 8)}`;
  name = 'switches-test';
  dir = mkdtempSync(path.join(os.tmpdir(), 'switch-team-'));
  map = new Map<string, WorkerInfo>();
  typed: string[] = [];
  private n = 0;
  workers = () => [...this.map.values()];
  worker = (id: string) => this.map.get(id);
  async hire(ask: HireAsk): Promise<WorkerInfo> {
    const id = `w${++this.n}`;
    const w = { id, kind: 'agent', provider: 'claude', deskId: 'd', name: ask.name, color: '#fff', status: 'idle', acked: true, createdBy: ask.by, createdAt: 0, cols: 80, rows: 24, viewers: [], viewerIds: [], worktree: { path: `wt/${id}`, branch: 'feat/orders', base: 'main' } } as unknown as WorkerInfo;
    this.map.set(id, w);
    mkdirSync(path.join(this.dir, 'wt', id), { recursive: true });
    return w;
  }
  async stop(id: string) {
    this.map.delete(id);
  }
  prompt(_id: string, text: string) {
    this.typed.push(text);
    return undefined;
  }
  wake() {
    return undefined;
  }
  rename() {}
  cwdOf = (w: WorkerInfo) => path.join(this.dir, 'wt', w.id);
  openPulls = () => [];
  pulls = () => [];
  toast = () => {};
  changed = () => {};
  activity = () => {};
}

/** A failed pr-checks run on a merge commit: judging it would raise "Merged, not verified". */
const failedOn = (rev: string, n: number): TestRunDraft => ({
  source: 'pr-checks',
  sourceKey: `main-run:${n}`,
  suite: 'pr-checks',
  testedRevision: rev,
  definitionRevision: rev,
  evidence: { kind: 'ci-run', revision: `run ${n}`, locator: 'x' },
  results: [{ name: 'pr-checks', status: 'failed', links: [] }],
  conclusion: 'failed',
  links: [],
  actor: { kind: 'ci', name: 'pr-checks' },
  importer: IMPORTER_VERSION,
});

async function office() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'switches-'));
  const dataDir = path.join(root, 'data');
  const repo = path.join(root, 'floor');
  mkdirSync(repo, { recursive: true });
  const g = (...a: string[]) => execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'core.autocrlf=false', ...a], { cwd: repo, stdio: 'pipe' }).toString().trim();
  g('init', '-q', '-b', 'main');
  g('commit', '-q', '--allow-empty', '-m', 'first');
  // origin/main without a remote: main moves by moving this ref, nothing ever leaves the machine.
  const moveMain = () => {
    g('commit', '-q', '--allow-empty', '-m', `next ${Date.now()}`);
    g('update-ref', 'refs/remotes/origin/main', 'HEAD');
  };
  g('update-ref', 'refs/remotes/origin/main', 'HEAD');
  const team = new FakeTeam();
  const clock = { now: Date.UTC(2026, 9, 13, 8) };
  const roster = new Roster({ dataDir, floors: () => [team], makeIssue: async () => ({ number: 2 }), analysis: () => '', now: () => clock.now }, 0);
  assert.equal(await roster.members.hire(team, 'lead-developer', 'Keith', undefined, 'build the Orders module (issue #5)'), undefined);
  const t = () => roster.data(team.id).members['lead-developer'].task!;
  // Merged a week ago and settled as integrated (step 2), with a failed run on its merge commit.
  Object.assign(t(), { doneAt: Date.UTC(2026, 9, 6), doneWhy: 'PR #21 merged', outcome: 'integrated', pr: 21, v: 2 });
  await testingStore(dataDir, team.id).ingest([failedOn(OLD_MERGE, 1), failedOn(NEW_MERGE, 2)]);
  const pulls: GhPull[] = [{ number: 21, state: 'MERGED', title: 'Orders', url: 'https://github.com/o/r/pull/21', body: '', headRefOid: 'a'.repeat(40), mergeCommit: OLD_MERGE, mergedAt: '2026-10-06T09:00:00Z', headRefName: 'feat/orders', updatedAt: '2026-10-06T09:00:00Z' } as GhPull];
  const gh = { pulls: { items: pulls, fetchedAt: 0, loading: false } };
  const floor = { id: team.id, dir: repo, def: { name: 'switches', repo: 'o/r' }, workers: { list: () => team.workers() }, github: gh } as unknown as Floor;
  const ctx = { cfg: { dataDir } } as unknown as Ctx;
  const ghCalls: string[][] = [];
  let mxLooks = 0;
  const deps = {
    runner: () => async (args: string[]) => {
      ghCalls.push(args);
      return '[]';
    },
    roster,
    team,
    mx: {
      tool: async () => {
        mxLooks++;
        return { why: 'the test has no mxcli' };
      },
    },
  };
  /** The board's PR poll came back (floors.ts pullsChanged), optionally after main moved. */
  const poll = async (move = false) => {
    if (move) moveMain();
    gh.pulls.fetchedAt++;
    await verifyOnPulls(ctx, floor, deps);
  };
  const asks = () => roster.data(team.id).escalations.filter((e) => e.status === 'open');
  const events: AuditEvent[] = [];
  useAudit(new AuditLog(path.join(root, 'audit')), (e) => events.push(e));
  const done = () => {
    useAudit(undefined);
    closeConnections();
    roster.stop();
    rmSync(root, { recursive: true, force: true });
    rmSync(team.dir, { recursive: true, force: true });
  };
  return { dataDir, floor, team, roster, t, pulls, poll, asks, ghCalls, mxLooks: () => mxLooks, events, clock, done };
}

test('defaults (fresh office data): PR polls and main moving make no gh calls, raise no Needs you item and start no quality run', async () => {
  const o = await office();
  try {
    assert.deepEqual(officeSettings(), {}, 'fresh office data');
    assert.deepEqual(testingSwitches(), { judge: false, autoScore: false });
    for (let i = 0; i < 5; i++) await o.poll(i % 2 === 1);
    assert.equal(o.ghCalls.length, 0, 'no main-branch checks fetch');
    assert.equal(o.asks().length, 0, 'no verification Needs you item');
    assert.equal(o.t().verify, undefined, 'the merged task keeps its step-2 outcome');
    assert.equal(o.t().outcome, 'integrated');
    assert.equal(o.mxLooks(), 0, 'mxcli not even looked for: no automatic quality run');
    // The Testing view's GET (the other trigger): no automatic run either, and the card says so.
    const part = await qualityPart(o.dataDir, o.floor as never, true, { tool: async () => ({ bin: path.join(o.dataDir, 'no-such-mxcli.exe'), version: 'fake-1' }) });
    assert.equal(part.auto, false);
    assert.equal(part.runs.quality.running, false);
    assert.equal((await qualityStore(o.dataDir, o.floor.id).all()).length, 0);
    assert.equal(o.events.filter((e) => e.action === 'testing.quality').length, 0, 'no quality run started');
    assert.equal(o.events.filter((e) => e.action === 'escalation.raise').length, 0);
  } finally {
    o.done();
  }
});

test('judging turned on judges only PRs merged after that moment; each switch change is audited', async () => {
  const o = await office();
  try {
    const on = Date.UTC(2026, 9, 13, 9);
    assert.match(String(setTestingSwitches({ judge: 'yes' }, { name: 'Ann' })), /judge: true\|false/, 'only booleans');
    const sw = setTestingSwitches({ judge: true }, { name: 'Ann', accountId: 'acc1' }, on);
    assert.ok(typeof sw !== 'string');
    assert.deepEqual([sw.judge, sw.judgeSince, sw.autoScore], [true, on, false]);
    const ev = o.events.filter((e) => e.action === 'settings.change');
    assert.equal(ev.length, 1, 'audited');
    assert.equal(ev[0].target.id, 'testing.judge');
    assert.equal(ev[0].actor.name, 'Ann');
    assert.match(ev[0].summary, /Turned on "Judge merged tasks against checks" \(Ann\): only pull requests merged from now on are judged/);
    // The same value again: no change, nothing audited.
    setTestingSwitches({ judge: true }, { name: 'Bob' }, on + 5);
    assert.equal(testingSwitches().judgeSince, on, 'the stamp stays');
    assert.equal(o.events.filter((e) => e.action === 'settings.change').length, 1);

    // The old merge (a week before): never judged, no item, though its merge commit failed.
    await o.poll(true);
    assert.equal(o.ghCalls.length, 2, 'judging on: the bounded main-branch checks fetch runs');
    assert.equal(o.t().verify, undefined, 'merged before judging was on: not judged');
    assert.equal(o.asks().length, 0);
    // A new task merges after the switch: judged, one "Merged, not verified" item.
    Object.assign(o.t(), { text: 'build the Orders page (issue #6)', issue: 6, doneAt: on + 60_000, doneWhy: 'PR #22 merged', pr: 22 });
    o.pulls.push({ ...o.pulls[0], number: 22, url: 'https://github.com/o/r/pull/22', mergeCommit: NEW_MERGE, mergedAt: new Date(on + 30_000).toISOString() });
    await o.poll();
    assert.equal(o.t().verify?.state, 'not-verified');
    assert.equal(o.asks().length, 1);
    assert.match(o.asks()[0].title, /PR #22 merged, not verified/);
    await o.poll(true);
    assert.equal(o.asks().length, 1, 'once');

    // Auto-scoring on and off: audited as well; off again, judging stops and nothing is fetched.
    setTestingSwitches({ autoScore: true }, { name: 'Ann' });
    await o.poll(true);
    assert.ok(o.mxLooks() >= 1, 'on: the pulls hook looks for mxcli for the new main commit');
    const calls = o.ghCalls.length;
    setTestingSwitches({ judge: false, autoScore: false }, { name: 'Ann' });
    const looks = o.mxLooks();
    await o.poll(true);
    assert.equal(o.ghCalls.length, calls, 'off: no more gh calls');
    assert.equal(o.mxLooks(), looks, 'off: no automatic quality run');
    assert.equal(testingSwitches().judgeSince, undefined);
    assert.deepEqual(
      o.events.filter((e) => e.action === 'settings.change').map((e) => [e.target.id, (e.details as { after: { on: boolean } }).after.on]),
      [['testing.judge', true], ['testing.autoScore', true], ['testing.judge', false], ['testing.autoScore', false]],
    );
  } finally {
    o.done();
  }
});

test('the switches read as off unless saved on; the merge time falls back to when the office saw it; the routes are signed-in', () => {
  assert.deepEqual(cleanSwitches(undefined), { judge: false, autoScore: false });
  assert.deepEqual(cleanSwitches({ judge: 'true', autoScore: 1, judgeSince: 5 }), { judge: false, autoScore: false });
  assert.deepEqual(cleanSwitches({ judge: true, judgeSince: 5, autoScore: true }), { judge: true, judgeSince: 5, autoScore: true });
  assert.equal(mergedAtOf({ mergedAt: '2026-10-13T09:00:00Z' }, 1), Date.UTC(2026, 9, 13, 9));
  assert.equal(mergedAtOf({}, 7), 7);
  assert.equal(mergedAtOf(undefined, undefined), undefined);
  for (const method of ['GET', 'POST']) assert.ok(routes.some((r) => 'path' in r && r.path === '/api/testing/switches' && r.method === method && r.auth === 'session'), method);
});
