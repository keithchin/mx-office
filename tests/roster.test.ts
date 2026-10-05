// The project team's pure parts: role names, the autonomy rules, the standup schedule, the bench
// state machine, reading journals and turning proposals into issues.
import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanName, NAME_POOL, pickNames, ROLES } from '../src/shared/roster/roles.js';
import { AUTONOMY, autonomyBrief, capAt, needsCto, teamMayDecide, type DecisionKind } from '../src/shared/roster/autonomy.js';
import { cleanSchedule, DEFAULT_SCHEDULE, dayIn, isoWeek, lastSlot, nextSlot, standupDue } from '../src/shared/roster/schedule.js';
import { latestEntry, parseJournal, parseProposal, parseStandup, proposalIssue } from '../src/shared/roster/journal.js';
import { benchStep, dueForBench, HANDOFF_START_MS, mayBench } from '../src/server/roster/bench.js';
import { cleanSettings, freshRoster, reviveRoster } from '../src/server/roster/store.js';
import { compilePage, standupId, toProposals } from '../src/server/roster/standup.js';
import type { WorkerStatus } from '../src/shared/protocol.js';

/** A fixed sequence for "random" picks. */
const seq = (...xs: number[]) => {
  let i = 0;
  return () => xs[i++ % xs.length];
};

test('every role gets a different name from the pool, the same ones for the same rng', () => {
  const a = pickNames(seq(0.1, 0.5, 0.9, 0.3, 0.7));
  const b = pickNames(seq(0.1, 0.5, 0.9, 0.3, 0.7));
  assert.deepEqual(a, b);
  const names = ROLES.map((r) => a[r.id]);
  assert.equal(new Set(names).size, ROLES.length);
  for (const n of names) assert.ok(NAME_POOL.includes(n));
  // Names already taken aren't picked again.
  const c = pickNames(() => 0, ['Ada', 'Grace']);
  assert.ok(!Object.values(c).includes('Ada') && !Object.values(c).includes('Grace'));
});

test("a Project Manager's rename is cleaned to one short line, and empty doesn't count", () => {
  assert.equal(cleanName('  Rosalind \n'), 'Rosalind');
  assert.equal(cleanName('<b>Ada</b>'), 'bAda/b');
  assert.equal(cleanName('x'.repeat(40))?.length, 24);
  assert.equal(cleanName('   '), undefined);
  assert.equal(cleanName(42), undefined);
});

test('a saved roster is made whole: a missing role gets a name, a bad phase and bad settings get defaults', () => {
  const fresh = freshRoster(seq(0.2));
  assert.equal(fresh.settings.autonomy, 2);
  assert.equal(fresh.settings.idleMinutes, 30);
  assert.deepEqual(fresh.settings.schedule, DEFAULT_SCHEDULE);
  assert.ok(ROLES.every((r) => fresh.members[r.id].phase === 'none' && fresh.members[r.id].name));
  const revived = reviveRoster({ members: { pm: { name: 'Quinn', model: 'opus', phase: 'bogus' } }, settings: { autonomy: 7, idleMinutes: -5, costCaps: { 2: 12.5, 9: 3, 3: -1 } } }, seq(0.4));
  assert.equal(revived.members.pm.name, 'Quinn');
  assert.equal(revived.members.pm.phase, 'none');
  assert.ok(revived.members['lead-tester'].name);
  assert.equal(revived.settings.autonomy, 2);
  assert.equal(revived.settings.idleMinutes, 0);
  assert.deepEqual(revived.settings.costCaps, { 2: 12.5 });
  assert.deepEqual(cleanSettings({ autonomy: 4, schedule: { time: '25:00', timeZone: 'Nowhere/City', days: [1, 1, 9] } }).schedule, { enabled: true, time: '09:00', timeZone: 'Asia/Singapore', days: [1] });
});

test('what needs the Project Manager at each autonomy level', () => {
  const table: Record<DecisionKind, [boolean, boolean, boolean, boolean]> = {
    task: [true, false, false, false],
    scope: [true, true, false, false],
    design: [true, true, false, false],
    architecture: [true, true, false, false],
    'peer-review': [true, true, false, false],
    merge: [true, true, true, false],
    milestone: [true, true, true, false],
    'client-milestone': [true, true, true, true],
    budget: [true, true, true, true],
  };
  for (const [kind, row] of Object.entries(table) as [DecisionKind, boolean[]][]) {
    for (const level of [1, 2, 3, 4] as const) assert.equal(needsCto(level, kind), row[level - 1], `${kind} at level ${level}`);
  }
  assert.deepEqual(teamMayDecide(1), []);
  assert.match(autonomyBrief(2), /Autonomy level 2 \(Guided\)/);
  assert.match(autonomyBrief(2), /You may decide without asking: a task within the approved scope/);
  assert.match(autonomyBrief(1), /propose everything/);
  assert.equal(AUTONOMY[4].name, 'Autonomous');
  assert.equal(capAt({ 2: 10 }, 2), 10);
  assert.equal(capAt({ 2: 10 }, 3), undefined);
  assert.equal(capAt({ 2: 0 }, 2), undefined);
});

