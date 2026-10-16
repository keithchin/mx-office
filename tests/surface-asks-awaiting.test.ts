// Nothing waits on the PM unseen, S4: AWAITING-PM lines become escalations per item, wherever the newest
// entry is (the floor's folder, an agent's worktree), on bench, on pause and in the regular look, deduped by
// role and text, not held back by other open escalations. A line that goes from the newest entry no longer
// settles its escalation (decision cards, D02): it's marked "line gone" for the person to say.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { awaitingItems, awaitingKey, entryTime, newestWaits, planAwaiting, waitingEntry } from '../src/server/asks/awaiting.js';
import { AsksService, type AsksDeps, type AsksFloor } from '../src/server/asks/service.js';
import { parseJournal } from '../src/shared/roster/journal.js';
import type { Escalation, EscalationAsk } from '../src/shared/roster/escalation.js';
import type { Read } from '../src/server/asks/sources.js';

const esc = (id: string, o: Partial<Escalation> = {}): Escalation => ({ id, at: 0, workerId: 'w', by: 'Dev', role: 'lead-developer', urgency: 'important', fyi: false, level: 2, title: `esc ${id}`, details: '', options: [], status: 'open', ...o }) as Escalation;
const journal = (...entries: string[]) => `# Development team journal\n\n${entries.join('\n\n')}\n`;
const HANDOFF = '## 2026-10-12 22:52 — Handoff\n**Next** carry on.\n\nAWAITING-PM: OK to install sqlite3 on this machine; merge PR #51 (1) the NFR answer';
const read = (kind: 'checkout' | 'worktree', who: string, text: string): Read => ({ place: { kind, who, dir: '/x' }, files: new Map([['docs/team/development.md', text]]), outcome: new Map([['docs/team/development.md', 'ok']]) });

test('an AWAITING-PM line is split into its items; none and N/A are nothing', () => {
  assert.deepEqual(awaitingItems('x\nAWAITING-PM: OK to install sqlite3; merge PR #51\n- **AWAITING-PM:** Which matrix?'), ['OK to install sqlite3', 'merge PR #51', 'Which matrix?']);
  assert.deepEqual(awaitingItems('AWAITING-PM: (1) the NFR answer (2) a named SMTP owner'), ['the NFR answer', 'a named SMTP owner']);
  assert.deepEqual(awaitingItems('AWAITING-PM: none'), []);
  assert.deepEqual(awaitingItems('AWAITING-PM: N/A.'), []);
});

test('the waiting entry is the newest handoff or AWAITING-PM entry: a later note does not clear it', () => {
  const e = waitingEntry(parseJournal(journal(HANDOFF, '## 2026-10-13 — N1 fix refreshed\n- Gates green.')));
  assert.equal(e?.heading, '2026-10-12 22:52 — Handoff');
  assert.equal(waitingEntry(parseJournal(journal(HANDOFF, '## 2026-10-13 09:00 — Handoff\nAWAITING-PM: none')))?.heading, '2026-10-13 09:00 — Handoff');
});

test("the newest copy wins: an agent's worktree ahead of the folder", () => {
  const old = read('checkout', 'the project folder', journal('## 2026-10-10 10:00 — Handoff\nAWAITING-PM: the old ask'));
  const fresh = read('worktree', 'Dylan', journal(HANDOFF));
  const [w] = newestWaits([old, fresh]);
  assert.equal(w.team, 'development');
  assert.equal(w.where, "Dylan's worktree");
  assert.deepEqual(w.items, ['OK to install sqlite3 on this machine', 'merge PR #51', 'the NFR answer']);
});

