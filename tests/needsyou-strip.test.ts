// The "Needs you" strip on the 1D view's Command Center (src/client/ui/needsyou/logic.ts): what's
// blocked on the Project Manager, most urgent first, each with where its button goes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { collectNeeds, hereCount, type NeedsInput } from '../src/client/ui/needsyou/logic.js';
import type { FloorInfo, GhPull, WorkerInfo } from '../src/shared/protocol.js';
import type { Escalation } from '../src/shared/roster/escalation.js';
import type { ApprovalItem, RosterView } from '../src/shared/roster/types.js';

const worker = (id: string, o: Partial<WorkerInfo> = {}): WorkerInfo => ({ id, kind: 'agent', deskId: `desk-${id}`, name: id, color: '#fff', status: 'working', acked: false, createdBy: 'test', createdAt: 0, cols: 80, rows: 24, viewers: [], ...o }) as WorkerInfo;
const esc = (id: string, o: Partial<Escalation> = {}): Escalation => ({ id, at: 0, workerId: 'w', by: 'Lead', urgency: 'important', fyi: false, level: 2, title: `esc ${id}`, details: '', options: [], status: 'open', ...o }) as Escalation;
const roster = (o: Partial<RosterView> = {}): RosterView => ({ floor: 'f1', approvals: [], escalations: [], admin: true, ...o }) as RosterView;
const pull = (number: number, o: Partial<GhPull> = {}): GhPull => ({ number, title: `pr ${number}`, state: 'OPEN', isDraft: false, checks: 'pass', updatedAt: '2026-10-01T00:00:00Z', ...o }) as GhPull;
const floorInfo = (id: string, o: Partial<FloorInfo> = {}): FloorInfo => ({ id, name: id, waiting: 0, ...o }) as FloorInfo;
const input = (o: Partial<NeedsInput> = {}): NeedsInput => ({ floor: 'f1', workers: [], pulls: [], floors: [], ...o });

test('nothing blocked: no items, and no count on the tab', () => {
  const items = collectNeeds(input({ workers: [worker('a'), worker('b', { status: 'done', acked: true })], roster: roster(), pulls: [pull(1)], floors: [floorInfo('f1', { waiting: 2 })] }));
  assert.deepEqual(items, []);
  assert.equal(hereCount(items), 0);
});

test('most urgent first: asking, lost, escalations, approvals, paused, failing PRs, other floors', () => {
  const items = collectNeeds(
    input({
      workers: [worker('asker', { status: 'needs_input', activity: 'Wants permission: Bash', waitingSince: 5 }), worker('gone', { lost: { branch: {} as never } })],
      roster: roster({
        escalations: [esc('e1')],
        approvals: [{ id: 'p-1', kind: 'proposal', title: 'Add login', detail: '' } as ApprovalItem, { id: 'cap', kind: 'cap', title: 'Daily cost cap reached', detail: '' } as ApprovalItem],
        paused: 'Daily cap of $5 reached',
      }),
      pulls: [pull(7, { checks: 'fail' })],
      floors: [floorInfo('f1'), floorInfo('f2', { name: 'Other', waiting: 2 })],
    }),
  );
  assert.deepEqual(
    items.map((n) => n.kind),
    ['asking', 'lost', 'escalation', 'approval', 'paused', 'pr', 'floor'],
  );
  assert.equal(items[0].text, 'asker is asking: Wants permission: Bash');
  assert.equal(items[0].since, 5);
  assert.deepEqual(items[0].target, { to: 'worker', id: 'asker' });
  assert.deepEqual(items[1].target, { to: 'worker', id: 'gone' });
  // The cap approval is the paused line, not a second row.
  assert.equal(items.filter((n) => n.kind === 'approval').length, 1);
  assert.deepEqual(items[4].target, { to: 'settings' });
  assert.equal(items[6].text, '2 waiting on Other');
  assert.deepEqual(items[6].target, { to: 'floor', floor: 'f2' });
  // Other floors aren't counted on this floor's tab.
  assert.equal(hereCount(items), 6);
});

