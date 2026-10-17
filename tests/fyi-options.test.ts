// FYI is information only: an agent's escalation that would be filed as FYI but has answer options (or a
// recommendation and a question, or names a sign-off such as CAC-3) is stored as a decision, audited as
// escalation.fyi-corrected, and the agent is told so. An open one stored as FYI before that (a migration project's
// ESC fb67d63102) is read as a decision card with its options, without rewriting it; a resolved one and an
// FYI the office filed itself stay FYI. Synthetic data only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { WorkerInfo } from '../src/shared/protocol.js';
import type { AuditInput } from '../src/shared/audit.js';
import { decisionReason, fyiNow, type Escalation, type EscalationAsk } from '../src/shared/roster/escalation.js';
import type { RosterView } from '../src/shared/roster/types.js';
import { collectDecisions } from '../src/shared/needsyou.js';
import { cardActs, cardCounts } from '../src/shared/decisions/words.js';
import { refsFromTitle } from '../src/shared/decisions/ids.js';
import { Roster } from '../src/server/roster/index.js';
import type { TeamFloor } from '../src/server/roster/types.js';
import { useAudit } from '../src/server/audit/index.js';
import { escalateNote } from '../src/server/hooks/office-escalate.js';

const events: AuditInput[] = [];
useAudit({ append: (e: AuditInput) => (events.push(e), { ...e, id: String(events.length), at: Date.now(), prev: '', hash: '' }) } as never);

class FakeFloor implements TeamFloor {
  id = `f${Math.random().toString(36).slice(2, 8)}`;
  name = 'test';
  dir = mkdtempSync(path.join(os.tmpdir(), 'fyi-floor-'));
  map = new Map<string, WorkerInfo>();
  toasts: string[] = [];
  workers = () => [...this.map.values()];
  worker = (id: string) => this.map.get(id);
  hire = async () => 'no';
  stop = async () => {};
  prompt = () => {};
  wake = () => undefined;
  rename = () => {};
  cwdOf = () => this.dir;
  openPulls = () => [];
  toast = (t: string) => void this.toasts.push(t);
  changed = () => {};
  activity = () => {};
  judged = () => {};
}

function setup() {
  const floor = new FakeFloor();
  const roster = new Roster({ dataDir: mkdtempSync(path.join(os.tmpdir(), 'fyi-data-')), floors: () => [floor], makeIssue: async () => ({ number: 7 }), analysis: () => '', now: () => Date.now() }, 0);
  const w = { id: 'w1', kind: 'agent', name: 'Ana', status: 'idle', viewers: [] } as unknown as WorkerInfo;
  floor.map.set(w.id, w);
  const ask = (title: string, o: Partial<EscalationAsk> = {}): EscalationAsk => ({ urgency: 'info', title, details: `About ${title}.`, options: [], ...o });
  const view = (escalations: Escalation[] = roster.escalations.view(floor)) => ({ floor: floor.id, admin: true, escalations, approvals: [], members: [], settings: {} }) as unknown as RosterView;
  return { floor, roster, w, ask, view };
}

test('an FYI with answer options is stored as a decision, audited, and the agent is told', async () => {
  const t = setup();
  const before = events.length;
  const { escalation: e, joined } = await t.roster.escalations.raiseOrJoinJudged(t.floor, t.w, t.ask('CAC-3: sign off BRD F001 and answer 8 open points before design', { options: ['Approve all defaults (1-8)', 'Approve with changes (name the numbers)', 'Not yet'], recommendation: 'Approve all defaults' }));
  assert.equal(joined, false);
  assert.equal(e.fyi, false);
  assert.equal(e.fyiCorrected, 'it has answer options');
  const fix = events.slice(before).find((x) => x.action === 'escalation.fyi-corrected');
  assert.ok(fix, 'audited');
  assert.equal(fix!.target?.id, e.id);
  assert.match(fix!.summary, /Filed as a decision, not FYI: it has answer options/);
  assert.equal(escalateNote(e, false, 'Ana').startsWith('Filed as a decision, not FYI: it has answer options. FYI is for information only.'), true);
  // Shown as a decision waiting on you, with its options.
  const { cards } = collectDecisions({ floor: t.floor.id, workers: [], pulls: [], floors: [], now: Date.now(), roster: t.view() });
  const c = cards.find((x) => x.escalation === e.id)!;
  assert.equal(c.kind, 'decision');
  assert.deepEqual(c.options, e.options);
  assert.equal(cardCounts([c]).decisions, 1);
});