// 2026-10-05 is a Monday. 09:00 in Singapore (UTC+8) is 01:00 UTC.
const SGT_MON_0900 = Date.UTC(2026, 9, 5, 1, 0);
const H = 3_600_000;

test('the standup slot is weekdays 09:00 Asia/Singapore', () => {
  const s = DEFAULT_SCHEDULE;
  assert.equal(lastSlot(SGT_MON_0900 + 60_000, s), SGT_MON_0900);
  // Monday 08:59: the last slot was Friday 09:00.
  assert.equal(lastSlot(SGT_MON_0900 - 60_000, s), SGT_MON_0900 - 3 * 24 * H);
  assert.equal(nextSlot(SGT_MON_0900 - 60_000, s), SGT_MON_0900);
  // Friday after the standup: next is Monday.
  assert.equal(nextSlot(SGT_MON_0900 - 3 * 24 * H + H, s), SGT_MON_0900);
  assert.equal(dayIn(SGT_MON_0900, 'Asia/Singapore'), '2026-10-05');
  assert.equal(dayIn(SGT_MON_0900 - 10 * H, 'Asia/Singapore'), '2026-10-04');
  assert.equal(isoWeek(SGT_MON_0900, 'Asia/Singapore'), '2026-W41');
  assert.equal(nextSlot(SGT_MON_0900, { ...s, enabled: false }), undefined);
});

test('a scheduled standup runs once per slot, and only with activity since the last one', () => {
  const s = DEFAULT_SCHEDULE;
  const after = SGT_MON_0900 + 5 * 60_000;
  const lastFri = SGT_MON_0900 - 3 * 24 * H;
  // Busy since Friday's standup: run.
  assert.equal(standupDue(after, s, lastFri, lastFri + H), 'run');
  // Nothing happened since Friday's: skip (no tokens spent).
  assert.equal(standupDue(after, s, lastFri, lastFri - H), 'skip-no-activity');
  assert.equal(standupDue(after, s, undefined, undefined), 'skip-no-activity');
  // The first standup ever, with activity: run.
  assert.equal(standupDue(after, s, undefined, after - H), 'run');
  // Already ran this slot (by hand at 09:02, say): not again.
  assert.equal(standupDue(after, s, SGT_MON_0900 + 2 * 60_000, after), 'not-due');
  // Before the slot.
  assert.equal(standupDue(SGT_MON_0900 - 60_000, s, lastFri, SGT_MON_0900 - H), 'not-due');
  // Saturday: Friday's slot is more than 12 h old.
  assert.equal(standupDue(lastFri + 24 * H, s, lastFri - 24 * H, lastFri), 'not-due');
  assert.equal(standupDue(after, { ...s, enabled: false }, lastFri, after), 'off');
  // Another time zone and time.
  const ny = cleanSchedule({ time: '10:30', timeZone: 'America/New_York', days: [1] });
  const nyMon1030 = Date.UTC(2026, 9, 5, 14, 30); // EDT = UTC-4
  assert.equal(lastSlot(nyMon1030 + 1000, ny), nyMon1030);
});

const BUSY: WorkerStatus[] = ['starting', 'working', 'needs_input'];

test('an agent mid-task or waiting on a person is never idle, never due for the bench, never benched', () => {
  const now = 10 * H;
  for (const status of BUSY) {
    assert.equal(dueForBench({ status, viewers: 0 }, 0, now, 30), false, status);
    assert.notEqual(mayBench({ status, viewers: 0 }), true, status);
    // Benching it already: it waits, however long it takes.
    assert.equal(benchStep(status, true, 0, now), 'wait', status);
    assert.equal(benchStep(status, false, 0, now + 24 * H), 'wait', status);
  }
  assert.match(String(mayBench({ status: 'needs_input', viewers: 0 })), /waiting on a person/);
});

test('an idle agent is benched after the idle minutes, not with someone at its terminal, not when asleep or off', () => {
  const since = 0;
  assert.equal(dueForBench({ status: 'done', viewers: 0 }, since, 29 * 60_000, 30), false);
  assert.equal(dueForBench({ status: 'done', viewers: 0 }, since, 30 * 60_000, 30), true);
  assert.equal(dueForBench({ status: 'idle', viewers: 0 }, since, 31 * 60_000, 30), true);
  assert.equal(dueForBench({ status: 'done', viewers: 1 }, since, 60 * 60_000, 30), false);
  assert.equal(dueForBench({ status: 'exited', viewers: 0 }, since, 60 * 60_000, 30), false);
  assert.equal(dueForBench({ status: 'done', viewers: 0 }, since, 60 * 60_000, 0), false);
  assert.equal(dueForBench({ status: 'done', viewers: 0 }, undefined, 60 * 60_000, 30), false);
  assert.equal(mayBench({ status: 'done', viewers: 0 }), true);
  assert.equal(mayBench({ status: 'offline', viewers: 0 }), true);
});

