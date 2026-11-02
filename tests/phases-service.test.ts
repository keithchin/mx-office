// Phased delivery, the server side with fakes (server/phases/): the team proposes the phases, the PM approves
// them with edits (C-1, phase 1 starts), the team proposes a change that the PM accepts, edits first or
// declines, the PM edits with a reason, Go and Stop at a checkpoint, the office moving a met phase on; all
// written to <data>/phases/<project>.json, audited, the lead told. And the agents' MCP tools and CLI.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PhaseStore } from '../src/server/phases/store.js';
import { PhasesService } from '../src/server/phases/service.js';
import { exitOf } from '../src/shared/phases/derive.js';
import type { Who } from '../src/shared/phases/types.js';
import { handleMcp, parseArgs, TOOLS } from '../bin/office-workers.js';
import { formatPhases, parsePhases, phasesRequest } from '../bin/office-phases.js';

const lead: Who = { kind: 'agent', name: 'Robin', role: 'Project Coordinator' };
const pm: Who = { kind: 'pm', name: 'Alex Lee' };
const phases = [
  { name: 'Look and feel', goal: 'Tokens and layouts', foundation: true, rows: [1, 2], journeys: ['J-00'], estimate: { min: 20, max: 30 } },
  { name: 'Bookings', goal: 'Book a room', rows: [3, 4, 5], journeys: ['J-01', 'J-02'], estimate: { min: 60, max: 90 } },
  { name: 'Reports', goal: 'See usage', rows: [6], journeys: ['J-03'], estimate: { min: 20, max: 40 }, checkpoint: false },
];

function rig() {
  const dir = mkdtempSync(path.join(tmpdir(), 'phases-'));
  let now = Date.UTC(2026, 9, 20, 9);
  const audit: string[] = [];
  const told: string[] = [];
  const changed: string[] = [];
  const s = new PhasesService({ store: new PhaseStore(dir), now: () => now, record: (_f, by, action, summary) => audit.push(`${by.kind}:${action}:${summary}`), changed: (f) => changed.push(f), tellLead: async (_f, text) => (told.push(text), undefined) });
  return { dir, s, audit, told, changed, tick: (ms: number) => (now += ms), done: () => rmSync(dir, { recursive: true, force: true }) };
}

test('the team proposes, the PM approves with an edit: C-1, phase 1 starts, saved and audited, the lead told', async () => {
  const r = rig();
  try {
    assert.equal(r.s.propose('fl', lead, { kind: 'plan', phases, reason: '' }).ok, false, 'a reason is required');
    const p = r.s.propose('fl', lead, { kind: 'plan', phases, reason: 'Foundation first, then the two business areas' });
    assert.ok(p.ok && p.proposal?.id === 'P-1');
    assert.equal(r.s.plan('fl').state, 'proposed');
    const bad = r.s.propose('fl', lead, { kind: 'change', ops: [{ op: 'rename', phase: 'ph-2', name: 'X' }], reason: 'r' });
    assert.ok(!bad.ok && /waiting for the Build Plan gate/.test(bad.error));
    const a = r.s.approve('fl', pm, [{ op: 'move-rows', rows: [5], to: 'ph-3' }]);
    assert.ok(a.ok, !a.ok ? a.error : '');
    const plan = r.s.plan('fl');
    assert.equal(plan.state, 'approved');
    assert.equal(plan.phases[0].status, 'active');
    assert.deepEqual(plan.phases[2].rows, [5, 6]);
    assert.equal(plan.changes[0].id, 'C-1');
    assert.equal(plan.changes[0].kind, 'approve');
    assert.match(plan.changes[0].summary, /^3 phases approved at the Build Plan gate with one edit: Moved row 5 from 2 Bookings to 3 Reports$/);
    assert.equal(plan.changes[0].proposedBy.name, 'Robin');
    assert.equal(plan.proposals[0].status, 'accepted');
    const disk = JSON.parse(readFileSync(path.join(r.dir, 'phases', 'fl.json'), 'utf8'));
    assert.equal(disk.state, 'approved');
    assert.ok(r.audit.some((l) => l.startsWith('pm:phases.approved:C-1')));
    await new Promise((res) => setImmediate(res));
    assert.match(r.told.at(-1)!, /approved the phases.*Build starts with phase 1, Look and feel/);
    assert.ok(r.changed.length >= 2);
    const again = r.s.propose('fl', lead, { kind: 'plan', phases, reason: 'again' });
    assert.ok(!again.ok && /approved already/.test(again.error));
  } finally {
    r.done();
  }
});