test('an FYI without options stays FYI, with no correction and the FYI reply', async () => {
  const t = setup();
  const before = events.length;
  const { escalation: e } = await t.roster.escalations.raiseOrJoinJudged(t.floor, t.w, t.ask('Stage 1 extraction finished, 42 entities found'));
  assert.equal(e.fyi, true);
  assert.equal(e.fyiCorrected, undefined);
  assert.equal(events.slice(before).some((x) => x.action === 'escalation.fyi-corrected'), false);
  assert.match(escalateNote(e, false, 'Ana'), /^Filed as FYI/);
  assert.equal(fyiNow(e), true);
});

test('a recommendation with a question, or a named sign-off, is a decision; plain words naming an id are not', () => {
  const base = { options: [] as string[], details: '' };
  assert.equal(decisionReason({ ...base, title: 'Use the EU region for the database?', recommendation: 'EU' }), 'it has a recommendation and asks a question');
  assert.equal(decisionReason({ ...base, title: 'CAC-2 scope check ready' }), 'it names a sign-off (CAC-2)');
  assert.equal(decisionReason({ ...base, title: 'Please sign off OW-1' }), 'it asks for a decision on OW-1');
  assert.equal(decisionReason({ ...base, title: 'AC-09 test passed on main' }), undefined);
  assert.equal(decisionReason({ ...base, title: 'Approve Stage 2 so design can start' }), 'it asks for a decision on Stage 2');
  assert.equal(decisionReason({ ...base, title: 'Gate 3 passed' }), undefined);
  assert.equal(decisionReason({ ...base, title: 'Nightly build green' }), undefined);
});

test('an open FYI with options stored before the fix shows as a decision card with its options, unchanged on disk; a resolved one is untouched', () => {
  const t = setup();
  const title = 'CAC-3: sign off BRD F001 and answer 8 open points before design';
  const old: Escalation = { id: 'fb67d63102', at: Date.now() - 3_600_000, workerId: 'w1', by: 'Ana', role: 'chief-analyst' as never, urgency: 'info', fyi: true, level: 2, title, details: 'Eight open points, numbered.', options: ['Approve all defaults (1-8)', 'Approve with changes (name the numbers)', 'Not yet'], recommendation: 'Approve all defaults (1-8)', refs: { ...refsFromTitle(title), decisionId: 'CAC-3' }, status: 'open' };
  const done: Escalation = { ...old, id: 'r1', status: 'resolved', resolution: { verdict: 'dismiss', text: '', by: 'Keith', at: Date.now(), delivered: true, outcome: 'noted' } };
  assert.equal(fyiNow(old), false, 'read as a decision');
  assert.equal(fyiNow(done), true, 'a resolved one keeps its flag');
  const { cards, needs } = collectDecisions({ floor: t.floor.id, workers: [], pulls: [], floors: [], now: Date.now(), roster: t.view([old, done]) });
  const c = cards.find((x) => x.escalation === 'fb67d63102')!;
  assert.equal(c.kind, 'decision');
  assert.deepEqual(c.options, old.options);
  assert.equal(c.recommendation, old.recommendation);
  assert.ok(cardActs(c).includes('option'));
  assert.notEqual(c.level, 'info');
  assert.equal(cardCounts([c]).decisions, 1, 'waits on you');
  assert.equal(needs.find((n) => n.card === c.id)?.tag, 'INFO', 'not tagged FYI');
  assert.equal(old.fyi, true, 'the stored record is not rewritten');
  assert.equal(cards.some((x) => x.escalation === 'r1'), false);
});

test('an FYI the office files itself (a subagent gate, or noticed at the level) stays FYI even with options', () => {
  const t = setup();
  const e = t.roster.escalations.raiseFyi(t.floor, t.w, t.ask('Ana retired subagent writer: done', { options: ['Keep it retired'] }));
  assert.equal(e.fyi, true);
  assert.equal(e.fyiKept, true);
  assert.equal(fyiNow(e), true);
});
