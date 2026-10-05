import test from 'node:test';
import assert from 'node:assert/strict';
import { badgeShown, badgeText, newStandup, stepIndex, teamAttention } from '../src/client/ui/chrome-logic.js';
import type { ApprovalItem } from '../src/shared/roster/types.js';
import type { Escalation } from '../src/shared/roster/escalation.js';

test('a badge shows a count, a bang or a dot, and nothing for zero', () => {
  assert.equal(badgeText(0), '');
  assert.equal(badgeText(null), '');
  assert.equal(badgeText(false), '');
  assert.equal(badgeText(3), '3');
  assert.equal(badgeText(120), '99+');
  assert.equal(badgeText('!'), '!');
  assert.equal(badgeText('dot'), '');
  assert.equal(badgeShown('dot'), true);
  assert.equal(badgeShown(0), false);
  assert.equal(badgeShown(-2), false);
  assert.equal(badgeShown(1), true);
});

test('the standup dot is up for a standup this browser has not seen', () => {
  assert.equal(newStandup(undefined, null), false);
  assert.equal(newStandup('2026-10-05', null), true);
  assert.equal(newStandup('2026-10-05', '2026-10-04'), true);
  assert.equal(newStandup('2026-10-05', '2026-10-05'), false);
});

test("the team boards count the teams' approvals and open escalations, each once", () => {
  const approval = (id: string, more: Partial<ApprovalItem> = {}): ApprovalItem => ({ id, kind: 'proposal', title: id, detail: '', ...more });
  const esc = (id: string, more: Partial<Escalation> = {}) => ({ id, team: 'development', status: 'open', ...more }) as Escalation;
  assert.equal(teamAttention(undefined), 0);
  assert.equal(
    teamAttention({
      approvals: [approval('a', { team: 'design' }), approval('b'), approval('c', { kind: 'escalation', team: 'development', escalationId: 'e1' })],
      escalations: [esc('e1'), esc('e2'), esc('e3', { status: 'resolved' }), esc('e4', { team: undefined })],
    }),
    // a and c (approvals with a team), e2 (open, a team's, not already an approval).
    3,
  );
});

test('arrow keys walk a dropdown round, Home and End go to its ends', () => {
  assert.equal(stepIndex(0, 'ArrowDown', 4), 1);
  assert.equal(stepIndex(3, 'ArrowDown', 4), 0);
  assert.equal(stepIndex(-1, 'ArrowDown', 4), 0);
  assert.equal(stepIndex(0, 'ArrowUp', 4), 3);
  assert.equal(stepIndex(2, 'ArrowUp', 4), 1);
  assert.equal(stepIndex(2, 'Home', 4), 0);
  assert.equal(stepIndex(0, 'End', 4), 3);
  assert.equal(stepIndex(0, 'Enter', 4), undefined);
  assert.equal(stepIndex(0, 'ArrowDown', 0), undefined);
});
