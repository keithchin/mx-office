// The office derives a toolkit project's stage itself (release 56): gate-check run by the office on a
// temporary checkout of origin/<default> whenever main moves, verdicts kept per commit, freshness said,
// a failure said (the last good check kept and marked stale), and what doesn't add up between PROJECT.md
// and gate-check flagged as info. A migration project read "Stage 2 — Requirements" while main had Stage 4 signed
// off and the build under way. Synthetic repos (a bare origin and a project clone) and a fake gate-check
// (tests/fixtures/stage-derive/fake-gate-check.mjs) printing the toolkit's own lines.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { GateSource } from '../src/server/wizard/gate-source.js';
import { execFileOff, stopExecWorker } from '../src/server/offloop/exec.js';
import { setupViewOf } from '../src/server/wizard/setup.js';
import { stageEvidence } from '../src/server/wizard/stage-evidence.js';
import { askStageFix } from '../src/server/wizard/stage-fix.js';
import { originNews } from '../src/server/floor-sync/bus.js';
import { deriveStage, freshnessText, lineStage, signedOffStages, stageFlags, stageHeadline, toolkitPosition, verdictsFromOutput } from '../src/shared/stage-derive.js';
import { stageFlagCandidates } from '../src/shared/decisions/stage-flags.js';
import { collectNeeds } from '../src/shared/needsyou.js';
import { derivePhases, progressLabel } from '../src/shared/progress.js';
import { manualInPlay, manualWaiting } from '../src/shared/gate-play.js';
import type { Floor } from '../src/server/floor.js';

const FAKE = path.join(import.meta.dirname, 'fixtures', 'stage-derive', 'fake-gate-check.mjs');

const ROW = (stage: string, decision: string, status = 'CONFIRMED 2026-10-16') => `| ${stage} | ${decision} | ${status} | ESC-1 rev 1 |`;
const register = (rows: string[], line = '**Stage 2 — Requirements**, in progress — gates passed: P, 0, 1 (derived by gate-check on 2026-10-16; re-run it rather than editing this line).') =>
  [
    '# PROJECT.md — demo Decision Register',
    '',
    '## Current stage',
    '',
    line,
    '',
    'Entry mode: migration',
    'Size tier: small',
    '',
    '## Decisions',
    '',
    '| Stage | Decision | Status | Notes |',
    '|---|---|---|---|',
    ROW('P', 'Entry mode: Migration'),
    ROW('0', 'Scope: project brief approved (docs/project-brief.md)'),
    ...rows,
    '',
    '## Open questions',
    '',
    'None.',
    '',
  ].join('\n');
const INTAKE_OPEN = '# Intake\n\n## 1. Entry mode\n\nAnswered (CONFIRMED): migration\n\n## 3. Fidelity: port as-is, or improve as we go?\n\n(not yet asked)\n';
const INTAKE_DONE = '# Intake\n\n## 1. Entry mode\n\nAnswered (CONFIRMED): migration\n\n## 3. Fidelity: port as-is, or improve as we go?\n\nAnswered (CONFIRMED): port as-is\n';
const TRIAGE_OPEN = '# Triage\n\n## Sign-off\n\nConfirmed by: "[user] on [date] — required before Phase 2/3 proceed."\n';
const TRIAGE_DONE = '# Triage\n\n## Sign-off\n\nConfirmed by: Keith (Project Manager) on 2026-10-16\n';
// The scaffold's dashboard, committed once and never again (a real project's, at scaffold time).
const OLD_DASHBOARD = '<table><tr><td>P</td><td>Kickoff</td><td>FAIL</td><td>unanswered</td></tr><tr><td>0</td><td>Triage</td><td>FAIL</td><td>placeholder</td></tr><tr><td>1</td><td>Analysis</td><td>PENDING</td><td>no kb</td></tr><tr><td>5</td><td>Build</td><td>MANUAL</td><td>manual</td></tr></table>';