test('benching finishes only once the handoff turn is over', () => {
  // Asked, still idle a moment later: it hasn't started yet.
  assert.equal(benchStep('done', false, 0, 1000), 'wait');
  // Worked on it and done: finish.
  assert.equal(benchStep('done', true, 0, 1000), 'finish');
  // Never got going: the office stops waiting after a while.
  assert.equal(benchStep('idle', false, 0, HANDOFF_START_MS), 'finish');
  // Stopped, or sent home meanwhile.
  assert.equal(benchStep('exited', false, 0, 1), 'finish');
  assert.equal(benchStep(undefined, false, 0, 1), 'finish');
});

const JOURNAL = `# Testing team journal

Intro text.

## 2026-10-02 10:00 — Kickoff
Found the qa-tests playbook.

## 2026-10-05 09:01 — Standup
### Done
- Wrote 3 unit tests for Order validation
- none
### Next
- E2E for checkout
### Blockers
- none
### Proposals
- [design] Bigger touch targets on the cart — fails WCAG on mobile
- Add a smoke test to CI: catches broken deploys
- [bogus] Something odd — kept in the title
`;

test('a journal is read as dated entries; the standup sections and proposals come out of one', () => {
  const entries = parseJournal(JOURNAL.replace(/\n/g, '\r\n'));
  assert.equal(entries.length, 2);
  assert.equal(entries[1].date, '2026-10-05');
  assert.equal(latestEntry(entries)?.heading, '2026-10-05 09:01 — Standup');
  assert.equal(latestEntry(entries, 'kickoff')?.date, '2026-10-02');
  assert.equal(latestEntry(entries, 'standup', '2026-10-04'), undefined);
  const r = parseStandup(entries[1].body);
  assert.deepEqual(r.done, ['Wrote 3 unit tests for Order validation']);
  assert.deepEqual(r.next, ['E2E for checkout']);
  assert.deepEqual(r.blockers, []);
  assert.deepEqual(r.proposals, [
    { kind: 'design', title: 'Bigger touch targets on the cart', detail: 'fails WCAG on mobile' },
    { kind: 'task', title: 'Add a smoke test to CI', detail: 'catches broken deploys' },
    { kind: 'task', title: '[bogus] Something odd', detail: 'kept in the title' },
  ]);
  assert.equal(parseProposal('   '), undefined);
});

test('proposals wait for the Project Manager or are the team\'s to decide, by level; an approved one maps to a labelled issue', () => {
  const parsed = parseStandup(parseJournal(JOURNAL)[1].body).proposals;
  const at2 = toProposals(parsed, '2026-10-05', 'lead-tester', 'Grace', 2);
  assert.deepEqual(at2.map((p) => p.status), ['pending', 'auto', 'auto']);
  assert.ok(at2.every((p) => p.team === 'testing' && p.by === 'Grace' && p.id));
  assert.deepEqual(toProposals(parsed, 'x', 'lead-tester', 'Grace', 1).map((p) => p.status), ['pending', 'pending', 'pending']);
  assert.deepEqual(toProposals(parsed, 'x', 'lead-tester', 'Grace', 3).map((p) => p.status), ['auto', 'auto', 'auto']);
  const issue = proposalIssue({ ...at2[0], standup: '2026-10-05' }, 'Keith', 2, 'Do mobile first');
  assert.equal(issue.title, 'Bigger touch targets on the cart');
  assert.deepEqual(issue.labels, ['team:testing']);
  assert.match(issue.body, /fails WCAG on mobile/);
  assert.match(issue.body, /Proposed by Grace \(testing team\) at the 2026-10-05 standup, as a design change/);
  assert.match(issue.body, /Approved by Keith in Agent Office at autonomy level 2/);
  assert.match(issue.body, /Project Manager's note: Do mobile first/);
});

test('the standup page lists every Lead, says where a report came from, and what needs the Project Manager', () => {
  const props = toProposals([{ kind: 'design', title: 'Dark mode', detail: '' }], '2026-10-05', 'lead-designer', 'Hedy', 2);
  const page = compilePage(
    {
      id: '2026-10-05', date: '2026-10-05', startedAt: 0, by: 'schedule', status: 'compiled', waiting: [], proposalIds: props.map((p) => p.id),
      reports: [
        { role: 'lead-designer', name: 'Hedy', source: 'live', done: ['Wireframes'], next: [], blockers: [] },
        { role: 'lead-tester', name: 'Grace', source: 'journal', heading: '2026-10-02 — Handoff', done: ['x'], next: [], blockers: ['CI down'] },
        { role: 'chief-analyst', name: 'Ken', source: 'none', done: [], next: [], blockers: [] },
      ],
    },
    props, 2, 'mx-spike',
  );
  assert.match(page, /^# Standup 2026-10-05 — mx-spike/);
  assert.match(page, /Lead Designer — Hedy\n/);
  assert.match(page, /Lead Tester — Grace _\(not at their desk: from the team journal\)_/);
  assert.match(page, /Chief Analyst — Ken _\(no report and no journal entry\)_/);
  assert.match(page, /- CI down/);
  assert.match(page, /\[design\] Dark mode · ⏳ awaiting the Project Manager/);
  assert.match(page, /## Needs the Project Manager\n\n- Hedy: Dark mode \(a design change\)/);
  assert.equal(standupId('2026-10-05', ['2026-10-05', '2026-10-05-2']), '2026-10-05-3');
});
