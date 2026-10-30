// Release 82, team flow #4: the roster's working/idle follows real activity (server/workers/pulse.ts): a member
// whose status says idle while its terminal prints, its hooks fire or it commits reads as active, promptly,
// and quiet again once that stops. Fakes only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ACTIVE_MS, COMMIT_ACTIVE_MS, COMMIT_COMMAND, activeVia, forgetPulse, isActive, notePulse, onPulseFlip, pulseOf, setPulseClock } from '../src/server/workers/pulse.js';
import { ACTIVE_WORD, activeByPulse, activeLine } from '../src/shared/roster/activity.js';
import { teamRows } from '../src/client/ui/portal/overview-logic.js';

test('a pulse makes a worker active for a while; a commit counts for longer; flips are told once', () => {
  let now = 1_000_000;
  setPulseClock(() => now);
  const flips: string[] = [];
  const off = onPulseFlip((id, active) => flips.push(`${id}:${active}`));
  try {
    assert.equal(isActive('w1'), false);
    // A TUI at rest redrawing a little isn't work: too few chunks, too few bytes.
    notePulse('w0', 'output', now, 40);
    notePulse('w0', 'output', now, 40);
    notePulse('w0', 'output', now, 40);
    assert.equal(isActive('w0'), false);
    notePulse('w1', 'output');
    notePulse('w1', 'output');
    assert.equal(isActive('w1'), false, 'two chunks are not enough yet');
    notePulse('w1', 'output');
    assert.equal(pulseOf('w1')?.via, 'output');
    notePulse('w1', 'tool');
    assert.deepEqual(flips, ['w1:true'], 'only the flip from quiet is told, not every chunk');
    assert.equal(pulseOf('w1')?.via, 'tool');
    now += ACTIVE_MS + 1;
    assert.equal(isActive('w1'), false);
    notePulse('w2', 'commit');
    now += ACTIVE_MS + 1;
    assert.equal(pulseOf('w2')?.via, 'commit', 'a commit keeps it active past the output window');
    now += COMMIT_ACTIVE_MS;
    assert.equal(isActive('w2'), false);
    forgetPulse('w1');
    assert.equal(pulseOf('w1'), undefined);
  } finally {
    off();
    setPulseClock(undefined);
  }
});

test('activeVia picks the strongest evidence; git commit commands are recognised', () => {
  assert.deepEqual(activeVia({ output: 100, tool: 90, commit: 50 }, 120), { via: 'commit', at: 50 });
  assert.equal(activeVia({ output: 100 }, 100 + ACTIVE_MS), undefined);
  assert.ok(COMMIT_COMMAND.test('git commit -m "Row 12: form page"'));
  assert.ok(COMMIT_COMMAND.test('cd app && git -C ../x commit -am wip'));
  assert.ok(!COMMIT_COMMAND.test('git status'));
  assert.ok(!COMMIT_COMMAND.test('echo gitcommit'));
});

test('the Team card shows an idle member seen at work as active, never "Ready"', () => {
  const now = Date.now();
  const members = [
    { role: 'pm', name: 'Avery', title: 'Project Coordinator', status: 'idle', workerId: 'a' },
    { role: 'lead-developer', name: 'Blake', title: 'Lead Developer', status: 'idle', workerId: 'b', recent: { via: 'commit' as const, at: now - 30_000 } },
    { role: 'lead-tester', name: 'Casey', title: 'Lead Tester', status: 'benched', recent: { via: 'output' as const, at: now } },
  ];
  const rows = teamRows(members, 'pm', (id) => ({ status: 'idle', activity: id === 'a' ? 'last prompt' : undefined }));
  const dev = rows.find((r) => r.role === 'lead-developer')!;
  assert.equal(dev.dot, 'work');
  assert.equal(dev.status, ACTIVE_WORD.commit);
  assert.match(dev.what, /Committed 30 s ago/);
  assert.equal(rows.find((r) => r.role === 'pm')!.status, 'Ready');
  assert.equal(rows.find((r) => r.role === 'lead-tester')!.status, 'Benched', 'a benched member stays benched');
  assert.equal(activeByPulse({ status: 'working', recent: { via: 'tool', at: now } }), false);
  assert.equal(activeByPulse({ status: 'asleep', recent: { via: 'tool', at: now } }), true);
  assert.match(activeLine({ via: 'output', at: now - 120_000 }, now), /2 min ago/);
});
