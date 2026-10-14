// Nothing waits on the PM unseen, S2: the needs-human trigger (never FYI at any level), FYI escalations
// shown in Needs you as info rows that aren't counted, and hands-on standup proposals (human-action) that
// wait for the Project Manager at every level while a plain task is still the team's at level 4.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DECISION_KINDS, ESCALATION_TRIGGERS, isFyi, needsApproval, type AutonomyLevel } from '../src/shared/roster/autonomy.js';
import { collectNeeds, hereCount, type NeedsInput } from '../src/shared/needsyou.js';
import type { Escalation } from '../src/shared/roster/escalation.js';
import type { RosterView } from '../src/shared/roster/types.js';
import { parseProposal, parseStandup } from '../src/shared/roster/journal.js';
import { isHandsOn } from '../src/shared/roster/hands-on.js';
import { toProposals } from '../src/server/roster/standup.js';
import { isRedNeed } from '../src/shared/notify-teams.js';
import { parseEscalate, TRIGGERS, ESCALATE_USAGE } from '../bin/office-escalate.js';

const LEVELS: AutonomyLevel[] = [1, 2, 3, 4];
const esc = (id: string, o: Partial<Escalation> = {}): Escalation => ({ id, at: 0, workerId: 'w', by: 'Lead', urgency: 'important', fyi: false, level: 2, title: `esc ${id}`, details: '', options: [], status: 'open', ...o }) as Escalation;
const input = (escalations: Escalation[]): NeedsInput => ({ floor: 'f1', workers: [], pulls: [], floors: [], roster: { floor: 'f1', approvals: [], escalations, admin: true } as unknown as RosterView });

test('needs-human is never FYI, at any level or urgency', () => {
  assert.ok(ESCALATION_TRIGGERS.includes('needs-human'));
  assert.ok(TRIGGERS.includes('needs-human'), 'the CLI accepts it');
  for (const l of LEVELS) for (const u of ['info', 'important', 'urgent', 'critical'] as const) assert.equal(isFyi(l, u, 'needs-human'), false, `level ${l}, ${u}`);
  // A quiet `blocked` is still FYI at level 4: only the hands-on trigger is exempt.
  assert.equal(isFyi(4, 'info', 'blocked'), true);
  assert.equal(parseEscalate(['--title', 'Merge PR #51', '--trigger', 'needs-human'], Error).trigger, 'needs-human');
  assert.match(ESCALATE_USAGE, /--trigger needs-human/);
});

test('FYI escalations show as info rows, not counted; needs-human ones are ordinary escalations, counted and red', () => {
  const items = collectNeeds(input([esc('f', { fyi: true, title: 'Paste the key' }), esc('h', { trigger: 'needs-human', urgency: 'info', fyi: isFyi(4, 'info', 'needs-human') })]));
  assert.deepEqual(items.map((n) => [n.key, n.kind, n.level]), [['esc-h', 'escalation', 'warn'], ['fyi-f', 'fyi', 'info']]);
  assert.equal(hereCount(items), 1);
  assert.equal(items[1].tag, 'FYI');
  assert.deepEqual(items[1].target, { to: 'escalation', id: 'f' });
  // Teams and phone pushes: the FYI row never posts, the needs-human escalation does.
  assert.equal(isRedNeed(items[0]), true);
  assert.equal(isRedNeed(items[1]), false);
});

test('a hands-on proposal becomes human-action and waits for the PM at every level; a plain task is still auto at level 4', () => {
  assert.ok(DECISION_KINDS.includes('human-action'));
  for (const l of LEVELS) assert.equal(needsApproval(l, 'human-action'), true, `level ${l}`);
  for (const line of ['Merge PR #51 — it has sat four days', 'Run mxcli auth login on the build machine', 'Paste the Azure API key into .env', 'Install the JDK 21 on the machine', 'Restart the preview so the new theme loads', 'Allow the mxcli permission at the terminal']) {
    assert.equal(parseProposal(line)?.kind, 'human-action', line);
  }
  // The agent's own kind is kept when it names one.
  assert.equal(parseProposal('[human-action] Turn on SSO in the portal')?.kind, 'human-action');
  assert.equal(parseProposal('[design] Merge the two request pages — simpler')?.kind, 'design');
  // Conservative: the team's own work stays a task.
  for (const line of ['Build the login page', 'Add an API key field to Settings', 'Merge the Request and Trip entities', 'Install the Marketplace module docs in the wiki']) {
    assert.equal(parseProposal(line)?.kind, 'task', line);
    assert.equal(isHandsOn(line), false, line);
  }
  const parsed = parseStandup('### Proposals\n- Merge PR #51 — blocked four days\n- Add the approval email\n').proposals;
  const cards = toProposals(parsed, '2026-10-13', 'lead-developer', 'Dev', 4);
  assert.deepEqual(cards.map((c) => [c.kind, c.status]), [['human-action', 'pending'], ['task', 'auto']]);
});

test('with the Questions page merged: its row counts, the info rows (FYI, not on main) do not, and every row shows', () => {
  const offmain = { id: 'o1', kind: 'offmain' as const, level: 'info' as const, text: "2 agent updates aren't on main", acts: [{ act: 'docs-pr' as const, label: 'Ask Ada to open a docs PR' }] };
  const consent = { id: 'c1', kind: 'assumption' as const, level: 'warn' as const, text: '1 assumption made without your consent', acts: [{ act: 'agree' as const, label: 'Agree' }] };
  const items = collectNeeds({ ...input([esc('f', { fyi: true })]), questions: { floor: 'f1', waiting: 3, brds: 1, blocking: 0, batch: 1 }, asks: { floor: 'f1', items: [offmain, consent] } });
  assert.deepEqual(items.map((n) => n.kind).sort(), ['assumption', 'fyi', 'offmain', 'questions']);
  assert.equal(hereCount(items), 2, 'questions and the consent row count; FYI and not-on-main are info');
});