test('change proposals: accept, edit first, decline; a PM edit needs a reason; done phases stay locked', () => {
  const r = rig();
  try {
    r.s.propose('fl', lead, { kind: 'plan', phases, reason: 'cut' });
    r.s.approve('fl', pm);
    const c = r.s.propose('fl', lead, { ops: [{ op: 'overlap', phase: 'ph-2', teams: ['design'], what: 'design' }], reason: 'Design ahead while the foundation is built' });
    assert.ok(c.ok && c.proposal?.kind === 'change');
    assert.match(c.proposal!.summary, /2 Bookings starts early \(design\)/);
    const acc = r.s.decide('fl', pm, 'P-2', 'accept');
    assert.ok(acc.ok);
    assert.equal(r.s.plan('fl').phases[1].early?.what, 'design');
    assert.equal(r.s.plan('fl').changes.at(-1)!.kind, 'overlap');
    r.s.propose('fl', lead, { ops: [{ op: 'move-rows', rows: [4], to: 'ph-3' }], reason: 'Needs the reporting base' });
    const ef = r.s.decide('fl', pm, 'P-3', 'accept', '', [{ op: 'move-rows', rows: [4, 5], to: 'ph-3' }]);
    assert.ok(ef.ok);
    assert.match(r.s.plan('fl').changes.at(-1)!.summary, /Moved rows 4, 5 .* \(edited by the PM\)$/);
    r.s.propose('fl', lead, { ops: [{ op: 'rename', phase: 'ph-3', name: 'Insights' }], reason: 'Clearer' });
    const dec = r.s.decide('fl', pm, 'P-4', 'decline', 'Keep the name');
    assert.ok(dec.ok);
    assert.equal(r.s.plan('fl').phases[2].name, 'Reports');
    assert.equal(r.s.plan('fl').proposals.at(-1)!.note, 'Keep the name');
    const noReason = r.s.edit('fl', pm, [{ op: 'toggle', phase: 'ph-3', publish: false }], '');
    assert.ok(!noReason.ok);
    const ed = r.s.edit('fl', pm, [{ op: 'toggle', phase: 'ph-3', publish: false }], 'Reports stay internal');
    assert.ok(ed.ok && ed.change?.proposedBy.kind === 'pm');
    // Phase 1 to its checkpoint, Go: done and locked; phase 2 starts.
    const plan = r.s.plan('fl');
    const x = { commit: 'abcdef1', journeyResults: { 'J-00': 'passed' } as Record<string, 'passed' | 'failed'>, modelCheck: { status: 'pass' as const, errors: 0, commit: 'abcdef1' }, openDataImpacts: 0 };
    const moved = r.s.tick('fl', new Map([['ph-1', exitOf(plan.phases[0], x, 0)]]));
    assert.deepEqual(moved.map((m) => m.to), ['checkpoint']);
    assert.ok(r.audit.some((l) => l.startsWith('office:phases.checkpoint:Look and feel passed its exit criteria at abcdef1')));
    assert.ok(r.s.go('fl', pm, 'ph-1').ok);
    assert.equal(r.s.plan('fl').phases[1].status, 'active');
    const locked = r.s.edit('fl', pm, [{ op: 'rename', phase: 'ph-1', name: 'Y' }], 'try');
    assert.ok(!locked.ok && /locked/.test(locked.error));
    assert.ok(!r.s.go('fl', pm, 'ph-2').ok, 'not at its checkpoint');
  } finally {
    r.done();
  }
});

test('Stop at a checkpoint stops early work on the next phase too', () => {
  const r = rig();
  try {
    r.s.propose('fl', lead, { kind: 'plan', phases, reason: 'cut' });
    r.s.approve('fl', pm);
    r.s.edit('fl', pm, [{ op: 'overlap', phase: 'ph-2', teams: ['design'], what: 'design' }], 'design ahead');
    const plan = r.s.plan('fl');
    r.s.tick('fl', new Map([['ph-1', exitOf(plan.phases[0], { journeyResults: { 'J-00': 'passed' }, modelCheck: { status: 'pass', errors: 0, commit: 'a1b2c3d' }, openDataImpacts: 0 }, 0)]]));
    assert.ok(r.s.stop('fl', pm, 'ph-1', 'Budget review').ok);
    const after = r.s.plan('fl');
    assert.equal(after.phases[0].status, 'stopped');
    assert.equal(after.phases[1].early, undefined);
    assert.equal(after.phases[1].status, 'planned');
  } finally {
    r.done();
  }
});

test('MCP tools: propose_phases, propose_phase_change and phases_status call /office/workers/phases', async () => {
  for (const n of ['propose_phases', 'propose_phase_change', 'phases_status']) assert.ok(TOOLS.some((t: { name: string }) => t.name === n), n);
  assert.deepEqual(phasesRequest('propose_phases', { reason: 'r', phases: [] }), { op: 'propose', kind: 'plan', reason: 'r', phases: [] });
  const seen: { url: string; body: unknown }[] = [];
  const fakeFetch = (async (url: string, init: { body?: string }) => {
    seen.push({ url, body: init.body ? JSON.parse(init.body) : undefined });
    return new Response(JSON.stringify({ ok: true, proposal: { id: 'P-2', kind: 'change', summary: 's' }, note: 'Proposed (P-2): the Project Manager decides on the Roadmap.' }), { status: 200 });
  }) as unknown as typeof fetch;
  const env = { AGENT_OFFICE_HOOK_URL: 'http://127.0.0.1:1', AGENT_OFFICE_WORKER_ID: 'w1', AGENT_OFFICE_HOOK_TOKEN: 't' };
  const res = (await handleMcp({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'propose_phase_change', arguments: { reason: 'r', ops: [{ op: 'rename', phase: 'ph-2', name: 'B' }] } } }, { env, fetch: fakeFetch })) as { result: { content: { text: string }[] } };
  assert.match(res.result.content[0].text, /^Proposed \(P-2\)/);
  assert.match(seen[0].url, /\/office\/workers\/phases\?worker=w1$/);
  assert.deepEqual((seen[0].body as { op: string; kind: string }).kind, 'change');
  assert.match(formatPhases({ state: 'approved', phases: [{ order: 1, id: 'ph-1', name: 'A', status: 'active', rows: [1], journeys: ['J-1'], estimate: { min: 1, max: 2 }, checkpoint: true, publish: false }], open: [], recent: [] }, 'status'), /1\. A \[ph-1\] active/);
  class U extends Error {}
  assert.deepEqual(parsePhases(['status'], U), { cmd: 'phases', op: 'status', json: false });
  assert.deepEqual(parseArgs(['phases', 'propose']), { cmd: 'phases', op: 'propose', json: false });
  assert.throws(() => parsePhases(['nope'], U), U);
});
