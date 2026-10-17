// The live app's readiness by milestone (shared/liveapp/): the build plan's phases as milestones, row
// evidence from commits (never the plan's State column), which milestones are in the running build,
// merged but not in it, only in a PR, and "ready" only once a journey passed against that very build;
// the honest status words; and the Needs-you rows and which of them reach the notification channels.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRowsOf, parseJourney, parsePlan } from '../src/shared/liveapp/plan.js';
import { buildLogRows, commitRows, rowRanges, rowsIn, rowsWithEvidence } from '../src/shared/liveapp/rows.js';
import { computeReadiness, readinessNews, type ReadinessInput } from '../src/shared/liveapp/readiness.js';
import { commitLine, liveNeeds, liveStatus } from '../src/shared/liveapp/status.js';
import { isRedNeed } from '../src/shared/notify-teams.js';
import { collectNeeds, hereCount } from '../src/client/ui/needsyou/logic.js';
import type { LiveAppState } from '../src/shared/protocol.js';
import { PLAN } from './fixtures/liveapp/plan.js';

test('the plan: phases with their numbered rows, the goal from its title, BUILD rows as what the app needs', () => {
  const p = parsePlan(PLAN);
  assert.equal(p.goal, 'PackTrack Line 7 demo (Checksheet)');
  assert.deepEqual(
    p.phases.map((x) => [x.id, x.title, x.rows.map((r) => r.n)]),
    [
      ['phase-0', 'Prerequisites', [1, 3, 4]],
      ['phase-1', 'Frame, domain and skeleton', [6, 7, 8, 10]],
      ['phase-3', 'Save, submit and My check sheets', [19, 20, 21]],
      ['phase-4', 'Approval, history and demo data', [23, 24]],
    ],
  );
  assert.deepEqual(buildRowsOf(p.phases[1]), [6, 7, 8], 'HARNESS, PROVE and BRIEF rows change nothing in the app');
  assert.deepEqual(parsePlan('no tables here').phases, []);
});

test('row evidence: commit subjects that applied or proved a row, never a draft or a journal line', () => {
  assert.deepEqual(rowsIn('Rows 19-21: browser walk'), [19, 20, 21]);
  assert.deepEqual(rowsIn('Row 20b polish and rows 3, 5 and 7'), [3, 5, 7, 20]);
  assert.deepEqual(commitRows({ subject: 'Row 8: stubs and navigation applied', files: [] }), [8]);
  assert.deepEqual(commitRows({ subject: 'Row 16: sheet form', files: ['mdlsource/2-form/06-page-sheet-form.mdl'] }), [16], 'a build file counts');
  assert.deepEqual(commitRows({ subject: 'Draft row 13 seed definition (generated)', files: ['mdlsource/x.mdl'] }), []);
  assert.deepEqual(commitRows({ subject: 'Journal: row 3 probe check results', files: [] }), []);
  assert.deepEqual(commitRows({ subject: 'Row 25 test plan', files: ['docs/test-plan.md'] }), [], 'naming a row is not building it');
  assert.deepEqual(buildLogRows('### 2026-10-16 — Row 11 (design reaches app), read by hand\n| 2026-10-16T15:45 | `01-frame.mdl` | pass | ✅ applied | x |'), [11]);
  assert.deepEqual([...rowsWithEvidence([{ subject: 'Row 14: seed proven by OQL read-back', files: [] }], '### 2026-10-16 — Row 11 x')].sort(), [11, 14]);
  assert.equal(rowRanges([3, 4, 5, 7, 9, 10]), '3–5, 7, 9–10');
});

const journey = parseJourney('tests/e2e/skeleton.journey.json', JSON.stringify({ id: 'skeleton', title: 'demo_operator signs in', requirement: ['build-plan row 10'] }))!;
const fillSubmit = parseJourney('tests/e2e/op-fill-submit.journey.json', JSON.stringify({ id: 'op-fill-submit', requirement: ['UC-01', 'UC-03'] }))!;

const base = (o: Partial<ReadinessInput> = {}): ReadinessInput => ({
  plan: parsePlan(PLAN),
  planFile: 'architecture/build-plan.md',
  running: true,
  live: { sha: 'dd960bd0000000000000000000000000000000000', rows: new Set([3, 4, 6, 7, 8, 10]) },
  main: { sha: 'f790bed0000000000000000000000000000000000', branch: 'main', rows: new Set([3, 4, 6, 7, 8, 10]) },
  branches: [{ branch: 'office/pixel-b1e9', rows: new Set([19, 20, 21, 23]), pr: { number: 6 } }],
  journeys: [journey],
  results: [],
  now: 1,
  ...o,
});

