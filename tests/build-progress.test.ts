// Build (Stage 5) shows its progress, and a signed-off stage gate-check still calls PENDING doesn't hide it
// (a migration project, release 56: "Build · not started" over a build half merged, because gate-check's Stage 2
// looked for the signed BRD in analysis/legacy/knowledge-base/brd/ while the Playbook had put it in
// analysis/knowledge-base/brd/). Pure checks, then a synthetic project (a bare origin, a floor clone, a
// merged build PR, a branch ahead with an open PR) read through the office's own gate-check with the fake
// gate-check fixture (tests/fixtures/stage-derive/fake-gate-check.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buildLog, buildSummary, buildUnderWay, planBehind, planRows, rowEvidence, rowRanges, rowsByPlace, rowsIn, type BuildEvidence } from '../src/shared/build-progress.js';
import { brdPathFlag, gateCheckKb } from '../src/shared/brd-path.js';
import { manualInPlay, signedOff } from '../src/shared/gate-play.js';
import { derivePhases, progressLabel, type ProgressInput } from '../src/shared/progress.js';
import { stageFlags, stageHeadline } from '../src/shared/stage-derive.js';
import { stageFixMessage, stageFlagCandidates } from '../src/shared/decisions/stage-flags.js';
import { signoffCandidates } from '../src/shared/decisions/candidates.js';
import { deliverablesBrief, kbLines } from '../src/server/roster/deliverables-brief.js';
import { entryOfProject } from '../src/server/roster/playbooks.js';
import { migrationTrack } from '../src/shared/discovery-migration.js';
import { GateSource } from '../src/server/wizard/gate-source.js';
import { setupViewOf } from '../src/server/wizard/setup.js';
import { stageEvidence } from '../src/server/wizard/stage-evidence.js';
import { evidenceFor, mergedBuildPrs } from '../src/server/wizard/build-evidence.js';
import { execFileOff, stopExecWorker } from '../src/server/offloop/exec.js';
import type { GhPull } from '../src/shared/protocol/github.js';
import type { SetupView } from '../src/shared/wizard.js';

const FAKE = path.join(import.meta.dirname, 'fixtures', 'stage-derive', 'fake-gate-check.mjs');
test.after(() => stopExecWorker());

// A migration project's gate-check on main @68cc068, as committed in reports/management/gate-check-main-2026-10-16.md.
const VERDICTS = [
  { id: 'P', title: 'Kickoff', status: 'PASS' },
  { id: '0', title: 'Triage', status: 'PASS' },
  { id: '1', title: 'Analysis', status: 'PASS' },
  { id: '2', title: 'Requirements', status: 'PENDING', detail: 'no brd/*.brd.json scaffolds yet' },
  { id: '3', title: 'Architecture & Design', status: 'PASS' },
  { id: '4', title: 'Build Plan', status: 'PASS' },
  { id: '5', title: 'Build', status: 'MANUAL', detail: 'not file-existence-checkable — fill in status manually' },
  { id: '6', title: 'Test', status: 'PENDING' },
  { id: '7', title: 'Cutover', status: 'PENDING' },
];
const SIGNED2 = { stage: '2', decision: 'BRD F001 signed off as the Stage 2 baseline (CAC-3)', status: 'CONFIRMED 2026-10-16' };
const DECISIONS = [
  { stage: '0', decision: 'Scope: slice approved', status: 'CONFIRMED 2026-10-16' },
  SIGNED2,
  { stage: '3', decision: 'Stage 3 approved: one module', status: 'CONFIRMED 2026-10-16' },
  { stage: '4', decision: 'Stage 4 approved: build plan', status: 'CONFIRMED 2026-10-16' },
];
const ACCEPTANCE = { version: 'v1', cycle: 1, earlier: [] };
const EVIDENCE: BuildEvidence = {
  branch: 'main',
  sha: '68cc0680000000000000000000000000000000000',
  plan: { total: 33, built: 0, partial: 0, blocked: 0, states: Object.fromEntries(Array.from({ length: 33 }, (_, i) => [String(i + 1), 'not built'])) },
  merged: [{ number: 3, title: 'Stage 5 build: frame, domain, stubs/nav, theme, skeleton, seed (rows 4-14)', files: 63, rows: rowsIn('rows 4-14') }],
  // The project's rows named in commits (the coordinator's read): main 3,4,6–11,13,14 (3 only in a journal line); Sophie's branch 15–17,19–21,23–25,27,32 (21 check-only, 32 a recorded rule).
  open: [{ branch: 'office/pixel-b1e9', ahead: 75, files: 120, pr: { number: 6, title: 'Stage 5 build: sheet core, form, save/submit, pages, photo upload' }, rows: [15, 16, 17, 19, 20, 23, 24, 25, 27] }],
  rows: { main: [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14], branch: [15, 16, 17, 19, 20, 23, 24, 25, 27], mentioned: [3, 21, 32] },
  log: { entries: 12, last: { at: '2026-10-16 18:29', what: '04-rebuild.mdl ⚠️ applied, LINT ROSE' } },
  scripts: 4,
};
const input = (over: Partial<ProgressInput> = {}): ProgressInput => ({ toolkit: true, entry: 'migration', verdicts: VERDICTS, decisions: DECISIONS, acceptance: ACCEPTANCE, setupShown: false, stage: '5', ...over });
const phase = (ps: ReturnType<typeof derivePhases>, id: string) => ps.find((p) => p.id === id)!;

