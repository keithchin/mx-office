// The project progress bar's phases (shared/progress.ts): the toolkit's stages less the ones the entry mode
// doesn't run (unless something is in one after all), then Handover and Accepted; only measured facts
// ("3 of 5 deliverables on main", a gate's verdict, a decision's date), and unknown shown as unknown,
// never a count or percentage nobody measured.
import test from 'node:test';
import assert from 'node:assert/strict';
import { derivePhases, progressLabel, spendText, stagesFor, waitsOnPerson, type ProgressAcceptance, type ProgressInput, type VerdictIn } from '../src/shared/progress.js';

const open: ProgressAcceptance = { version: 'v1', cycle: 1, earlier: [] };
const v = (id: string, status: string, detail?: string): VerdictIn => ({ id, title: `Stage ${id}`, status, ...(detail ? { detail } : {}) });
const input = (over: Partial<ProgressInput> = {}): ProgressInput => ({ toolkit: true, entry: 'requirements-driven', verdicts: [], decisions: [], acceptance: open, ...over });
const ids = (p: { id: string }[]) => p.map((x) => x.id);

test('entry modes skip the stages they do not run', () => {
  assert.deepEqual(ids(stagesFor('greenfield', [])), ['P', '0', '5', '6']);
  assert.deepEqual(ids(stagesFor('requirements-driven', [])), ['P', '0', '1', '2', '3', '4', '5', '6']);
  assert.deepEqual(ids(stagesFor('existing-app-change', [])), ['P', '0', '1', '2', '3', '4', '5', '6']);
  assert.deepEqual(ids(stagesFor('migration', [])), ['P', '0', '1', '2', '3', '4', '5', '6', '7']);
  assert.deepEqual(stagesFor('assurance', []), []);
  // Not recorded: every stage, as gate-check does with no mode to excuse any.
  assert.equal(stagesFor(undefined, []).length, 9);
});

test('a skipped stage with something in it comes back (a greenfield build plan still needs its sign-off)', () => {
  assert.deepEqual(ids(stagesFor('greenfield', [v('4', 'FAIL', 'build-plan.md exists — ✋ gate'), v('1', 'WAIVED'), v('7', 'PENDING')])), ['P', '0', '4', '5', '6']);
});

test('phases end with Handover and Accepted, and the current one is the first not settled', () => {
  const p = derivePhases(input({ verdicts: [v('P', 'PASS'), v('0', 'PASS'), v('1', 'WAIVED'), v('2', 'PENDING')] }));
  assert.deepEqual(ids(p), ['P', '0', '1', '2', '3', '4', '5', '6', 'handover', 'accepted']);
  assert.deepEqual(p.filter((x) => x.current).map((x) => x.id), ['2']);
  assert.equal(p.find((x) => x.id === '1')!.status, 'waived');
});