test('several items are several escalations; another open one does not hold them back; dedupe; gone is marked, never settled', () => {
  const waits = newestWaits([read('worktree', 'Dylan', journal(HANDOFF))]);
  const roleOf = () => 'lead-developer' as const;
  const unrelated = esc('u', { title: 'Who owns the HR integration?' });
  let plan = planAwaiting(waits, roleOf, [unrelated]);
  assert.deepEqual(plan.raise.map((r) => r.item), ['OK to install sqlite3 on this machine', 'merge PR #51', 'the NFR answer']);
  // Already filed (open, by key) or escalated by the agent in the same words: not again.
  const filed = esc('a', { from: { kind: 'awaiting', key: awaitingKey('lead-developer', 'merge PR #51') }, at: Date.UTC(2026, 9, 13) });
  const own = esc('b', { title: 'The NFR answer' });
  plan = planAwaiting(waits, roleOf, [unrelated, filed, own]);
  assert.deepEqual(plan.raise.map((r) => r.item), ['OK to install sqlite3 on this machine']);
  // Answered after the entry was written: not filed again from the same entry.
  plan = planAwaiting(waits, roleOf, [{ ...filed, status: 'resolved' }]);
  assert.ok(!plan.raise.some((r) => r.item === 'merge PR #51'));
  // The line is gone from the newest entry: the one the office filed is marked gone (was: settled), the agent's own is left alone.
  const later = newestWaits([read('worktree', 'Dylan', journal(HANDOFF, '## 2026-10-13 18:00 — Handoff\nAWAITING-PM: none'))]);
  plan = planAwaiting(later, roleOf, [unrelated, filed, own]);
  assert.deepEqual(plan.gone.map((e) => e.id), ['a']);
  assert.equal(plan.raise.length, 0);
  // Marked once; and a failed read of the journal can't say it's gone.
  assert.deepEqual(planAwaiting(later, roleOf, [{ ...filed, sourceGone: { at: 1, what: 'gone' } }]).gone, []);
  const failed: Read = { place: { kind: 'worktree', who: 'Bo', dir: '/y' }, files: new Map(), outcome: new Map([['docs/team/development.md', 'failed']]) };
  assert.deepEqual(planAwaiting(later, roleOf, [filed], [failed]).gone, []);
  // The line back: an ask like before.
  assert.deepEqual(planAwaiting(waits, roleOf, [{ ...filed, sourceGone: { at: 1, what: 'gone' } }]).back.map((e) => e.id), ['a']);
});

function service(dir: string, wt: string) {
  const raised: { role: string; ask: EscalationAsk; key: string }[] = [];
  const gone: string[] = [];
  const continued: { id: string; title: string; key: string }[] = [];
  const escs: Escalation[] = [];
  const floor: AsksFloor = { id: 'f1', name: 'travel-approval', dir, people: () => [{ name: 'Dylan', role: 'lead-developer', dir: wt, branch: 'office/nibble-c955' }] };
  const deps: AsksDeps = {
    dataDir: mkdtempSync(path.join(os.tmpdir(), 'asks-data-')),
    floors: () => [floor],
    now: () => Date.UTC(2026, 9, 13, 12),
    writerOf: (_f, team) => (team === 'development' ? { role: 'lead-developer', name: 'Dylan' } : undefined),
    escalations: () => escs,
    raise(_f, role, ask, key) {
      raised.push({ role, ask, key });
      escs.push(esc(`e${escs.length}`, { title: ask.title, from: { kind: 'awaiting', key }, at: Date.UTC(2026, 9, 13, 12) }));
    },
    continueAsk(_f, id, ask, key) {
      continued.push({ id, title: ask.title, key });
      const e = escs.find((x) => x.id === id)!;
      Object.assign(e, { title: ask.title, from: { kind: 'awaiting', key } });
      delete e.sourceGone;
    },
    markGone(_f, id, what) {
      const e = escs.find((x) => x.id === id);
      if (!e) return;
      if (what) {
        gone.push(id);
        e.sourceGone = { at: 1, what };
      } else delete e.sourceGone;
    },
    detectInput: async () => ({}),
    lead: () => ({ name: 'Ada' }),
    tell: () => undefined,
    record: () => {},
  };
  return { s: new AsksService(deps), floor, raised, gone, escs, continued };
}