function repos(t: { after(fn: () => void): void }) {
  const root = mkdtempSync(path.join(tmpdir(), 'office-stage-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const g = (cwd: string, ...args: string[]) => execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { cwd, stdio: 'pipe' }).toString().trim();
  const put = (dir: string, file: string, text: string) => {
    mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    writeFileSync(path.join(dir, file), text);
  };
  const origin = path.join(root, 'origin.git');
  g(root, 'init', '-q', '--bare', '-b', 'main', origin);
  const seed = path.join(root, 'seed');
  g(root, 'clone', '-q', origin, seed);
  g(seed, 'checkout', '-q', '-b', 'main');
  // Stage 2 signed off, Stages 1 and 2 done; the intake and triage paperwork still open.
  put(seed, 'PROJECT.md', register([ROW('1', 'Extraction scope: whole DDL'), ROW('2', 'BRD F001 signed off as the Stage 2 baseline (CAC-3)')]));
  put(seed, 'intake.md', INTAKE_OPEN);
  put(seed, 'triage.md', TRIAGE_OPEN);
  put(seed, 'index.html', OLD_DASHBOARD);
  put(seed, 'analysis/kb/README.md', 'kb');
  put(seed, 'docs/brd.json', '{}');
  g(seed, 'add', '.');
  g(seed, 'commit', '-qm', 'stage 2 signed off');
  g(seed, 'push', '-q', 'origin', 'main');
  const floor = path.join(root, 'floor');
  g(root, 'clone', '-q', origin, floor);
  /** Stages 3 and 4 signed off on main, with their files; the line and dashboard left as they were. */
  const signOff34 = () => {
    put(seed, 'architecture/fit-gap.md', 'fit-gap');
    put(seed, 'architecture/build-plan.md', 'plan');
    put(seed, 'PROJECT.md', register([ROW('1', 'Extraction scope: whole DDL'), ROW('2', 'BRD F001 signed off as the Stage 2 baseline (CAC-3)'), ROW('3', 'Stage 3 signed off: one module, fit-gap verdicts, blueprint'), ROW('4', 'Stage 4 signed off: build plan (33 rows)')]));
    g(seed, 'add', '.');
    g(seed, 'commit', '-qm', 'stages 3 and 4 signed off');
    g(seed, 'push', '-q', 'origin', 'main');
    g(floor, 'fetch', '-q', 'origin');
    return g(floor, 'rev-parse', 'origin/main');
  };
  const fixPaperwork = () => {
    put(seed, 'intake.md', INTAKE_DONE);
    put(seed, 'triage.md', TRIAGE_DONE);
    g(seed, 'commit', '-qam', 'paperwork');
    g(seed, 'push', '-q', 'origin', 'main');
    g(floor, 'fetch', '-q', 'origin');
    return g(floor, 'rev-parse', 'origin/main');
  };
  return { root, origin, seed, floor, g, put, signOff34, fixPaperwork };
}

/** The fake gate-check over a worktree, started off the event loop (offloop/exec.ts), as the office's runner is. */
function fakeRunner(env: () => Record<string, string> = () => ({}), seen: string[] = []) {
  return (tmp: string) =>
    new Promise<string>((resolve, reject) => {
      seen.push(tmp);
      execFileOff(process.execPath, [FAKE, tmp], { cwd: tmp, env: { ...process.env, ...env() }, windowsHide: true, timeout: 60_000 }, (err, out) => (err ? reject(new Error(`${err.message}: ${err.stderr ?? ''}`)) : resolve(String(out))));
    });
}

test.after(() => stopExecWorker());

/** What the setup view and every stage display are made of (wizard/index.ts freshSetup). */
async function evidenceOf(gates: GateSource, dir: string) {
  const r = await gates.read(dir, false);
  assert.ok(r);
  const view = setupViewOf(r.files);
  return { r, view, ev: stageEvidence(view, r.files['PROJECT.md'], r.check)! };
}

const settle = async (gates: GateSource, dir: string) => {
  for (let i = 0; i < 400 && gates.busy(dir); i++) await new Promise((res) => setTimeout(res, 25));
  assert.equal(gates.busy(dir), false, 'gate-check finished');
};

/** Waits (up to 10 s) for a gate-check to start without reading the gates (reading would start one itself). */
const started = async (gates: GateSource, dir: string) => {
  for (let i = 0; i < 400 && !gates.busy(dir); i++) await new Promise((res) => setTimeout(res, 25));
  return gates.busy(dir);
};

const snapshot = (g: (cwd: string, ...a: string[]) => string, floor: string, origin: string) => ({
  status: g(floor, 'status', '--porcelain'),
  head: g(floor, 'rev-parse', 'HEAD'),
  branches: g(floor, 'for-each-ref', '--format=%(refname) %(objectname)', 'refs/heads'),
  origin: g(origin, 'for-each-ref', '--format=%(refname) %(objectname)'),
  worktrees: g(floor, 'worktree', 'list', '--porcelain').split('\n').filter((l) => l.startsWith('worktree ')).length,
});

// ---- Pure ------------------------------------------------------------------------------------------------

test("gate-check's own output lines are read (the toolkit's ' — ' separator)", () => {
  const v = verdictsFromOutput("Stage P (Kickoff): FAIL — unanswered section(s) in /x/intake.md: 3. Fidelity\nStage 0 (Triage): PASS — ok\r\nStage 5 (Build): MANUAL — not file-existence-checkable\nSummary: 1 passed\n");
  assert.deepEqual(v.map((x) => [x.id, x.title, x.status]), [['P', 'Kickoff', 'FAIL'], ['0', 'Triage', 'PASS'], ['5', 'Build', 'MANUAL']]);
  assert.match(v[0].detail ?? '', /unanswered section/);
});

test('the stage is where the work is: past the latest stage passed or signed off, not pulled back to Kickoff by paperwork', () => {
  const verdicts = [
    { id: 'P', title: 'Kickoff', status: 'FAIL', detail: 'unanswered section(s) in intake.md: 3. Fidelity' },
    { id: '0', title: 'Triage', status: 'FAIL', detail: "'Confirmed by:' still holds the shipped placeholder" },
    { id: '1', title: 'Analysis', status: 'PASS' },
    { id: '2', title: 'Requirements', status: 'PASS' },
    { id: '3', title: 'Architecture & Design', status: 'PASS' },
    { id: '4', title: 'Build Plan', status: 'PASS' },
    { id: '5', title: 'Build', status: 'MANUAL' },
    { id: '6', title: 'Test', status: 'PENDING' },
    { id: '7', title: 'Cutover', status: 'PENDING' },
  ];
  const decisions = [
    { stage: '0', decision: 'Scope: project brief approved', status: 'CONFIRMED 2026-10-16' },
    { stage: '2', decision: 'BRD F001 signed off as the Stage 2 baseline (CAC-3)', status: 'CONFIRMED 2026-10-16' },
    { stage: '3', decision: 'Stage 3 signed off: one module', status: 'CONFIRMED 2026-10-16' },
    { stage: '4', decision: 'Stage 4 signed off: build plan', status: 'CONFIRMED 2026-10-16' },
    { stage: '3', decision: 'BR-08 amended', status: 'DECIDED 2026-10-16 by Chief Analyst' },
  ];
  assert.deepEqual(signedOffStages(decisions), ['2', '3', '4'], 'a scope answer at Stage 0 is not a sign-off');
  assert.deepEqual(deriveStage(verdicts, decisions), { id: '5', title: 'Build', status: 'MANUAL' });
  // What gate-check itself would write into "Current stage": the first stage not passed.
  assert.equal(toolkitPosition(verdicts)?.id, 'P');
  // gate-play's rule is unchanged: Stage 5 isn't waiting for a sign-off while an earlier stage fails.
  assert.equal(manualInPlay(verdicts, '5'), false);
  const md = register([], '**Stage 2 — Requirements**, in progress — gates passed: P, 0, 1 (derived by gate-check on 2026-10-16; re-run it rather than editing this line).');
  assert.equal(lineStage(md), '2');
  const flags = stageFlags(verdicts, decisions, md);
  assert.equal(flags[0].kind, 'paperwork');
  assert.match(flags[0].text, /^Stage 2, 3 and 4 are signed off in PROJECT\.md, but gate-check still reports Stage P failing: unanswered section.*; Stage 0 failing: 'Confirmed by:' still holds the shipped placeholder/);
  assert.equal(flags[1].text, "PROJECT.md's stage line is out of date: it says Stage 2; gate-check on main says Stage P");
  // Paperwork fixed: the readout gate-check would write is Stage 5, the line still says 2.
  const clean = verdicts.map((v) => (v.id === 'P' || v.id === '0' ? { ...v, status: 'PASS', detail: undefined } : v));
  assert.deepEqual(stageFlags(clean, decisions, md).map((f) => f.text), ["PROJECT.md's stage line is out of date: it says Stage 2; gate-check on main says Stage 5"]);
  assert.equal(manualWaiting(clean, clean[6], decisions), true, 'now Stage 5 is the stage in play');
  // Nothing reached yet: the toolkit's own position. Everything passed: all.
  assert.equal(deriveStage([{ id: 'P', status: 'PENDING' }, { id: '0', status: 'PENDING' }], [])?.id, 'P');
  assert.equal(deriveStage(['P', '0', '1'].map((id) => ({ id, status: 'PASS' })), [])?.id, 'all');
});

test('the progress bar marks the derived stage as current, earlier gaps keep their own status', () => {
  const verdicts = [
    { id: 'P', title: 'Kickoff', status: 'FAIL', detail: 'unanswered' },
    { id: '0', title: 'Triage', status: 'PASS' },
    { id: '1', title: 'Analysis', status: 'PASS' },
    { id: '2', title: 'Requirements', status: 'PASS' },
    { id: '3', title: 'Architecture & Design', status: 'PASS' },
    { id: '4', title: 'Build Plan', status: 'PASS' },
    { id: '5', title: 'Build', status: 'MANUAL' },
  ];
  const acceptance = { version: 'v1', cycle: 1, earlier: [] };
  const before = derivePhases({ toolkit: true, entry: 'migration', verdicts, decisions: [], acceptance });
  assert.equal(progressLabel({ phases: before, acceptance }), 'Stage P · Kickoff · failing');
  const after = derivePhases({ toolkit: true, entry: 'migration', verdicts, decisions: [], acceptance, stage: '5' });
  assert.equal(progressLabel({ phases: after, acceptance }), 'Stage 5 · Build');
  assert.equal(after.find((p) => p.id === 'P')?.status, 'failed');
});

test('freshness in words: checked when and on which commit, checking, and a failure that keeps the last good check marked stale', () => {
  const now = Date.parse('2026-10-16T15:00:00Z');
  const sha = 'abc1234def5678900000000000000000000000000';
  assert.equal(freshnessText({ source: 'office', branch: 'main', sha, at: now - 3 * 60_000 }, now), 'checked on main @abc1234, 3 min ago');
  assert.equal(freshnessText({ source: 'office', branch: 'main', sha, at: now - 10_000, running: true }, now), 'checked on main @abc1234, just now · checking…');
  const failed = freshnessText({ source: 'office', branch: 'main', sha, at: now - 3_600_000, stale: true, head: 'fff0000aaaa', error: 'gate-check took longer than 300 s', errorAt: now - 60_000 }, now);
  assert.match(failed, /^checked on main @abc1234, 1 h ago · stale: main has moved on to @fff0000 · couldn't check at \d\d:\d\d: gate-check took longer than 300 s$/);
  assert.match(freshnessText({ source: 'committed', branch: 'main', sha }, now), /committed on main @abc1234; the office hasn't checked it yet/);
  assert.equal(stageHeadline({ stage: { id: '5', title: 'Build' }, check: { source: 'office', branch: 'main', sha, at: now - 3 * 60_000 }, flags: [] }, now), 'Stage 5 · Build · checked on main @abc1234, 3 min ago');
});

// ---- The office's own check, on synthetic repos --------------------------------------------------------------

test('main moves: the office re-derives the stage on the new commit by itself, and never writes the project', async (t) => {
  const { floor, origin, g, signOff34 } = repos(t);
  const seen: string[] = [];
  const gates = new GateSource(fakeRunner(() => ({}), seen), { fetch: false, throttleMs: 0 });
  t.after(() => gates.stop());
  const before = snapshot(g, floor, origin);
  const sha1 = g(floor, 'rev-parse', 'origin/main');

  // Before the office has checked: the committed dashboard, said to be that.
  const first = await evidenceOf(gates, floor);
  assert.equal(first.ev.check.source, 'committed');
  assert.equal(first.ev.check.running, true);
  assert.deepEqual(first.ev.flags, [], 'no flags from a dashboard nobody checked');
  await settle(gates, floor);

  const one = await evidenceOf(gates, floor);
  assert.equal(one.ev.check.source, 'office');
  assert.equal(one.ev.check.sha, sha1);
  assert.equal(one.ev.stage?.id, '3', 'Stage 2 signed off: Stage 3 is next');
  assert.equal(one.r.renderedAt, one.ev.check.at);

  // Stages 3 and 4 signed off on main; the line in PROJECT.md and the committed dashboard untouched.
  const sha2 = signOff34();
  originNews(floor); // what the office's fetch says when it brought something
  assert.equal(await started(gates, floor), true, 'main moved: a check started without anyone looking');
  await settle(gates, floor);
  const two = await evidenceOf(gates, floor);
  assert.equal(two.ev.check.sha, sha2);
  assert.equal(two.ev.check.stale, undefined);
  assert.deepEqual(two.ev.stage, { id: '5', title: 'Build', status: 'MANUAL' });
  assert.match(stageHeadline(two.ev, Date.now()), new RegExp(`^Stage 5 · Build · checked on main @${sha2.slice(0, 7)}, just now$`));
  // Cached per commit: reading again doesn't run it again.
  const runs = seen.length;
  await evidenceOf(gates, floor);
  assert.equal(gates.busy(floor), false);
  assert.equal(seen.length, runs);
  // The acceptance record's path reads the office's check of exactly that commit.
  assert.match(gates.renderedAt(floor, sha2)?.html ?? '', /generated-by/);

  // The project folder and its repository: no file changed, no commit, no branch, no worktree left behind.
  assert.deepEqual(snapshot(g, floor, origin), { ...before, origin: `refs/heads/main ${sha2}` }, 'origin has only what the test pushed');
  assert.equal(readdirSync(tmpdir()).filter((d) => seen.some((s) => path.basename(s) === d)).length, 0, 'the temporary checkouts are gone');
});

test('signed-off stages while gate-check still fails the paperwork: an info card with the lead action, and the stale line flagged', async (t) => {
  const { floor, signOff34, fixPaperwork, g } = repos(t);
  signOff34();
  const gates = new GateSource(fakeRunner(), { fetch: false, throttleMs: 0 });
  t.after(() => gates.stop());
  await evidenceOf(gates, floor);
  await settle(gates, floor);
  const { ev, view } = await evidenceOf(gates, floor);
  const kinds = ev.flags.map((f) => f.kind);
  assert.deepEqual(kinds, ['paperwork', 'line']);
  assert.match(ev.flags[0].text, /^Stage 2, 3 and 4 are signed off in PROJECT\.md, but gate-check still reports Stage P pending: 1 intake question still to ask: Q3; Stage 0 failing: 'Confirmed by:' still holds the shipped placeholder/);
  assert.equal(ev.flags[1].text, "PROJECT.md's stage line is out of date: it says Stage 2; gate-check on main says Stage P");
  assert.match(ev.line ?? '', /^Stage 2 — Requirements, in progress/);

  // Needs you: one info row (not waiting on you), its button asks the lead.
  const setup = { ...view, checking: false, stage: ev };
  const cards = stageFlagCandidates(setup, 'f1');
  assert.equal(cards.length, 1);
  assert.equal(cards[0].need.level, 'info');
  assert.equal(cards[0].need.action, 'Ask the lead to fix the paperwork');
  assert.deepEqual(cards[0].need.target, { to: 'stage-fix', floor: 'f1' });
  const needs = collectNeeds({ floor: 'f1', workers: [], pulls: [], floors: [], setup });
  const row = needs.find((n) => n.key === 'stage-flags-f1');
  assert.ok(row, 'the card is in Needs you');
  assert.equal(row.level, 'info');

  // The action: the lead is told through the durable tell, with the gates' own words; nothing else.
  const told: { text: string; decision: string }[] = [];
  const floorRef = { id: 'f1', dir: floor } as unknown as Floor;
  const ok = await askStageFix({ setup: async () => setup, lead: () => 'Sophie', tell: async (_f, text, _by, _o, decision) => void told.push({ text, decision }) }, floorRef, 'Keith', 'u1');
  assert.equal(ok.ok, true);
  assert.equal(told.length, 1);
  assert.match(told[0].text, /Stage P \(Kickoff\): 1 intake question still to ask: Q3/);
  assert.match(told[0].text, /re-run bin\/gate-check\.sh/);
  assert.match(told[0].decision, /^tell:stage-fix-/);
  assert.equal((await askStageFix({ setup: async () => setup, lead: () => undefined, tell: async () => undefined }, floorRef, 'Keith', 'u1')).ok, false, 'no lead at work: refused');

  // Paperwork fixed on main: the paperwork flag goes; the line still says 2 while gate-check on main says 5.
  fixPaperwork();
  originNews(floor);
  assert.equal(await started(gates, floor), true);
  await settle(gates, floor);
  const after = await evidenceOf(gates, floor);
  assert.deepEqual(after.ev.flags.map((f) => f.text), ["PROJECT.md's stage line is out of date: it says Stage 2; gate-check on main says Stage 5"]);
  assert.equal(stageFlagCandidates({ ...after.view, checking: false, stage: after.ev }, 'f1')[0].need.action, 'Ask the lead to re-run gate-check');
  assert.equal(g(floor, 'status', '--porcelain'), '');
});

test('a failed check is said, and the last good result stays, marked stale with its time; it is tried again later', async (t) => {
  const { floor, signOff34 } = repos(t);
  let fail = false;
  let clock = 1_000_000;
  const gates = new GateSource(fakeRunner(() => (fail ? { FAKE_GC_FAIL: '1' } : {})), { fetch: false, throttleMs: 0, failMs: 600_000 }, () => clock);
  t.after(() => gates.stop());
  await evidenceOf(gates, floor);
  await settle(gates, floor);
  const good = await evidenceOf(gates, floor);
  const t1 = good.ev.check.at;
  assert.equal(good.ev.stage?.id, '3');

  fail = true;
  clock += 120_000;
  const sha2 = signOff34();
  await evidenceOf(gates, floor);
  await settle(gates, floor);
  const bad = await evidenceOf(gates, floor);
  assert.equal(bad.ev.check.source, 'office');
  assert.equal(bad.ev.check.stale, true);
  assert.equal(bad.ev.check.at, t1, 'the last good check, with its own time');
  assert.equal(bad.ev.check.head, sha2);
  assert.match(bad.ev.check.error ?? '', /gate-check could not read the toolkit|exit|Command failed/);
  assert.equal(bad.ev.stage?.id, '3', 'from the last good check, not the committed dashboard');
  assert.deepEqual(bad.ev.flags, [], 'no flags from a stale check');
  assert.match(freshnessText(bad.ev.check, clock), /stale: main has moved on to @.{7} · couldn't check at \d\d:\d\d: /);
  // Not hammered: within failMs nothing runs again; after it, it does (and recovers).
  clock += 60_000;
  await evidenceOf(gates, floor);
  assert.equal(gates.busy(floor), false);
  fail = false;
  clock += 600_000;
  await evidenceOf(gates, floor);
  assert.equal(gates.busy(floor), true);
  await settle(gates, floor);
  const back = await evidenceOf(gates, floor);
  assert.equal(back.ev.check.sha, sha2);
  assert.equal(back.ev.check.error, undefined);
  assert.equal(back.ev.stage?.id, '5');
});

test("the checkout's committed dashboard is never passed off as the office's check", async (t) => {
  const { floor } = repos(t);
  // Prints its verdicts but writes no dashboard: the verdicts come from its output.
  const quiet = new GateSource(fakeRunner(() => ({ FAKE_GC_NO_HTML: '1' })), { fetch: false, throttleMs: 0 });
  t.after(() => quiet.stop());
  await evidenceOf(quiet, floor);
  await settle(quiet, floor);
  const q = await evidenceOf(quiet, floor);
  assert.equal(q.ev.check.source, 'office');
  assert.equal(q.ev.stage?.id, '3');
  assert.doesNotMatch(q.r.files['index.html'] ?? '', /unanswered<\/td>/, 'not the committed dashboard');
  // Writes nothing and prints nothing (it died early): a failure, not the committed dashboard as fresh.
  const mute = new GateSource(async () => '', { fetch: false, throttleMs: 0 });
  t.after(() => mute.stop());
  await evidenceOf(mute, floor);
  await settle(mute, floor);
  const m = await evidenceOf(mute, floor);
  assert.equal(m.ev.check.source, 'committed');
  assert.match(m.ev.check.error ?? '', /gave no stage verdicts/);
});

test('at most N gate-checks at once across projects, one per project', async (t) => {
  const a = repos(t);
  const b = repos(t);
  let active = 0;
  let most = 0;
  const run = fakeRunner();
  const gates = new GateSource(
    async (tmp, dir) => {
      active++;
      most = Math.max(most, active);
      try {
        await new Promise((res) => setTimeout(res, 100));
        return await run(tmp);
      } finally {
        active--;
        void dir;
      }
    },
    { fetch: false, throttleMs: 0, concurrency: 1 },
  );
  t.after(() => gates.stop());
  await Promise.all([evidenceOf(gates, a.floor), evidenceOf(gates, b.floor)]);
  assert.equal(gates.busy(a.floor) && gates.busy(b.floor), true, 'both asked for');
  await Promise.all([settle(gates, a.floor), settle(gates, b.floor)]);
  assert.equal(most, 1);
  assert.equal((await evidenceOf(gates, a.floor)).ev.check.source, 'office');
  assert.equal((await evidenceOf(gates, b.floor)).ev.check.source, 'office');
});

test('no program is started on the event loop: git and gate-check go through offloop/exec.ts', () => {
  for (const f of ['src/server/wizard/gate-source.ts', 'src/server/wizard/stage-evidence.ts', 'src/server/wizard/stage-fix.ts', 'src/server/http/routes/stage.ts']) {
    const src = readFileSync(path.join(import.meta.dirname, '..', f), 'utf8');
    assert.doesNotMatch(src, /\b(execFileSync|execSync|spawnSync|readFileSync|writeFileSync)\b|\bexecFile\(|\bspawn\(/, `${f} blocks the event loop`);
  }
});

test('reading the stage never blocks the event loop for more than 50 ms, even while gate-check runs', async (t) => {
  const { floor, signOff34 } = repos(t);
  const gates = new GateSource(fakeRunner(), { fetch: false, throttleMs: 0 });
  t.after(() => gates.stop());
  await evidenceOf(gates, floor); // warm: the first git calls
  await settle(gates, floor);
  signOff34();
  const h = monitorEventLoopDelay({ resolution: 5 });
  let longest = 0;
  // What GET /api/progress and the setup panel do per look (the git reads off the loop, then the derivation on it), while main moved and a check runs.
  const look = async () => {
    const r = await gates.read(floor, false);
    const t0 = performance.now();
    const view = setupViewOf(r!.files);
    stageEvidence(view, r!.files['PROJECT.md'], r!.check);
    longest = Math.max(longest, performance.now() - t0);
  };
  h.enable();
  for (let i = 0; i < 20; i++) await look();
  await settle(gates, floor);
  for (let i = 0; i < 20; i++) await look();
  h.disable();
  assert.ok(longest < 50, `one look held the event loop ${longest.toFixed(1)} ms`);
  // The loop as a whole (a busy test machine adds its own scheduling delays, so its 99th percentile).
  const p99 = h.percentile(99) / 1e6;
  assert.ok(p99 < 50, `the event loop was held ${p99.toFixed(1)} ms (99th percentile; max ${(h.max / 1e6).toFixed(1)} ms)`);
});