test('only measured counts: deliverables "x of y on main", BRDs without a made-up total; unscanned leaves them out', () => {
  const scanned = derivePhases(
    input({
      verdicts: [v('2', 'PENDING')],
      deliverables: [{ stage: '2', expected: 3, present: 1, branch: 1, draft: 0, missing: 1, items: [{ title: 'BRDs', status: 'present', files: 4 }] }],
      brds: 4,
    }),
  );
  const two = scanned.find((x) => x.id === '2')!;
  assert.ok(two.measures.includes('1 of 3 deliverables on main (+1 on a branch)'));
  assert.ok(two.measures.some((m) => m.startsWith('4 BRDs on main') && /isn't recorded/.test(m)));
  // Some work there but no verdict past PENDING yet: in progress, not "not started".
  assert.equal(two.status, 'active');
  assert.ok(!two.measures.some((m) => /%/.test(m)), 'never a percentage');
  const mini = derivePhases(input({ verdicts: [v('2', 'PENDING')] }));
  assert.ok(!mini.find((x) => x.id === '2')!.measures.some((m) => /deliverable/.test(m)), 'no scan, no counts (not zeros)');
  assert.equal(mini.find((x) => x.id === '2')!.deliverables, undefined);
});

test('no dashboard: each stage is unknown, said so, never passed or zero', () => {
  const p = derivePhases(input());
  for (const ph of p.filter((x) => x.kind === 'stage')) {
    assert.equal(ph.status, 'unknown');
    assert.match(ph.measures[0], /unknown/);
  }
  assert.equal(p.find((x) => x.id === '3')!.milestones[0].status, 'unknown');
});

test('✋ gates: artifacts without a sign-off wait on someone; a CONFIRMED row passes the gate with its date', () => {
  const p = derivePhases(
    input({
      verdicts: [v('0', 'PASS'), v('3', 'FAIL', 'artifacts exist but no Stage-3 CONFIRMED decision — ✋ gate'), v('5', 'FAIL', 'module CE errors')],
      decisions: [
        { stage: '0', decision: 'Reuse the extractor', status: 'CONFIRMED 2026-09-18' },
        { stage: '0', decision: 'Order: billing first', status: 'ASSUMED' },
        { stage: '3', decision: 'Module boundaries', status: 'ASSUMED' },
      ],
    }),
  );
  const zero = p.find((x) => x.id === '0')!;
  assert.deepEqual(zero.milestones.map((m) => [m.kind, m.status, m.at]), [['gate', 'passed', '2026-09-18'], ['decision', 'assumed', undefined]]);
  const three = p.find((x) => x.id === '3')!;
  assert.equal(three.status, 'waiting');
  assert.equal(three.milestones[0].status, 'waiting');
  assert.equal(p.find((x) => x.id === '5')!.status, 'failed', 'a FAIL that is not a sign-off is failing');
  assert.equal(p.find((x) => x.id === '5')!.milestones.length, 0, 'Build is no ✋ gate');
});

test('spend: planned vs actual per stage, and a floor when calls were not priced', () => {
  const p = derivePhases(input({ verdicts: [v('1', 'PASS')], spend: { '1': { planned: 300, actual: 168.42, first: '2026-08-24', last: '2026-08-31', partial: true } } }));
  const one = p.find((x) => x.id === '1')!;
  assert.deepEqual(one.dates, { first: '2026-08-24', last: '2026-08-31' });
  assert.equal(spendText(one.spend), 'planned $300 · spent $168 + calls the office could not price');
  assert.equal(spendText({ actual: 2.5 }), 'no plan line · spent $2.50');
});

test('not a toolkit project, or assurance: one unknown Delivery phase, then Handover and Accepted', () => {
  for (const p of [derivePhases(input({ toolkit: false })), derivePhases(input({ entry: 'assurance' }))]) {
    assert.deepEqual(ids(p), ['delivery', 'handover', 'accepted']);
    assert.equal(p[0].status, 'unknown');
    assert.equal(p[1].status, 'unknown', 'handover is not recorded yet');
  }
});

test('acceptance: "v1 accepted · date", changed since, and a later cycle labelled by its version', () => {
  const at = Date.UTC(2026, 9, 3, 12);
  const acc = derivePhases(input({ verdicts: [v('P', 'PASS')], acceptance: { version: 'v1', cycle: 1, accepted: { at, by: 'Pat' }, changed: [], earlier: [] } }));
  assert.equal(acc.at(-1)!.status, 'done');
  assert.equal(progressLabel({ phases: acc, acceptance: { version: 'v1', cycle: 1, accepted: { at, by: 'Pat' }, earlier: [] } }), 'v1 accepted · 2026-10-03');
  const changed: ProgressAcceptance = { version: 'v1', cycle: 1, accepted: { at, by: 'Pat' }, changed: ['main moved'], earlier: [] };
  const ch = derivePhases(input({ acceptance: changed }));
  assert.equal(ch.at(-1)!.status, 'waiting');
  assert.match(progressLabel({ phases: ch, acceptance: changed }), /changed since/);
  const next: ProgressAcceptance = { version: 'v1.1', cycle: 2, earlier: [{ version: 'v1', at }] };
  const p2 = derivePhases(input({ verdicts: [v('P', 'PASS'), v('0', 'FAIL', '✋')], acceptance: next }));
  assert.equal(progressLabel({ phases: p2, acceptance: next }), 'v1.1 · Stage 0 · Triage · waiting on someone');
  assert.ok(p2.at(-1)!.measures.includes('v1 accepted 2026-10-03'), 'the earlier acceptance stays in view');
  const ready = derivePhases(input({ entry: 'greenfield', verdicts: ['P', '0', '5', '6'].map((id) => v(id, 'PASS')) }));
  assert.equal(progressLabel({ phases: ready, acceptance: open }), 'v1 ready for acceptance');
});

test('a click opens the setup panel while it shows, else the deliverables; Handover and Accepted the record', () => {
  const shown = derivePhases(input({ verdicts: [v('2', 'PASS')], setupShown: true }));
  assert.deepEqual(shown.map((p) => [p.id, p.open]).filter(([id]) => ['2', '5', 'handover', 'accepted'].includes(id)), [['2', 'setup'], ['5', 'deliverables'], ['handover', 'acceptance'], ['accepted', 'acceptance']]);
  const gone = derivePhases(input({ verdicts: [v('2', 'PASS')], setupShown: false }));
  assert.equal(gone.find((p) => p.id === '2')!.open, 'deliverables', 'past Stage 4 the setup panel is gone');
});

test('a gate failing only for a missing sign-off is waiting, not failed (a fresh project looked broken)', () => {
  const placeholder = `'Confirmed by:' still holds the shipped placeholder: "[user] on [date] — required before Phase 2/3 proceed."`;
  assert.equal(waitsOnPerson(placeholder), true);
  assert.equal(waitsOnPerson('artifacts exist but PROJECT.md has no Stage-3 CONFIRMED decision — ✋ gate'), true);
  assert.equal(waitsOnPerson('triage.md is missing'), false);
  assert.equal(waitsOnPerson(undefined), false);
  const phases = derivePhases(input({ entry: 'greenfield', verdicts: [v('P', 'PASS'), v('0', 'FAIL', placeholder)] }));
  assert.equal(phases.find((p) => p.id === '0')?.status, 'waiting');
  const broken = derivePhases(input({ entry: 'greenfield', verdicts: [v('P', 'PASS'), v('0', 'FAIL', 'triage.md is missing')] }));
  assert.equal(broken.find((p) => p.id === '0')?.status, 'failed');
});
