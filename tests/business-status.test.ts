// The business status (C2, shared/business-status.ts): one pure function over the records the office keeps,
// table-driven across the scenarios that matter (nothing running, journeys passed on an old build or on the
// served one, a failing check, the security baseline missing, an unreviewed merge, accepted then main moved,
// a recorded deployment, the approval policy on and off), and the views that now read it (the progress bar's
// label, Home's project row, the Overview's Details, the phone's Status card, the Teams digest) showing the
// same status for the same records. Neutral example data only (Acme Portal).
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { installFakeDom, FakeEl } from './support/fakedom.js';

installFakeDom();
(globalThis as { fetch?: unknown }).fetch = async () => ({ ok: false, json: async () => ({}) });

const { businessStatus, businessStatuses, businessStatusMemo, businessChip, summaryOf, BUSINESS_WORDS } = await import('../src/shared/business-status.js');
type BusinessInput = import('../src/shared/business-status.js').BusinessInput;
type BusinessMilestone = import('../src/shared/business-status.js').BusinessMilestone;
const { progressLabel, derivePhases } = await import('../src/shared/progress.js');
const { detailRows } = await import('../src/client/ui/portal/overview-logic.js');
const sections = await import('../src/client/start/sections.js');
const { statusCard } = await import('../src/client/mobile/status.js');
const { digestCard } = await import('../src/server/notify-teams/cards.js');
const { buildDigest } = await import('../src/server/notify-teams/digest.js');

const OLD = 'a'.repeat(40);
const SERVED = 'b'.repeat(40);
const MAIN = 'c'.repeat(40);
const text = (el: { textContent: string }) => el.textContent.replace(/\s+/g, ' ');

const all = (over: Partial<BusinessMilestone> = {}): BusinessMilestone => ({ id: 'all', title: 'the whole build plan', state: 'ready', journeys: [{ id: 'J1', result: 'passed' }], rows: [1, 2], inLive: [1, 2], ...over });
const phase = (over: Partial<BusinessMilestone> = {}): BusinessMilestone => ({ id: 'phase-1', title: 'Frame and skeleton', state: 'ready', journeys: [{ id: 'J1', result: 'passed' }], rows: [1], inLive: [1], ...over });

/** Everything verified at the served revision, not accepted: the baseline the scenarios change one thing of. */
function base(over: Partial<BusinessInput> = {}, ms: BusinessMilestone[] = [phase(), all()]): BusinessInput {
  return {
    main: { sha: SERVED, branch: 'main' },
    live: { running: true, served: SERVED },
    readiness: { sha: SERVED, milestones: ms },
    work: { open: 0, openPrs: [], unreviewed: [] },
    checks: { revision: SERVED, required: [{ label: 'pr-checks run', state: 'passed' }] },
    security: { revision: SERVED, meets: true, enforced: true, missing: [] },
    acceptance: { version: 'v1', changed: [] },
    policy: { on: false },
    ...over,
  };
}

const accepted = (commit = SERVED, extra: { deploy?: string } = {}) => ({ version: 'v1', accepted: { commit, branch: 'main', at: Date.UTC(2026, 9, 20), by: 'Pat', ...extra }, changed: [] as string[] });