test('readiness: what is in the running build, what is only in an open PR, what is not built', () => {
  const r = computeReadiness(base());
  const by = Object.fromEntries(r.milestones.map((m) => [m.id, m]));
  assert.equal(by['phase-0'].state, 'ready', 'no journey tied to it: its BUILD rows in the build are enough');
  assert.equal(by['phase-1'].state, 'unverified', 'the skeleton journey (row 10) has not passed against this build');
  assert.match(by['phase-1'].line, /built, not yet verified \(skeleton not run against this build\)/);
  assert.equal(by['phase-3'].state, 'branch');
  assert.match(by['phase-3'].line, /rows 19–20 in PR #6, open, not merged/);
  assert.equal(by['phase-4'].state, 'branch');
  assert.match(by['phase-4'].line, /row 23 in PR #6.*row 24 not built/);
  assert.equal(r.ready, false);
  assert.match(r.headline, /^Live app: not ready for PackTrack Line 7 demo \(Checksheet\)\. Has: Prerequisites, Frame, domain and skeleton \(not yet verified\) \(rows 4, 6–8\)\. Missing: Save, submit and My check sheets \(PR #6, open, not merged\); Approval, history and demo data \(PR #6, open, not merged; row 24 not built\)\.$/);
});

test('readiness: merged to main but not in the running build says restart, not ready', () => {
  const r = computeReadiness(base({ main: { sha: 'f790bed', branch: 'main', rows: new Set([3, 4, 6, 7, 8, 10, 19, 20]) } }));
  const m = r.milestones.find((x) => x.id === 'phase-3')!;
  assert.equal(m.state, 'refresh');
  assert.match(m.line, /rows 19–20 merged to main, not in the live app yet \(Restart picks it up\)/);
});

test('readiness: ready only once the journey passed against this very build; nothing is ready while it is not running', () => {
  const passed = computeReadiness(base({ results: [{ journey: 'skeleton', status: 'passed' }] }));
  assert.equal(passed.milestones.find((x) => x.id === 'phase-1')!.state, 'ready');
  const failed = computeReadiness(base({ results: [{ journey: 'skeleton', status: 'failed' }] }));
  assert.match(failed.milestones.find((x) => x.id === 'phase-1')!.line, /skeleton failed against this build/);
  const stopped = computeReadiness(base({ running: false }));
  assert.ok(stopped.milestones.every((m) => m.state !== 'ready' && m.state !== 'unverified'));
  assert.match(stopped.headline, /it isn't running\. Main has: Prerequisites, Frame, domain and skeleton\./);
  assert.equal(stopped.sha, undefined);
  // The whole plan in the build and every journey passed: ready for the goal.
  const all = new Set([1, 3, 4, 6, 7, 8, 10, 19, 20, 21, 23, 24]);
  const done = computeReadiness(base({ live: { sha: 'abc1234', rows: all }, main: { sha: 'abc1234', branch: 'main', rows: all }, branches: [], journeys: [journey, fillSubmit], results: [{ journey: 'skeleton', status: 'passed' }, { journey: 'op-fill-submit', status: 'passed' }] }));
  assert.equal(done.ready, true);
  assert.match(done.headline, /^Live app: ready for PackTrack Line 7 demo/);
  const unverified = computeReadiness(base({ live: { sha: 'abc1234', rows: all }, main: { sha: 'abc1234', branch: 'main', rows: all }, branches: [], journeys: [journey, fillSubmit], results: [{ journey: 'skeleton', status: 'passed' }] }));
  assert.equal(unverified.ready, false, 'a journey that has not passed keeps it from ready');
  assert.match(unverified.headline, /built into the running app, not yet verified \(1 of 2 journeys/);
  assert.match(computeReadiness(base({ plan: parsePlan('') })).headline, /no build plan/);
});

test('journeys: broken controls and the example are left out; rows come from the requirement field', () => {
  assert.equal(parseJourney('tests/e2e/skeleton-broken.journey.json', JSON.stringify({ id: 'skeleton-broken', requirement: ['build-plan row 10'] })), undefined);
  assert.equal(parseJourney('tests/e2e/example.journey.json', '{}'), undefined);
  assert.equal(parseJourney('tests/e2e/x.journey.json', 'not json'), undefined);
  assert.deepEqual(journey.rows, [10]);
  assert.deepEqual(fillSubmit.rows, []);
});

test('news: a milestone ready in the running app is told once, a rollback is told, and it may be told ready again', () => {
  const r1 = computeReadiness(base({ results: [{ journey: 'skeleton', status: 'passed' }] }));
  const first = readinessNews(r1, {}, 100);
  assert.deepEqual(first.news.map((n) => [n.kind, n.milestone]), [['ready', 'phase-0'], ['ready', 'phase-1']]);
  assert.equal(readinessNews(r1, first.notified, 200).news.length, 0, 'once');
  const rolledBack = computeReadiness(base({ live: { sha: 'old', rows: new Set([3, 4]) }, results: [] }));
  const back = readinessNews(rolledBack, first.notified, 300);
  assert.deepEqual(back.news.map((n) => [n.kind, n.milestone]), [['unready', 'phase-1']]);
  assert.equal(readinessNews(r1, back.notified, 400).news[0]?.key, 'live-ready:phase-1@400');
  assert.equal(readinessNews(computeReadiness(base({ running: false })), {}, 500).news.length, 0, 'nothing while it is not running');
});

const state = (o: Partial<LiveAppState> = {}): LiveAppState => ({ floor: 'f1', status: 'stopped', log: [], available: true, ...o });

test('status words: not started, stopped, building, crashed at a time, and the commit against main', () => {
  assert.equal(liveStatus(state()).word, 'not started');
  assert.equal(liveStatus(state({ started: true })).word, 'stopped');
  assert.equal(liveStatus(state({ status: 'starting', message: 'Building dd960bd… (a cold start takes a minute or two)' })).word, 'building…');
  assert.equal(liveStatus(state({ status: 'starting', message: 'Getting main…' })).word, 'starting…');
  const at = new Date(2026, 9, 17, 10, 27).getTime();
  const crashed = state({ status: 'failed', failure: { kind: 'crash', at, why: 'the app stopped', lines: [] } });
  assert.equal(liveStatus(crashed, at + 60_000).word, 'stopped (crashed at 10:27)');
  assert.equal(liveStatus(crashed, at + 86_400_000 * 2).word, 'stopped (crashed at 17 Oct 10:27)');
  assert.equal(liveStatus(state({ status: 'failed', failure: { kind: 'build', at, why: 'x', lines: [] } }), at).word, 'build failed at 10:27');
  const c = new Date(2026, 9, 16, 23, 36).getTime();
  assert.equal(commitLine(state({ status: 'running', sha: 'dd960bd1234', commitAt: c, branch: 'main', main: { sha: 'f790bed9999', behind: 2 } }), at), 'main @dd960bd from 16 Oct 23:36 · 2 commits behind main @f790bed');
  assert.equal(commitLine(state({ status: 'running', sha: 'f790bed9999', branch: 'main', main: { sha: 'f790bed9999', behind: 0 } })), 'main @f790bed · up to date');
});

test('Needs you: a crash (counted, notified once), a refresh that cannot reach main and ready news (info, not counted)', () => {
  const at = Date.now();
  const live = state({
    status: 'failed',
    sha: 'dd960bd1234',
    branch: 'main',
    failure: { kind: 'crash', at, why: 'the app stopped', lines: ['Error: the app stopped: the Mendix runtime is no longer running', '✖ mxcli exited (code 1)'], sha: 'dd960bd1234' },
    refresh: { ok: false, at, error: 'git fetch: could not read Username' },
    readiness: { goal: 'g', milestones: [], ready: false, headline: '', at, news: [{ key: `live-ready:phase-1@${at}`, kind: 'ready', milestone: 'phase-1', title: 'Frame, domain and skeleton', at, sha: 'dd960bd1234' }] },
  });
  const rows = liveNeeds(live, 'f1');
  assert.deepEqual(rows.map((r) => [r.key.replace(/@\d+$/, ''), r.level]), [['live-crash', 'warn'], ['live-refresh', 'info'], ['live-ready:phase-1', 'info']]);
  assert.match(rows[0].text, /stopped by itself \(crashed at \d\d:\d\d, main @dd960bd\): the app stopped\. Restart it on the Live app tab$/);
  assert.match(rows[1].text, /^Live app can't check for updates: git fetch: could not read Username \(running main @dd960bd\)$/);
  assert.match(rows[2].text, /^Live app ready: Frame, domain and skeleton/);
  assert.deepEqual(rows.map((r) => isRedNeed(r)), [true, false, true], 'the crash and the ready news reach Teams and push; the refresh row waits for the page');
  assert.equal(liveNeeds(live, 'other').length, 0);
  // Through the strip: info rows show and aren't counted as waiting on you.
  const items = collectNeeds({ floor: 'f1', workers: [], pulls: [], floors: [], live });
  assert.equal(hereCount(items), 1);
  // A build failure is the old row, and not pushed.
  const build = liveNeeds(state({ status: 'failed', message: 'No Mendix project', failure: { kind: 'build', at, why: 'No Mendix project', lines: [] } }), 'f1');
  assert.deepEqual(build.map((r) => [r.key, isRedNeed(r)]), [['live', false]]);
});