test('FYI and answered escalations are left out; the loudest and then the oldest come first', () => {
  const items = collectNeeds(
    input({
      roster: roster({
        escalations: [esc('fyi', { fyi: true, urgency: 'critical' }), esc('done', { status: 'resolved' }), esc('old', { at: 1 }), esc('crit', { urgency: 'critical', at: 9 }), esc('urg', { urgency: 'urgent', at: 3 })],
        // The office lists open escalations among the approvals too: they show once, as escalations.
        approvals: [{ id: 'e-old', kind: 'escalation', title: 'esc old', detail: '', escalationId: 'old' } as ApprovalItem],
      }),
    }),
  );
  assert.deepEqual(items.map((n) => n.key), ['esc-crit', 'esc-urg', 'esc-old']);
  assert.deepEqual(items.map((n) => n.level), ['block', 'block', 'warn']);
  assert.equal(items[0].tag, 'CRITICAL');
  assert.deepEqual(items[0].target, { to: 'escalation', id: 'crit' });
});

test("someone who isn't the Project Manager sees the same items, but the buttons just go and look", () => {
  const r = roster({ admin: false, escalations: [esc('e1')], approvals: [{ id: 'm-3', kind: 'merge', title: 'Merge PR #3: x', detail: '' } as ApprovalItem] });
  const items = collectNeeds(input({ roster: r }));
  assert.deepEqual(items.map((n) => n.action), ['View', 'View']);
  assert.deepEqual(collectNeeds(input({ roster: { ...r, admin: true } })).map((n) => n.action), ['Answer', 'Review']);
});

test('only open, ready PRs with failing checks', () => {
  const items = collectNeeds(input({ pulls: [pull(1, { checks: 'fail' }), pull(2, { checks: 'fail', isDraft: true }), pull(3, { checks: 'fail', state: 'MERGED' }), pull(4, { checks: 'pending' })] }));
  assert.deepEqual(items.map((n) => n.key), ['pr-1']);
  assert.equal(items[0].action, 'Open PR #1');
  assert.deepEqual(items[0].target, { to: 'pr', number: 1 });
});

test('other floors: only the ones with someone waiting, not being cloned, not this one', () => {
  const items = collectNeeds(input({ floors: [floorInfo('f1', { waiting: 3 }), floorInfo('f2', { waiting: 1 }), floorInfo('f3', { waiting: 2, cloning: true }), floorInfo('f4')] }));
  assert.deepEqual(items.map((n) => n.key), ['floor-f2']);
});

test("a team fetched for another floor, a shell, and a finished worker don't count", () => {
  const items = collectNeeds(input({ workers: [worker('sh', { kind: 'shell', status: 'needs_input' }), worker('d', { status: 'done', acked: true })], roster: roster({ floor: 'f9', paused: 'cap' }) }));
  assert.deepEqual(items, []);
});

test('a ✋ stage of a toolkit project being set up, and a live app that failed', () => {
  const setup = { show: true, stages: [{ id: '1', title: 'Kickoff', status: 'PASS' }, { id: '2', title: 'Discovery', status: 'MANUAL' }], questions: [], checking: false };
  const live = { floor: 'f1', status: 'failed' as const, message: 'Build failed', since: 4, log: [], available: true };
  const items = collectNeeds(input({ setup, live }));
  assert.deepEqual(items.map((n) => n.kind), ['setup', 'live']);
  assert.equal(items[0].text, 'Stage 2 (Discovery) waits for your sign-off');
  assert.equal(items[1].text, 'The live app failed: Build failed');
  // Once Stage 4 is signed off the panel is gone, and so is the item; a running app is fine.
  assert.deepEqual(collectNeeds(input({ setup: { ...setup, show: false }, live: { ...live, status: 'running' } })), []);
});

test('an agent that finished a turn nobody looked at is listed, to review, after the ones asking', () => {
  const items = collectNeeds(input({ workers: [worker('d', { status: 'done', task: { summary: 'PR #7 opened' } } as Partial<WorkerInfo>), worker('q', { status: 'needs_input', activity: 'May I?' })] }));
  assert.deepEqual(items.map((n) => n.key), ['ask-q', 'done-d']);
  assert.equal(items[1].kind, 'finished');
  assert.equal(items[1].action, 'Review');
  assert.match(items[1].text, /PR #7 opened/);
  assert.equal(hereCount(items), 2);
});