const SCENARIOS: { name: string; input: BusinessInput; state: string; revision?: string; kind?: string; missing?: RegExp; notes?: RegExp }[] = [
  { name: 'nothing read at all', input: {}, state: 'unknown', missing: /couldn't be read/ },
  { name: 'live app never started', input: { main: { sha: MAIN } }, state: 'work-in-progress', revision: MAIN, kind: 'main', missing: /hasn't run since the office started/ },
  { name: 'live app stopped, open work listed', input: { main: { sha: MAIN }, live: { running: false }, work: { open: 2, openPrs: [{ number: 6, checks: 'fail' }], unreviewed: [] } }, state: 'work-in-progress', revision: MAIN, missing: /isn't running/ },
  { name: 'running, no build plan', input: base({ readiness: { sha: SERVED, milestones: [], note: 'no build plan' } }), state: 'ready-to-try', revision: SERVED, kind: 'served', missing: /no build plan/ },
  { name: 'running, readiness of another build', input: base({ readiness: { sha: OLD, milestones: [all()] } }), state: 'ready-to-try', revision: SERVED, missing: /isn't worked out yet/ },
  { name: 'part of the plan in the running build', input: base({}, [all({ state: 'branch', inLive: [1], onBranch: [{ branch: 'feat/x', pr: 6, rows: [2] }] })]), state: 'ready-to-try', revision: SERVED, missing: /BUILD row 2 in PR #6, not merged/ },
  { name: 'none of it in the running build', input: base({ main: { sha: MAIN } }, [all({ state: 'refresh', inLive: [], onMain: [1, 2] })]), state: 'work-in-progress', revision: MAIN, kind: 'main', missing: /merged to main, not in the running build yet/ },
  { name: 'built, no journeys at all', input: base({ checks: { revision: SERVED, required: [{ label: 'pr-checks run', state: 'missing' }] } }, [all({ state: 'no-evidence', journeys: [] })]), state: 'ready-for-review', revision: SERVED, missing: /no journey evidence for bbbbbbb/ },
  { name: 'journeys passed on an old build only (not run on the served one)', input: base({ checks: { revision: SERVED, required: [{ label: 'pr-checks run', state: 'missing' }] } }, [all({ state: 'unverified', journeys: [{ id: 'J1', result: 'not-run' }] })]), state: 'ready-for-review', missing: /J1 not run against bbbbbbb/ },
  { name: 'journeys passed on the served build, everything else too', input: base(), state: 'verification-passed', revision: SERVED, kind: 'served', missing: /v1 not accepted for bbbbbbb yet/ },
  { name: 'a failing check', input: base({ checks: { revision: SERVED, required: [{ label: 'pr-checks run', state: 'failed' }] } }), state: 'verification-incomplete', missing: /checks failed on bbbbbbb: pr-checks run/ },
  { name: 'checks evaluated at another revision count as none', input: base({ checks: { revision: OLD, required: [{ label: 'pr-checks run', state: 'passed' }] } }), state: 'verification-incomplete', missing: /required checks not evaluated at bbbbbbb/ },
  { name: 'security baseline missing (enforced)', input: base({ security: { revision: SERVED, meets: false, enforced: true, missing: ['No mx check at bbbbbbb yet'] } }), state: 'verification-incomplete', missing: /security baseline missing: No mx check at bbbbbbb yet/ },
  { name: 'security baseline advisory: a note, not a blocker', input: base({ security: { revision: SERVED, meets: false, enforced: false, missing: ['Strict mode is off'] } }), state: 'verification-passed', notes: /advisory/ },
  { name: 'security not checked at the served revision', input: base({ security: undefined }), state: 'verification-incomplete', missing: /security baseline not checked at bbbbbbb/ },
  { name: 'unreviewed head (merge gate)', input: base({ work: { open: 0, openPrs: [], unreviewed: [{ pr: 12 }] } }), state: 'verification-incomplete', missing: /unreviewed head: PR #12 merged without a review that counts/ },
  { name: 'accepted at the served commit', input: base({ acceptance: accepted() }), state: 'accepted', revision: SERVED, kind: 'accepted', missing: /no deployment recorded/ },
  { name: 'accepted, then main moved: judged again, never accepted because the old one was', input: base({ acceptance: { ...accepted(OLD), changed: ['main moved from aaaaaaaa to bbbbbbbb'] } }), state: 'verification-passed', revision: SERVED, missing: /v1 was accepted at aaaaaaa: reopen it/, notes: /Changed since v1 acceptance/ },
  { name: 'accepted, main moved, the new build unverified', input: base({ acceptance: { ...accepted(OLD), changed: ['main moved'] }, checks: { revision: SERVED, required: [{ label: 'pr-checks run', state: 'failed' }] } }), state: 'verification-incomplete', notes: /Changed since v1 acceptance/ },
  { name: 'deployed (recorded)', input: base({ acceptance: accepted(SERVED, { deploy: 'Deployed to acceptance env 21 Oct' }) }), state: 'deployed-recorded', revision: SERVED, kind: 'accepted', notes: /Deploy: Deployed to acceptance env/ },
  { name: 'policy on, accepted, not submitted', input: base({ acceptance: accepted(), policy: { on: true } }), state: 'accepted', missing: /not submitted for release review/ },
  { name: 'policy on, submitted', input: base({ acceptance: accepted(), policy: { on: true, review: { state: 'submitted', revision: SERVED } } }), state: 'submitted' },
  { name: 'policy on, changes requested', input: base({ acceptance: accepted(), policy: { on: true, review: { state: 'changes', revision: SERVED } } }), state: 'changes-requested' },
  { name: 'policy on, approval for another commit does not count', input: base({ acceptance: accepted(), policy: { on: true, review: { state: 'approved', revision: OLD } } }), state: 'accepted' },
  { name: 'policy on, approved, then deployed', input: base({ acceptance: accepted(SERVED, { deploy: 'prod 22 Oct' }), policy: { on: true, review: { state: 'approved', revision: SERVED } } }), state: 'deployed-recorded' },
  { name: 'policy on, approved, no deployment yet', input: base({ acceptance: accepted(), policy: { on: true, review: { state: 'approved', revision: SERVED } } }), state: 'release-approved', missing: /no deployment recorded/ },
];

for (const s of SCENARIOS) {
  test(`business status: ${s.name} → ${s.state}`, () => {
    const out = businessStatus(s.input);
    assert.equal(out.state, s.state, out.line);
    assert.equal(out.label, BUSINESS_WORDS[out.state]);
    if (s.revision) assert.equal(out.revision, s.revision, 'names the revision it is about');
    if (s.kind) assert.equal(out.revisionKind, s.kind);
    if (s.missing) assert.ok(out.missing.some((m) => s.missing!.test(m)), `missing: ${out.missing.join(' | ')}`);
    if (s.notes) assert.ok(out.notes.some((m) => s.notes!.test(m)), `notes: ${out.notes.join(' | ')}`);
    assert.ok(out.line.startsWith(out.label), 'the line leads with the label');
    if (out.missing.length) assert.ok(out.line.includes(out.missing[0]), 'and says the first thing missing');
  });
}

test('missing evidence never counts as passed: every input left out keeps it from Verification passed', () => {
  for (const drop of ['checks', 'security', 'work'] as const) {
    const i = base();
    delete i[drop];
    const out = businessStatus(i);
    assert.notEqual(out.state, 'verification-passed', `${drop} unknown`);
    assert.ok(out.missing.length > 0);
  }
});

test('a milestone has its own status from the same records, and the project status is the whole plan', () => {
  const i = base({}, [phase(), all({ state: 'branch', inLive: [1], onBranch: [{ branch: 'feat/x', rows: [2] }] })]);
  const { project, milestones } = businessStatuses(i);
  assert.equal(project.state, 'ready-to-try');
  assert.equal(milestones.length, 1);
  assert.equal(milestones[0].about, 'phase-1');
  assert.equal(milestones[0].state, 'verification-passed');
  assert.match(milestones[0].line, /^Frame and skeleton: Verification passed/);
  assert.equal(businessStatus({ ...i, milestone: 'phase-9' }).state, 'unknown');
});

test('deterministic and memoised per input', () => {
  const a = businessStatusMemo(base());
  assert.equal(businessStatusMemo(base()), a, 'the same records: the same answer, worked out once');
  assert.deepEqual(businessStatus(base()), a);
  assert.notEqual(businessStatusMemo(base({ live: { running: true, served: OLD } })), a);
});

test('the tone: good once verified or accepted, bad on a failure, busy otherwise', () => {
  assert.equal(businessStatus(base()).tone, 'good');
  assert.equal(businessStatus(base({ checks: { revision: SERVED, required: [{ label: 'x', state: 'failed' }] } })).tone, 'bad');
  assert.equal(businessStatus(base({ security: undefined })).tone, 'busy');
  assert.equal(businessStatus({}).tone, 'idle');
});

// ---- The views that read it say the same thing --------------------------------------------------------

const FIXTURE = base({ security: { revision: SERVED, meets: false, enforced: true, missing: ['No mx check at bbbbbbb yet'] } });

test('every switched view shows the same status for the same records', () => {
  const s = businessStatus(FIXTURE);
  const sum = summaryOf(s);
  assert.equal(s.state, 'verification-incomplete');
  // The progress bar's label once every stage passed (and for a project without toolkit stages).
  const phases = derivePhases({ toolkit: true, entry: 'greenfield', verdicts: ['P', '0', '5', '6'].map((id) => ({ id, status: 'PASS' })), decisions: [], acceptance: { version: 'v1', cycle: 1, earlier: [] } });
  assert.equal(progressLabel({ phases, acceptance: { version: 'v1', cycle: 1, earlier: [] }, business: sum }), `v1 · ${s.label}`);
  const plain = derivePhases({ toolkit: false, verdicts: [], decisions: [], acceptance: { version: 'v1', cycle: 1, earlier: [] } });
  assert.equal(progressLabel({ phases: plain, acceptance: { version: 'v1', cycle: 1, earlier: [] }, business: sum }), `Delivery · ${s.label}`);
  // The Overview's Details: a Status row with the label, the revision and what's missing under it.
  const rows = detailRows({ live: { status: 'running', url: 'http://localhost:8080/', business: { label: s.label, line: s.line } } });
  const row = rows.find((r) => r.label === 'Status')!;
  assert.equal(row.value, s.label);
  assert.match(row.sub!, /running bbbbbbb · security baseline missing/);
  assert.ok(!rows.some((r) => /not ready yet|^ready$/.test(r.sub ?? '')), 'no second "ready" of its own');
  // Home's project row.
  const floor = { id: 'acme-portal', name: 'Acme Portal', dir: 'C:/p/acme-portal', palette: 1, addedBy: 'Ada', addedAt: 1, workers: 1, busy: 0, waiting: 0, people: 0, wing: 0 };
  const home = sections.projectRow({ f: floor as never, facts: { floor: 'acme-portal', needs: 0, stuck: 0, failing: 0, live: { status: 'running', viewPort: 9, served: 'bbbbbbb' }, business: sum }, open: () => {} }) as unknown as FakeEl;
  assert.equal(home.querySelector('.st-business')?.textContent, businessChip(sum).text);
  assert.match(text(home), /Verification incomplete · bbbbbbb/);
  assert.match(text(home), /Live app running bbbbbbb/);
  // The phone's Status card.
  const act = { go() {}, raiseCap() {}, hire() {}, pause() {}, resume() {} };
  const card = statusCard({ floor: 'acme-portal', name: 'Acme Portal', working: 0, asleep: 0, asking: 0, idle: 1, escalations: 0, business: sum } as never, true, undefined, act as never) as unknown as FakeEl;
  assert.match(text(card.querySelector('.m-business')!), new RegExp(s.line.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  // The Teams digest.
  const d = buildDigest({ floor: 'acme-portal', project: 'Acme Portal', now: Date.now(), pulls: [], needs: [], status: s.line });
  assert.equal(d.status, s.line);
  assert.ok(JSON.stringify(digestCard(d)).includes('"title":"Status"'));
  assert.ok(JSON.stringify(digestCard(d)).includes(s.label));
});

test('the server side: what it reads for a project with nothing recorded yet, kept a few seconds', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'bs-'));
  try {
    const { businessInputOf, businessViewOf } = await import('../src/server/business-status/index.js');
    const ctx = { cfg: { dataDir: dir }, floors: new Map() } as never;
    const floor = { id: 'acme-portal', dir, def: { name: 'Acme Portal' }, github: { pulls: { items: [] } } } as never;
    const input = await businessInputOf(ctx, floor);
    assert.equal(input.live, undefined, 'no live app made: unknown, not "down"');
    assert.deepEqual(input.acceptance, { version: 'v1', changed: [] });
    assert.deepEqual(input.policy, { on: false });
    const v = await businessViewOf(ctx, floor, undefined, 1_000);
    assert.equal(v!.project.state, 'unknown');
    assert.equal(await businessViewOf(ctx, floor, undefined, 2_000), v, 'shared while fresh');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