test("the build plan's State column, a PR title's rows and BUILD-LOG's build rows are read in the toolkit's shapes", () => {
  const plan = [
    '| # | Question | Resolution | Basis |',
    '|---|---|---|---|',
    '| 1 | Iteration granularity | per layer | Step 3 |',
    '',
    '| # | Kind | Step | Produces / Proves | Depends on | Skills | State |',
    '|---|---|---|---|---|---|---|',
    '| 1 | BRIEF | brief | ok | — | skills/module-brief.md | built |',
    '| 2 | RUN | platform | ok | 1 | none | `partial` |',
    '| 3 | PROVE | probes | ok | 1 | none | not built |',
    '| 4 | BUILD | seed | ok | 1 | none | blocked |',
  ].join('\r\n');
  assert.deepEqual(planRows(plan), { total: 4, built: 1, partial: 1, blocked: 1, states: { '1': 'built', '2': 'partial', '3': 'not built', '4': 'blocked' } }, 'a table without a State column is not counted');
  assert.equal(planRows('# Plan\n\nno tables'), undefined);
  assert.deepEqual(rowsIn('Stage 5 build: frame, domain (rows 4-14)'), [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);
  assert.deepEqual(rowsIn('row 25 tests'), [25]);
  assert.deepEqual(rowsIn('rows 3, 5 and 7–8'), [3, 5, 7, 8]);
  assert.deepEqual(rowsIn('BR-08 CheckDate = shift start date; journals'), []);
  assert.equal(rowRanges([4, 5, 6, 9, 11, 12]), '4–6, 9, 11–12');
  const log = [
    '2026-10-16T03:44:32Z  SOURCE-WAIVED legacy/x/pnpm-lock.yaml reason: lockfile',
    '| when (ISO-8601 local) | script | gate | result | detail |',
    '|---|---|---|---|---|',
    '| 2026-10-16T15:45:28+0800 | `01-frame.mdl` | pass | ✅ applied | mxbuild clean |',
    '### 2026-10-16 — Row 14 (seed proof), by OQL on the running app',
    '| 2026-10-16T18:29:58+0800 | `04-rebuild.mdl` | pass | ⚠️ applied, LINT ROSE | lint |',
  ].join('\n');
  assert.deepEqual(buildLog(log), { entries: 3, last: { at: '2026-10-16 18:29', what: '04-rebuild.mdl ⚠️ applied, LINT ROSE' }, rows: [14] }, "Stage 1's SOURCE-WAIVED lines aren't build");
  assert.equal(buildLog('2026-10-16T03:44:32Z  SOURCE-WAIVED a reason: b\n'), undefined);
});

test("each row's evidence comes from the commits naming it, BUILD-LOG notes and merged PR titles: on main, on a branch, or only mentioned", () => {
  const c = (subject: string, files: string[] = []) => ({ subject, files });
  // The project's own subjects.
  const main = [
    c('Row 14: seed proven by OQL read-back and second startup'),
    c('Row 13: seed definition applied; lint re-baselined (ACT_/ASu_ names per brief)', ['mdlsource/2-form/04-seed-definition.mdl']),
    c('Draft row 13 seed definition (generated)', ['mdlsource/2-form/04-seed-definition.mdl']),
    c('Row 4: bilingual definition labels file', ['mdlsource/seed/definition-labels.json']),
    c('Row 11: design-reaches-app counts read by hand', ['docs/BUILD-LOG.md']),
    c('Lint baseline after rows 6-7', ['lint-baseline.json']),
    c('Journal: row 3 probe check results, exec blocked', ['docs/team/development.md']),
  ];
  assert.deepEqual(rowEvidence(main), { evidence: [4, 13, 14], mentioned: [3, 6, 7, 11] }, "a draft, a journal line or a lint note only mentions; 'Row 11 … read by hand' changed no build file");
  assert.deepEqual(rowsIn('Row 24 and 20b polish applied; fidelity waived'), [20, 24]);
  assert.deepEqual(rowsIn('fidelity 66% waived (rows 19/20)'), [19, 20]);
  const branch = [c('Row 15: sheet core microflows applied', ['mdlsource/3-sheet/05-core.mdl']), c('Row 17: T-FORM PASS, OQ-07 result recorded'), c('Rows 19-21: browser walk results, row 21 test files (check-only), defects', ['tests/x.test.mdl']), c("Record Keith's row 32 quick sign-in rule", ['PROJECT.md']), c('Row 13: re-applied after rebase', ['mdlsource/2-form/04-seed-definition.mdl'])];
  const rows = rowsByPlace({ commits: main, log: { entries: 1, rows: [11] }, merged: [{ number: 3, title: 'rows 4-14', files: 9, rows: rowsIn('rows 4-14') }] }, [{ commits: branch, prRows: [] }], 33);
  assert.deepEqual(rows.main, [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);
  assert.deepEqual(rows.branch, [15, 17]);
  assert.deepEqual(rows.mentioned, [3, 19, 20, 21, 32]);
  assert.deepEqual(rows.perBranch, [[15, 17]], "a row already on main isn't counted again on the branch");
  assert.deepEqual(rowsByPlace({ commits: [c('Row 40: extra', ['mdlsource/x.mdl'])], merged: [] }, [], 33).main, [], 'a row past the plan is left out');
  // The plan's State column against the evidence on main.
  assert.deepEqual(planBehind(EVIDENCE), [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);
  const flags = stageFlags(VERDICTS.map((v) => (v.id === '2' ? { ...v, status: 'PASS' } : v)), DECISIONS, undefined, undefined, EVIDENCE);
  assert.deepEqual(flags.map((f) => f.text), ['The build plan says 0 of 33 rows built; commits on main show build evidence for rows 4–14']);
  assert.match(stageFixMessage(flags, 'main @68cc068'), /Mark each row's State in architecture\/build-plan\.md \(built \/ partial \/ not built \/ blocked/);
  const setup = { toolkit: true, stage: { stage: { id: '5', title: 'Build', status: 'MANUAL' }, check: { source: 'office', branch: 'main', sha: 'abc1234def' }, flags } } as unknown as SetupView;
  assert.equal(stageFlagCandidates(setup, 'f1')[0].need.action, 'Ask the lead to fix the paperwork');
  const kept = { ...EVIDENCE, plan: { ...EVIDENCE.plan!, built: 11, states: { ...EVIDENCE.plan!.states, ...Object.fromEntries([4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14].map((n) => [String(n), 'built'])) } } };
  assert.deepEqual(planBehind(kept), [], 'a plan kept up to date: nothing to flag');
  assert.equal(buildSummary(kept), "11 of 33 build-plan rows built (the plan's State column), 9 more on office/pixel-b1e9 (PR #6, open)");
});

test("a stage signed off in the register counts as settled for gate-play, though gate-check still says PENDING", () => {
  assert.equal(signedOff(DECISIONS, '2'), true);
  assert.equal(signedOff(DECISIONS, '0'), false, 'a scope answer is not a sign-off');
  assert.equal(manualInPlay(VERDICTS, '5'), false, 'without the register: Stage 2 PENDING holds it back (the old rule)');
  assert.equal(manualInPlay(VERDICTS, '5', DECISIONS), true, 'Stage 2 signed off: Build is the stage in play');
  assert.equal(manualInPlay(VERDICTS, '5', DECISIONS.filter((d) => d !== SIGNED2)), false);
  // No build evidence: Build waits on its sign-off now (it's in play), not "not started".
  const ps = derivePhases(input());
  const s2 = phase(ps, '2');
  assert.equal(s2.status, 'done');
  assert.equal(s2.signedOff, true);
  assert.equal(s2.verdict, 'PENDING', "gate-check's verdict stays");
  assert.equal(s2.measures[0], 'Signed off (gate-check says PENDING: no brd/*.brd.json scaffolds yet)');
  assert.equal(phase(ps, '5').status, 'waiting');
  // Not signed off and nothing built: "not started", as before.
  const before = derivePhases(input({ decisions: DECISIONS.filter((d) => d !== SIGNED2) }));
  assert.equal(phase(before, '2').status, 'pending');
  assert.equal(phase(before, '5').status, 'pending');
  assert.match(phase(before, '5').measures[0], /^Gate: MANUAL \(Not started: the toolkit checks this stage by hand/);
});

test('Build with merged and open build work is in progress, with counts from the plan and the PR titles; never done without its gate', () => {
  assert.equal(buildSummary(EVIDENCE), '11 of 33 build-plan rows with build evidence on main (rows 4–14), 9 more on office/pixel-b1e9 (PR #6, open)');
  const ps = derivePhases(input({ build: EVIDENCE }));
  const b = phase(ps, '5');
  assert.equal(b.status, 'active');
  assert.equal(b.current, true);
  assert.equal(b.verdict, 'MANUAL');
  assert.equal(b.measures[0], 'In progress: 11 of 33 build-plan rows with build evidence on main (rows 4–14), 9 more on office/pixel-b1e9 (PR #6, open)');
  assert.match(b.measures[1], /^Gate: MANUAL \(the toolkit’s verdict; Build is done only once signed off/);
  assert.ok(b.measures.includes('Rows with build evidence on main: 4–14 (commits naming the row, BUILD-LOG notes, merged PR titles)'));
  assert.ok(b.measures.includes('Rows with build evidence on office/pixel-b1e9 only: 15–17, 19–20, 23–25, 27'));
  assert.ok(b.measures.includes('Rows only mentioned (a draft or a journal line): 3, 21, 32'));
  assert.ok(b.measures.some((m) => /^Merged: PR #3 Stage 5 build.*\(rows 4-14\), 63 build files$/.test(m)));
  assert.ok(b.measures.includes('Open: PR #6 Stage 5 build: sheet core, form, save/submit, pages, photo upload on office/pixel-b1e9, 75 commits ahead of main'));
  assert.ok(b.measures.includes('Build plan: 33 rows; none marked built in its State column'));
  assert.doesNotMatch(b.measures.join('\n'), /%/, 'never a percentage');
  assert.ok(b.measures.some((m) => /^docs\/BUILD-LOG\.md: 12 build entries, the last 2026-10-16 18:29/.test(m)));
  assert.equal(progressLabel({ phases: ps, acceptance: ACCEPTANCE }), 'Stage 5 · Build · in progress');
  // Even with Stage 2 not signed off, work on main is work: in progress, not "not started".
  assert.equal(phase(derivePhases(input({ build: EVIDENCE, decisions: [] })), '5').status, 'active');
  // Every row merged and the plan saying so is still not done: only the gate is.
  const all: BuildEvidence = { ...EVIDENCE, plan: { total: 33, built: 33, partial: 0, blocked: 0 }, open: [], rows: { main: Array.from({ length: 33 }, (_, i) => i + 1), branch: [], mentioned: [] } };
  assert.equal(phase(derivePhases(input({ build: all })), '5').status, 'active');
  assert.equal(buildSummary(all), "33 of 33 build-plan rows built (the plan's State column)");
  const signed = derivePhases(input({ build: all, decisions: [...DECISIONS, { stage: '5', decision: 'Stage 5 (Build) signed off by the Project Manager', status: 'CONFIRMED 2026-10-20' }] }));
  assert.equal(phase(signed, '5').status, 'done');
  assert.equal(phase(derivePhases(input({ build: all, verdicts: VERDICTS.map((v) => (v.id === '5' ? { ...v, status: 'PASS' } : v)) })), '5').status, 'done');
  // No count anywhere: the evidence itself, no percentage.
  const bare: BuildEvidence = { merged: [{ number: 3, title: 'Frame', files: 5 }], open: [{ branch: 'office/x', ahead: 2, files: 1 }] };
  assert.equal(buildSummary(bare), '1 build PR merged (#3), work on office/x (no PR yet)');
  assert.equal(buildSummary({ merged: [], open: [{ branch: 'office/y', ahead: 1, files: 1, rows: [2, 3] }], rows: { main: [], branch: [2, 3], mentioned: [] } }), '2 build-plan rows with build evidence on office/y (no PR yet)');
  assert.equal(buildSummary({ merged: [], open: [], log: { entries: 1, last: { at: '2026-10-16', what: 'Row 3 probes' } } }), 'last BUILD-LOG entry 2026-10-16: Row 3 probes');
  assert.doesNotMatch(JSON.stringify(derivePhases(input({ build: bare }))), /%/);
  // Nothing at all: no evidence, the old rules.
  assert.equal(buildUnderWay({ merged: [], open: [] }), false);
  assert.equal(phase(derivePhases(input({ build: { merged: [], open: [], plan: { total: 33, built: 0, partial: 0, blocked: 0 } } })), '5').status, 'waiting');
});

test('the stage line, the sign-off card and the phone say Build is in progress rather than "waits for your sign-off"', () => {
  const e = { stage: { id: '5', title: 'Build', status: 'MANUAL' }, check: { source: 'office' as const, branch: 'main', sha: EVIDENCE.sha, at: 1_000 }, flags: [], build: EVIDENCE };
  assert.equal(stageHeadline(e, 1_000), 'Stage 5 · Build · in progress · 11 of 33 build-plan rows with build evidence on main (rows 4–14), 9 more on office/pixel-b1e9 (PR #6, open) · checked on main @68cc068, just now');
  const setup = { toolkit: true, show: false, verdicts: VERDICTS, decisions: DECISIONS, stage: e } as unknown as SetupView;
  const [c] = signoffCandidates(setup);
  assert.equal(c.need.text, 'Stage 5 (Build) is in progress (11 of 33 build-plan rows with build evidence on main (rows 4–14), 9 more on office/pixel-b1e9 (PR #6, open)): sign it off once the build is complete');
  assert.equal(c.need.level, 'info');
  const [w] = signoffCandidates({ ...setup, stage: { ...e, build: undefined } } as unknown as SetupView);
  assert.equal(w.need.text, 'Stage 5 (Build) waits for your sign-off');
});

test("gate-check's Stage 2 missing a BRD that sits in another knowledge base is flagged, with the paths, and asks the lead to fix the paperwork", () => {
  const kb = { nested: ['analysis/legacy/knowledge-base'], flat: true, root: false, brds: { 'analysis/knowledge-base': ['analysis/knowledge-base/brd/F001-check-sheet.brd.json'] } };
  assert.equal(gateCheckKb(kb), 'analysis/legacy/knowledge-base', 'the per-source knowledge base wins');
  assert.equal(brdPathFlag(kb)?.text, "gate-check didn't find the BRD at analysis/legacy/knowledge-base/brd/; it's at analysis/knowledge-base/brd/F001-check-sheet.brd.json");
  assert.equal(brdPathFlag({ ...kb, nested: [] }), undefined, 'no per-source knowledge base: gate-check reads analysis/knowledge-base and finds it');
  assert.equal(brdPathFlag({ ...kb, nested: ['analysis/a/knowledge-base', 'analysis/b/knowledge-base'] }), undefined, 'two workstreams: gate-check refuses, nothing to say about one');
  assert.equal(brdPathFlag({ ...kb, brds: { ...kb.brds, 'analysis/legacy/knowledge-base': ['analysis/legacy/knowledge-base/brd/F001.brd.json'] } }), undefined);
  const flags = stageFlags(VERDICTS, DECISIONS, undefined, kb);
  assert.deepEqual(flags.map((f) => f.kind), ['paperwork', 'brd-path']);
  assert.equal(flags[0].text, 'Stage 2 is signed off in PROJECT.md, but gate-check still reports Stage 2 pending: no brd/*.brd.json scaffolds yet');
  assert.equal(stageFlags(VERDICTS.map((v) => (v.id === '2' ? { ...v, status: 'PASS' } : v)), DECISIONS, undefined, kb).length, 0, 'Stage 2 passing: nothing to flag');
  const msg = stageFixMessage(flags, 'main @68cc068');
  assert.match(msg, /gate-check didn't find the BRD at analysis\/legacy\/knowledge-base\/brd\/; it's at analysis\/knowledge-base\/brd\/F001-check-sheet\.brd\.json\. gate-check's Stage 2 reads BRDs only from analysis\/legacy\/knowledge-base\/brd\//);
  assert.match(msg, /Don't edit the toolkit/);
  const setup = { toolkit: true, stage: { stage: { id: '5', title: 'Build', status: 'MANUAL' }, check: { source: 'office', branch: 'main', sha: 'abc1234def' }, flags: [flags[1]] } } as unknown as SetupView;
  const [card] = stageFlagCandidates(setup, 'f1');
  assert.equal(card.need.action, 'Ask the lead to fix the paperwork');
  assert.equal(card.body.evidence[0].label, 'BRD on main: analysis/knowledge-base/brd/F001-check-sheet.brd.json (gate-check looked in analysis/legacy/knowledge-base/brd/)');
});

test("the Playbook and the Discovery brief put a migration's BRDs where the toolkit's gate-check reads them", () => {
  const mig = deliverablesBrief('chief-analyst', true, [], 'migration').join('\n');
  assert.match(mig, /- Stage 2: `analysis\/<source>\/knowledge-base\/brd\/F\{NNN\}-<feature>\.brd\.json`, in that same knowledge base/);
  assert.match(mig, /the knowledge base the extraction writes under `analysis\/<source>\/knowledge-base\/`/);
  assert.doesNotMatch(mig, /- Stage 2: `analysis\/knowledge-base\/brd\//, 'the old path is gone for a migration');
  const other = deliverablesBrief('chief-analyst', true, [], 'requirements-driven').join('\n');
  assert.equal(other.includes(kbLines(undefined).brd), true);
  assert.match(other, /`analysis\/knowledge-base\/brd\/` only when there is no per-source one/);
  // Covering the Analysis team: the same lines, indented.
  assert.match(deliverablesBrief('pm', true, ['chief-analyst'], 'migration').join('\n'), /\n {2}- Stage 2: `analysis\/<source>\/knowledge-base\/brd\//);
  assert.match(migrationTrack({ toolkitDir: 'C:/tk', slice: false }).join('\n'), /the Stage 2 BRDs go in that same knowledge base, `analysis\/<source>\/knowledge-base\/brd\/F\{NNN\}-<feature>\.brd\.json`/);
  const dir = mkdtempSync(path.join(tmpdir(), 'office-entry-'));
  try {
    assert.deepEqual(entryOfProject(dir), {}, 'not recorded: no entry');
    writeFileSync(path.join(dir, 'PROJECT.md'), '# PROJECT.md\n\n- **Entry mode:** Migration\n');
    assert.deepEqual(entryOfProject(dir), { entry: 'migration' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---- A synthetic project through the office's own gate-check -------------------------------------------

const PLAN = ['# Build plan', '', '| # | Kind | Step | Produces / Proves | Depends on | Skills | State |', '|---|---|---|---|---|---|---|', ...Array.from({ length: 33 }, (_, i) => `| ${i + 1} | BUILD | step ${i + 1} | x | — | none | not built |`), ''].join('\n');
const REGISTER = [
  '# PROJECT.md — project-like Decision Register',
  '',
  '## Current stage',
  '',
  '**Stage 2 — Requirements**, in progress — gates passed: P, 0, 1 (derived by gate-check on 2026-10-16; re-run it rather than editing this line).',
  '',
  'Entry mode: migration',
  '',
  '## Decisions',
  '',
  '| Stage | Decision | Status | Notes |',
  '|---|---|---|---|',
  '| 2 | BRD F001 signed off as the Stage 2 baseline (CAC-3) | CONFIRMED 2026-10-16 | ESC-1 |',
  '| 3 | Stage 3 signed off: one module | CONFIRMED 2026-10-16 | ESC-2 |',
  '| 4 | Stage 4 signed off: build plan (33 rows) | CONFIRMED 2026-10-16 | ESC-3 |',
  '',
].join('\n');

function project(t: { after(fn: () => void): void }) {
  const root = mkdtempSync(path.join(tmpdir(), 'office-build-'));
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
  put(seed, 'PROJECT.md', REGISTER);
  put(seed, 'intake.md', '# Intake\n\n## 1. Entry mode\n\nAnswered (CONFIRMED): migration\n');
  put(seed, 'triage.md', '# Triage\n\n## Sign-off\n\nConfirmed by: Keith (Project Manager) on 2026-10-16\n');
  put(seed, 'analysis/kb/README.md', 'kb');
  put(seed, 'analysis/legacy/knowledge-base/KB.md', 'the extraction');
  put(seed, 'analysis/knowledge-base/brd/F001-check-sheet.brd.json', '{"id":"F001"}');
  put(seed, 'architecture/fit-gap.md', 'fit-gap');
  put(seed, 'architecture/build-plan.md', PLAN);
  put(seed, 'docs/BUILD-LOG.md', '2026-10-16T03:44:32Z  SOURCE-WAIVED legacy/x reason: lockfile\n');
  g(seed, 'add', '.');
  g(seed, 'commit', '-qm', 'Stages 0-4');
  // PR #3: the frame, merged with a merge commit as GitHub does.
  g(seed, 'checkout', '-q', '-b', 'office/pixel-b1e9');
  put(seed, 'mdlsource/1-frame/01-frame.mdl', 'create module Checksheet;');
  put(seed, 'App.mpr', 'mpr');
  put(seed, 'docs/BUILD-LOG.md', '2026-10-16T03:44:32Z  SOURCE-WAIVED legacy/x reason: lockfile\n\n| when | script | gate | result | detail |\n|---|---|---|---|---|\n| 2026-10-16T15:45:28+0800 | `01-frame.mdl` | pass | ✅ applied | clean |\n');
  g(seed, 'add', '.');
  g(seed, 'commit', '-qm', 'Row 6: 01-frame applied');
  g(seed, 'checkout', '-q', 'main');
  g(seed, 'merge', '-q', '--no-ff', 'office/pixel-b1e9', '-m', 'Merge pull request #3 from org/office/pixel-b1e9', '-m', 'Stage 5 build: frame, domain, seed (rows 4-14)');
  // PR #4: a register change, no build files.
  put(seed, 'PROJECT.md', `${REGISTER}\n<!-- BR-08 -->\n`);
  g(seed, 'commit', '-qam', 'BR-08 CheckDate = shift start date (#4)');
  g(seed, 'push', '-q', 'origin', 'main');
  // The branch goes on: rows 15-20, pushed, PR #6 open.
  g(seed, 'checkout', '-q', 'office/pixel-b1e9');
  g(seed, 'merge', '-q', 'main');
  put(seed, 'mdlsource/3-sheet/05-sheet-core.mdl', 'create entity Sheet;');
  g(seed, 'add', '.');
  g(seed, 'commit', '-qm', 'Row 15: sheet core microflows applied');
  put(seed, 'mdlsource/3-sheet/06-form.mdl', 'create page Sheet_NewEdit;');
  g(seed, 'add', '.');
  g(seed, 'commit', '-qm', 'Draft row 16 sheet form page');
  put(seed, 'docs/team/development.md', 'T-FORM');
  g(seed, 'add', '.');
  g(seed, 'commit', '-qm', 'Row 17: T-FORM PASS, OQ-07 result recorded');
  put(seed, 'docs/BUILD-LOG.md', '| 2026-10-16T15:45:28+0800 | `01-frame.mdl` | pass | ✅ applied | clean |\n\n### 2026-10-17 — Row 23 (demo seed) proof by OQL\nseeded\n');
  g(seed, 'commit', '-qam', 'BUILD-LOG: row 23 proof');
  g(seed, 'push', '-q', 'origin', 'office/pixel-b1e9');
  // A docs-only branch ahead of main doesn't count as build work.
  g(seed, 'checkout', '-q', '-b', 'office/pixel-9dad', 'main');
  put(seed, 'docs/handover.md', 'handover');
  g(seed, 'add', '.');
  g(seed, 'commit', '-qm', 'handover draft');
  g(seed, 'push', '-q', 'origin', 'office/pixel-9dad');
  const floor = path.join(root, 'floor');
  g(root, 'clone', '-q', origin, floor);
  return { floor, g, seed, put };
}

const runner = (tmp: string) =>
  new Promise<string>((resolve, reject) => {
    execFileOff(process.execPath, [FAKE, tmp], { cwd: tmp, env: process.env, windowsHide: true, timeout: 60_000 }, (err, out) => (err ? reject(new Error(`${err.message}: ${err.stderr ?? ''}`)) : resolve(String(out))));
  });

const PULLS = [{ number: 6, title: 'Stage 5 build: sheet core, form, save/submit, pages, photo upload', state: 'OPEN', isDraft: false, headRefName: 'office/pixel-b1e9', baseRefName: 'main' }] as unknown as GhPull[];

test('a synthetic migration project: the signed BRD gate-check misses is flagged, and Build reads in progress from main and the open branch', async (t) => {
  const { floor, g, seed, put } = project(t);
  const status = g(floor, 'status', '--porcelain');
  const gates = new GateSource(runner, { fetch: false, throttleMs: 0 });
  t.after(() => gates.stop());
  await gates.read(floor, false);
  for (let i = 0; i < 400 && gates.busy(floor); i++) await new Promise((r) => setTimeout(r, 25));
  const r = await gates.read(floor, false);
  assert.ok(r);
  assert.equal(r.check.source, 'office');
  const view = setupViewOf(r.files);
  assert.equal(view.verdicts?.find((v) => v.id === '2')?.status, 'PENDING', 'the fake gate-check reads the per-source knowledge base only, as the real one does');
  const seen = await evidenceFor(floor, 'main', r.check.sha!, PULLS);
  assert.ok(seen);
  assert.deepEqual(seen.kb.nested, ['analysis/legacy/knowledge-base']);
  assert.deepEqual(seen.build.merged.map((p) => [p.number, p.rows?.length]), [[3, 11]], 'PR #4 changed no build file');
  assert.deepEqual(seen.build.open.map((b) => [b.branch, b.pr?.number, b.rows]), [['office/pixel-b1e9', 6, [15, 17, 23]]], 'the docs-only branch is not build work');
  assert.deepEqual(seen.build.rows, { main: [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14], branch: [15, 17, 23], mentioned: [16] }, 'a draft only mentions row 16');
  assert.equal(seen.build.plan?.built, 0);
  assert.equal(seen.build.plan?.total, 33);
  assert.equal(seen.build.log?.entries, 1);
  assert.equal(seen.build.scripts, 1);
  const ev = stageEvidence(view, r.files['PROJECT.md'], r.check, seen)!;
  assert.equal(ev.stage?.id, '5');
  const brd = ev.flags.find((f) => f.kind === 'brd-path');
  assert.equal(brd?.text, "gate-check didn't find the BRD at analysis/legacy/knowledge-base/brd/; it's at analysis/knowledge-base/brd/F001-check-sheet.brd.json");
  const ps = derivePhases({ toolkit: true, entry: 'migration', verdicts: view.verdicts ?? [], decisions: view.decisions ?? [], acceptance: ACCEPTANCE, stage: ev.stage!.id, build: ev.build });
  assert.equal(phase(ps, '2').measures[0], 'Signed off (gate-check says PENDING: no brd/*.brd.json scaffolds yet)');
  assert.equal(phase(ps, '5').status, 'active');
  assert.equal(phase(ps, '5').measures[0], 'In progress: 11 of 33 build-plan rows with build evidence on main (rows 4–14), 3 more on office/pixel-b1e9 (PR #6, open)');
  assert.equal(ev.flags.find((f) => f.kind === 'build-plan')?.text, 'The build plan says 0 of 33 rows built; commits on main show build evidence for rows 4–14');
  // A squash merge ("Title (#N)") with build files counts too.
  g(seed, 'checkout', '-q', '-b', 'squash-demo', 'main');
  put(seed, 'mdlsource/seed/labels.json', '[]');
  g(seed, 'add', '.');
  g(seed, 'commit', '-qm', 'Seed labels data file (rows 21-22) (#9)');
  g(seed, 'push', '-q', 'origin', 'squash-demo');
  g(floor, 'fetch', '-q', 'origin');
  assert.deepEqual((await mergedBuildPrs(floor, 'origin/squash-demo')).map((p) => [p.number, p.title, p.rows?.length]), [[9, 'Seed labels data file (rows 21-22)', 2], [3, 'Stage 5 build: frame, domain, seed (rows 4-14)', 11]]);
  // Nothing written to the floor.
  assert.equal(g(floor, 'status', '--porcelain'), status);
});
