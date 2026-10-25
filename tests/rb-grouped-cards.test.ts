// Real-build fixes: duplicate cards grouped under their gate or blocker, with one count
// (docs/mockups/product-assessment/real-build-test.md P2-1). The Stage 2 gate showed as 12 decisions (the gate plus
// its 11 positions as question cards); the test-database blocker as an action plus four cards harvested from the
// same reply.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { collectDecisions, hereCount, type NeedsInput } from '../src/shared/needsyou.js';
import { gateIds } from '../src/shared/decisions/candidates.js';
import type { Escalation } from '../src/shared/roster/escalation.js';
import type { RosterView } from '../src/shared/roster/types.js';
import type { QuestionBrief, QuestionsNeed } from '../src/shared/questions.js';
import type { WorkerInfo } from '../src/shared/protocol.js';
import { Roster } from '../src/server/roster/index.js';
import type { TeamFloor } from '../src/server/roster/types.js';
import { fileReplyAsks } from '../src/server/roster/reply-asks.js';

const NOW = Date.UTC(2026, 9, 25, 10, 0);
const esc = (id: string, title: string, o: Partial<Escalation> = {}): Escalation => ({ id, at: NOW - 60_000, workerId: 'w1', by: 'Alan', role: 'pm', urgency: 'important', fyi: false, level: 2, title, details: '', options: [], status: 'open', refs: {}, ...o }) as Escalation;
const roster = (escalations: Escalation[]): RosterView => ({ floor: 'f1', admin: true, escalations, approvals: [], members: [], settings: {} }) as unknown as RosterView;
const input = (o: Partial<NeedsInput>): NeedsInput => ({ floor: 'f1', workers: [], pulls: [], floors: [], now: NOW, ...o });
const brief = (n: number): QuestionBrief => ({ key: `F001-equipment-loans.brd.json#Q-${String(n).padStart(2, '0')}`, id: `Q-${String(n).padStart(2, '0')}`, file: 'F001-equipment-loans.brd.json', brd: 'F001', question: `Position ${n}?`, state: 'RAISED', where: 'main' });

test('a stage gate naming its positions folds their question cards under it: one card, one count, the gate leading', () => {
  const gate = esc('g2', 'Stage 2 gate: BRD drafted, 11 positions to confirm', { details: 'Positions Q-01..Q-11 in F001, each with a recommendation.' });
  assert.equal(gateIds(gate).length, 11);
  assert.deepEqual(gateIds(esc('x', 'Merge rows 7-9', { details: 'Q-01..Q-03' })), [], 'only a gate');
  const items = Array.from({ length: 11 }, (_, i) => brief(i + 1));
  const questions: QuestionsNeed = { floor: 'f1', waiting: 11, brds: 1, blocking: 0, batch: 1, items };
  const { cards, needs } = collectDecisions(input({ roster: roster([gate]), questions }));
  assert.equal(cards.length, 1, `one card, not ${cards.length}`);
  assert.equal(cards[0].sources.length, 12, 'every source listed on it');
  assert.equal(cards[0].sources[0].type, 'escalation', 'the gate leads');
  assert.equal(hereCount(needs), 1, 'one count');
  // Without the gate the questions are their own cards, as before.
  assert.equal(collectDecisions(input({ questions })).cards.length, 11);
});

class FakeFloor implements Partial<TeamFloor> {
  id = 'f1';
  name = 'f1';
  dir = mkdtempSync(path.join(os.tmpdir(), 'rb-grouped-'));
  workers = () => [];
  worker = () => undefined;
  toast = () => undefined;
  changed = () => undefined;
}

test('a blocker and the items harvested from the same reply are one card with one count', () => {
  const clock = { now: NOW };
  const floor = new FakeFloor() as unknown as TeamFloor;
  const r = new Roster({ dataDir: mkdtempSync(path.join(os.tmpdir(), 'rb-grouped-data-')), floors: () => [floor], makeIssue: async () => ({ number: 1 }), analysis: () => '', now: () => clock.now }, 0);
  const w = { id: 'w1', name: 'Alan', kind: 'agent' } as WorkerInfo;
  // The agent's own action, raised in its turn.
  const own = esc('a1', 'Unit tests and journeys cannot run on this machine: a database step only a person can do', { at: NOW - 2 * 60_000 });
  r.data('f1').escalations.push(own);
  // Its turn-ending reply lists more for the PM: harvested.
  const reply = [
    'Status: rows 7-9 applied. These need your hands:',
    '1. Create the database RbEquipmentLoans_test owned by mendix, or give me a superuser.',
    '2. Tell me once the test database exists so I can run the unit tests.',
    '3. Get someone to install Playwright so the journeys can run.',
  ].join('\n');
  const filed = fileReplyAsks(r, floor, w, reply);
  assert.ok(filed.raised.length >= 2, `harvested ${filed.raised.length}`);
  const escs = r.data('f1').escalations;
  const groups = new Set(escs.map((e) => e.group));
  assert.equal(groups.size, 1, 'the action and every harvested item share one group');
  const { cards, needs } = collectDecisions(input({ roster: roster(escs) }));
  assert.equal(cards.length, 1, `one card, not ${cards.length}`);
  assert.equal(cards[0].sources[0].escalation, 'a1', 'the agent’s own action leads');
  assert.equal(hereCount(needs), 1);
  r.stop();
});