test('the regular look and the pause path: a handoff in a worktree is filed per item, once, and marked "line gone" (still open) when the line goes', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'asks-floor-'));
  const wt = mkdtempSync(path.join(os.tmpdir(), 'asks-wt-'));
  mkdirSync(path.join(wt, 'docs/team'), { recursive: true });
  // What ⏸ Pause project asks for: a handoff entry ending AWAITING-PM, in the agent's own worktree.
  writeFileSync(path.join(wt, 'docs/team/development.md'), journal('## 2026-10-13 11:40 — Handoff\nPaused mid-task.\n\nAWAITING-PM: merge PR #51; paste the SMTP password into the test mailbox settings'));
  const t = service(dir, wt);
  await t.s.look(t.floor, 'as the project was paused');
  assert.deepEqual(t.raised.map((r) => [r.ask.title, r.ask.trigger]), [['merge PR #51', 'needs-human'], ['paste the SMTP password into the test mailbox settings', 'needs-human']]);
  assert.match(t.raised[0].ask.details, /Dylan's worktree/);
  assert.match(t.raised[0].ask.details, /as the project was paused/);
  // The next look: nothing new.
  await t.s.look(t.floor, 'in its regular look');
  assert.equal(t.raised.length, 2);
  // The agent writes a newer handoff without the merge: that one is marked gone and stays open for the person (was: closed by itself).
  writeFileSync(path.join(wt, 'docs/team/development.md'), journal('## 2026-10-13 11:40 — Handoff\nAWAITING-PM: merge PR #51; paste the SMTP password into the test mailbox settings', '## 2026-10-13 15:00 — Handoff\nAWAITING-PM: paste the SMTP password into the test mailbox settings'));
  await t.s.look(t.floor, 'in its regular look');
  assert.deepEqual(t.gone, ['e0']);
  assert.equal(t.escs[0].status, 'open');
  assert.match(t.escs[0].sourceGone!.what, /The AWAITING-PM line is gone from Dev's newest entry/);
  assert.equal(t.raised.length, 2);
});

test('continuity in the look: the role rewords an item in a newer entry and the same escalation is updated, not a second one filed', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'asks-floor-'));
  const wt = mkdtempSync(path.join(os.tmpdir(), 'asks-wt-'));
  mkdirSync(path.join(wt, 'docs/team'), { recursive: true });
  const file = path.join(wt, 'docs/team/development.md');
  const first = '## 2026-10-13 11:40 — Handoff\nAWAITING-PM: GenAI key; merge PR #51';
  writeFileSync(file, journal(first));
  const t = service(dir, wt);
  await t.s.look(t.floor, 'in its regular look');
  assert.deepEqual(t.raised.map((r) => r.ask.title), ['GenAI key', 'merge PR #51']);
  writeFileSync(file, journal(first, '## 2026-10-13 15:00 — Handoff\nAWAITING-PM: GenAI Text Generation resource + key (pasted in when Dylan says ready); merge PR #51'));
  await t.s.look(t.floor, 'in its regular look');
  assert.equal(t.raised.length, 2);
  assert.deepEqual(t.continued.map((c) => [c.id, c.title]), [['e0', 'GenAI Text Generation resource + key (pasted in when Dylan says ready)']]);
  assert.deepEqual(t.gone, []);
  assert.equal(t.escs.filter((e) => e.status === 'open').length, 2);
});

test('an item answered after its entry is not filed again: the heading is local time, as agents write it', () => {
  // Katherine's "2026-10-16 12:48 — Handoff" (local), answered at 12:50 local; the look runs again at 12:51.
  const entry = { heading: '2026-10-16 12:48 — Handoff', date: '2026-10-16', body: 'AWAITING-PM: CAC-3 sign-off of BRD F001' };
  const at = new Date(2026, 9, 16, 12, 48).getTime();
  const waits = [{ team: 'analysis' as const, entry, at: entryTime(entry), items: ['CAC-3 sign-off of BRD F001'], where: 'its journal' }];
  assert.equal(waits[0].at, at, 'the heading is read in local time');
  const key = awaitingKey('chief-analyst', 'CAC-3 sign-off of BRD F001');
  const answered = esc('a1', { role: 'chief-analyst', status: 'resolved', from: { kind: 'awaiting', key }, at: new Date(2026, 9, 16, 12, 48, 55).getTime() });
  const plan = planAwaiting(waits, () => 'chief-analyst', [answered]);
  assert.equal(plan.raise.length, 0, 'answered once is enough');
  // A newer entry that still waits on it is a new ask.
  const later = { ...entry, heading: '2026-10-16 14:05 — Handoff' };
  assert.equal(planAwaiting([{ ...waits[0], entry: later, at: entryTime(later) }], () => 'chief-analyst', [answered]).raise.length, 1);
});
