// Real-build fixes: the stage the Overview and Progress show follows the toolkit's real position. At kickoff
// a small tier's WAIVED Stages 1–4 put the project at "Stage 5 · Build", and a CONFIRMED artifact waiver at
// Stage 5 made Progress say "Build done" at row 5 of 29 (docs/mockups/product-assessment/real-build-test.md P1-5).
import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveStage } from '../src/shared/stage-derive.js';
import { derivePhases, type ProgressInput, type VerdictIn } from '../src/shared/progress.js';
import { signedOffIn } from '../src/shared/gate-play.js';

const v = (id: string, status: string, detail?: string): VerdictIn => ({ id, title: `Stage ${id}`, status, ...(detail ? { detail } : {}) });
const row = (stage: string, decision: string, status = 'CONFIRMED 2026-10-24') => ({ stage, decision, status });

// The register a new small greenfield project starts with (the wizard's rows), and gate-check at kickoff.
const KICKOFF_ROWS = [row('P', 'Entry mode: Greenfield'), row('P', 'Size tier: small'), row('0', 'Scope: project brief approved (docs/project-brief.md)')];
const KICKOFF = [v('P', 'PENDING', '5 intake questions still to ask'), v('0', 'FAIL', 'triage.md missing — ✋ gate needs sign-off'), v('1', 'WAIVED'), v('2', 'WAIVED'), v('3', 'WAIVED'), v('4', 'WAIVED'), v('5', 'MANUAL'), v('6', 'PENDING')];

test('at kickoff a small tier with Stages 1–4 waived is at Stage P, not Stage 5 · Build', () => {
  assert.equal(deriveStage(KICKOFF, KICKOFF_ROWS)?.id, 'P');
  // Once P passes and Stage 0 is signed off, the waived stages are skipped: the build is next.
  const later = [v('P', 'PASS'), v('0', 'PASS'), ...KICKOFF.slice(2)];
  assert.equal(deriveStage(later, KICKOFF_ROWS)?.id, '5');
  // A paperwork gap at P still doesn't pull back a project whose later stage passed.
  assert.equal(deriveStage([v('P', 'PENDING'), v('0', 'PASS'), v('1', 'WAIVED'), v('5', 'MANUAL')], [])?.id, '5');
});

test('an artifact waiver CONFIRMED at Stage 5 is not the Build sign-off: Progress shows Build in progress, not done', () => {
  const rows = [...KICKOFF_ROWS, row('5', 'Waived artifact improvement-register-html: small tier — the .md is the register')];
  assert.equal(signedOffIn(rows, '5'), false);
  assert.equal(signedOffIn([...rows, row('5', 'Build signed off: all 29 rows')], '5'), true);
  const input: ProgressInput = {
    toolkit: true,
    entry: 'greenfield',
    verdicts: [v('P', 'PASS'), v('0', 'PASS'), v('5', 'MANUAL'), v('6', 'PENDING')],
    decisions: rows,
    acceptance: { version: 'v1', cycle: 1, earlier: [] },
  };
  const build = derivePhases(input).find((p) => p.id === '5')!;
  assert.notEqual(build.status, 'done');
});

test('a scope answer CONFIRMED at Stage 0 does not read "✋ confirmed" while gate-check says the gate waits on its sign-off', () => {
  const input: ProgressInput = { toolkit: true, entry: 'greenfield', verdicts: KICKOFF, decisions: KICKOFF_ROWS, acceptance: { version: 'v1', cycle: 1, earlier: [] } };
  const triage = derivePhases(input).find((p) => p.id === '0')!;
  const gate = triage.milestones.find((m) => m.kind === 'gate')!;
  assert.equal(gate.status, 'waiting');
  // The sign-off row itself does pass it.
  const signed = derivePhases({ ...input, decisions: [...KICKOFF_ROWS, row('0', 'Stage 0 triage signed off by the PM')] }).find((p) => p.id === '0')!;
  assert.equal(signed.milestones.find((m) => m.kind === 'gate')!.status, 'passed');
});
