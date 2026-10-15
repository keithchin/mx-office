// Duplicate asks in Needs you (after release 48): the Coordinator rewrote its AWAITING-PM list in every
// entry and each rewording filed a new escalation, the item splitter cut lines into fragments, and the same
// human-action proposal was harvested twice with no time. Now: continuity (same role, same AWAITING-PM
// source, the same item by the rule in shared/decisions/same-item.ts) updates the escalation it has; the
// splitter splits on list separators only; pending proposals are deduped and carry their time; existing
// duplicates are offered on one clean-up card and closed only when the person confirms, each audited as
// superseded by the one kept. Absence alone still never resolves (D02). Fixtures paraphrase the
// travel-approval case.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { WorkerInfo } from '../src/shared/protocol.js';
import type { AuditInput } from '../src/shared/audit.js';
import type { Escalation } from '../src/shared/roster/escalation.js';
import type { Proposal, RosterView } from '../src/shared/roster/types.js';
import { awaitingItems, awaitingKey, planAwaiting, type Waits } from '../src/server/asks/awaiting.js';
import { splitAwaitingLine } from '../src/server/asks/split.js';
import { sameItem } from '../src/shared/decisions/same-item.js';
import { apartOf, duplicateGroups, duplicatesWords, escalationsApart } from '../src/shared/decisions/duplicates.js';
import { collectDecisions } from '../src/shared/needsyou.js';
import { proposalAt, toProposals } from '../src/server/roster/standup.js';
import { Roster } from '../src/server/roster/index.js';
import type { TeamFloor } from '../src/server/roster/types.js';
import { useAudit } from '../src/server/audit/index.js';
import { closeDuplicates, readCloseRequest } from '../src/server/decisions/duplicates.js';
import { decisionRoutes } from '../src/server/http/routes/decisions.js';
import { reviveRoster } from '../src/server/roster/store.js';

const events: AuditInput[] = [];
useAudit({ append: (e: AuditInput) => (events.push(e), { ...e, id: String(events.length), at: Date.now(), prev: '', hash: '' }) } as never);

const T = (h: number, m = 0) => Date.UTC(2026, 9, 14, h, m);
const esc = (id: string, title: string, o: Partial<Escalation> = {}): Escalation => ({ id, at: T(8), workerId: 'w', by: 'Ada', role: 'pm', urgency: 'important', fyi: false, level: 2, title, details: '', options: [], status: 'open', refs: {}, from: { kind: 'awaiting', key: awaitingKey(o.role ?? 'pm', title) }, ...o }) as Escalation;
const waits = (items: string[], at = T(12), team: Waits['team'] = 'management'): Waits => ({ team, entry: { heading: '2026-10-14 12:00 — Handoff', body: '', date: '2026-10-14' } as never, at, items, where: "Ada's worktree" });
const pmOf = () => 'pm' as const;

// ---- The splitter -----------------------------------------------------------------------------------------

test('asks-dedupe-split: only list separators split; brackets keep their commas and semicolons; no fragments', () => {
  // A clause that only points back stays with its item ("Ada has it" was an escalation of its own).
  assert.deepEqual(splitAwaitingLine('a formal approval for #95 needs a second account (or the rule that a comment review counts); Ada has it.'), ['a formal approval for #95 needs a second account (or the rule that a comment review counts); Ada has it']);
  // "all items are in open escalations (a; b; c)": the items inside, the last without its ")".
  assert.deepEqual(splitAwaitingLine('all items are in open escalations (merge #98; GenAI key; preview restart + Withdraw rebuild; shared GitHub account).'), ['merge #98', 'GenAI key', 'preview restart + Withdraw rebuild', 'shared GitHub account']);
  // Commas inside brackets don't split; a closing note in brackets is commentary.
  assert.deepEqual(splitAwaitingLine('GenAI text resource + key (pasted into the app when Dylan says ready); mxcli auth login (Marketplace PAT); file the mxcli defect (token can\'t, a7ca4009c8); #34/#64/#91. (#98 is escalation 36a0d06f1e, separate.)'), ['GenAI text resource + key (pasted into the app when Dylan says ready)', 'mxcli auth login (Marketplace PAT)', "file the mxcli defect (token can't, a7ca4009c8)", '#34/#64/#91']);
  assert.deepEqual(splitAwaitingLine("answers to the CAC-3 NFR question (OI-2: volumes, retention, accessibility); POC numbers stay ASSUMED until then."), ['answers to the CAC-3 NFR question (OI-2: volumes, retention, accessibility); POC numbers stay ASSUMED until then']);
  // Numbered and " · " lists, and none.
  assert.deepEqual(splitAwaitingLine('(1) the NFR answer (2) a named SMTP owner'), ['the NFR answer', 'a named SMTP owner']);
  assert.deepEqual(splitAwaitingLine('restart the preview · sqlite3 yes/no'), ['restart the preview', 'sqlite3 yes/no']);
  assert.deepEqual(splitAwaitingLine('none for now'), []);
  // A bulleted list under an empty AWAITING-PM line.
  assert.deepEqual(awaitingItems('AWAITING-PM:\n- merge #51\n- OK to install sqlite3\n\nNext: more'), ['merge #51', 'OK to install sqlite3']);
});

test('asks-dedupe-split-ids: "merge #98 and run the LF conversion (issue #91)" is two asks; the trailing commentary goes', () => {
  assert.deepEqual(splitAwaitingLine('merge #98 and run/approve the LF conversion of the two toolkit TSVs (issue #91), both already in open escalations.'), ['merge #98', 'run/approve the LF conversion of the two toolkit TSVs (issue #91)']);
  assert.deepEqual(splitAwaitingLine('merge #98 and run/approve the LF conversion of the two toolkit TSVs (issue #91), in escalation ad42308139'), ['merge #98', 'run/approve the LF conversion of the two toolkit TSVs (issue #91)']);
  // Without two different ids, "and" doesn't split.
  assert.deepEqual(splitAwaitingLine('OK to install sqlite3 (three instruments need it) and to file the mxcli defect publicly (draft in docs/upstream/)'), ['OK to install sqlite3 (three instruments need it) and to file the mxcli defect publicly (draft in docs/upstream/)']);
});

test('asks-dedupe-fragments: no item is a fragment: unbalanced brackets, too short, or bare punctuation', () => {
  const lines = ['shared GitHub account); merge #98', '(merge #98; GenAI key', 'ok; --; x; restart the preview', 'merge #98 (and the LF one; GenAI key'];
  for (const l of lines) {
    for (const it of splitAwaitingLine(l)) {
      assert.ok(it.length > 2, `${l} → ${it}`);
      assert.ok(!/^[)\]]|[([]$/.test(it), `${l} → ${it}`);
      const open = (it.match(/[([]/g) ?? []).length;
      const close = (it.match(/[)\]]/g) ?? []).length;
      assert.equal(open, close, `${l} → ${it}`);
    }
  }
});

// ---- The matching rule ------------------------------------------------------------------------------------

test('asks-dedupe-rule: the same item by shared ids or by words; different ids or one side of a combined ask are not', () => {
  assert.ok(sameItem('GenAI key', 'GenAI Text Generation resource + key'));
  assert.ok(sameItem('GenAI Text Generation resource + key (pasted into the app when Dylan says ready)', 'GenAI Text Generation resource + key'));
  assert.ok(sameItem('row-62 proofs', 'OK for the row-62 failure proofs'));
  assert.ok(sameItem('#91 LF', '#91 toolkit LF'));
  assert.ok(sameItem('file the mxcli defect (gh token can\'t, a7ca4009c8)', 'file the mxcli defect (a7ca4009c8)'));
  assert.ok(!sameItem('merge #98', 'merge #98 and run the LF conversion (issue #91)'));
  assert.ok(!sameItem('merge #98', 'merge #99'));
  assert.ok(!sameItem('preview restart', 'preview restart + Withdraw rebuild'));
  assert.ok(!sameItem('sqlite3', 'OK to install sqlite3 on this machine'));
  assert.ok(!sameItem('restart the 8087 preview', 'restart the 8088 preview'));
});

// ---- Continuity -------------------------------------------------------------------------------------------

test('asks-dedupe-continuity: a reworded item updates the escalation it has (gone or not), never files a second one', () => {
  const genai = esc('g1', 'GenAI key', { sourceGone: { at: 1, what: 'gone' } });
  const plan = planAwaiting([waits(['GenAI Text Generation resource + key', 'OK for the row-62 failure proofs'])], pmOf, [genai, esc('r1', 'row-62 proofs')]);
  assert.deepEqual(plan.raise, []);
  assert.deepEqual(plan.update.map((u) => [u.escalation.id, u.item]), [['g1', 'GenAI Text Generation resource + key'], ['r1', 'OK for the row-62 failure proofs']]);
  // A continued one is neither gone nor back: its line is the new one.
  assert.deepEqual(plan.gone, []);
  assert.deepEqual(plan.back, []);
  // Two items in one entry never continue the same escalation.
  const two = planAwaiting([waits(['GenAI key', 'GenAI resource key'])], pmOf, [esc('g2', 'GenAI Text Generation resource + key', { sourceGone: { at: 1, what: 'gone' } })]);
  assert.equal(two.update.length, 1);
  assert.equal(two.raise.length, 1);
});

test('asks-dedupe-roles: a different role with the same words is a separate escalation; a separated pair is never joined', () => {
  const tester = esc('t1', 'GenAI key', { role: 'lead-tester', by: 'Sophie', sourceGone: { at: 1, what: 'gone' } });
  const plan = planAwaiting([waits(['GenAI Text Generation resource + key'])], pmOf, [tester]);
  assert.deepEqual(plan.raise.map((r) => r.item), ['GenAI Text Generation resource + key']);
  assert.deepEqual(plan.update, []);
  // An escalation the agent raised itself (not from the AWAITING-PM line) is never continued either.
  const own = esc('o1', 'GenAI key', { from: undefined, sourceGone: undefined });
  assert.deepEqual(planAwaiting([waits(['GenAI Text Generation resource + key'])], pmOf, [own]).update, []);
  // Separate: the item matches both, and the person said they are different: nothing is continued.
  const a = esc('a', 'GenAI key', { sourceGone: { at: 1, what: 'gone' } });
  const b = esc('b', 'GenAI resource + key', { sourceGone: { at: 1, what: 'gone' } });
  const apart = escalationsApart([{ cardId: 'esc:a', sourceId: 'esc:b' }]);
  const sep = planAwaiting([waits(['GenAI Text Generation resource + key'])], pmOf, [a, b], [], apart);
  assert.deepEqual(sep.update, []);
  assert.equal(sep.raise.length, 1);
});

test('asks-dedupe-d02: a line that goes with nothing matching it is marked gone, never resolved (absence alone)', () => {
  const merge = esc('m1', 'merge #98');
  const plan = planAwaiting([waits(['GenAI Text Generation resource + key'])], pmOf, [merge]);
  assert.deepEqual(plan.gone.map((e) => e.id), ['m1']);
  assert.equal(merge.status, 'open');
  // Nothing in the plan resolves anything: only raise, update, gone, back.
  assert.deepEqual(Object.keys(plan).sort(), ['back', 'gone', 'raise', 'update']);
});

// ---- The clean-up card ------------------------------------------------------------------------------------

/** The Coordinator's escalations as the travel-approval case had them (paraphrased). */
const coordinator = (): Escalation[] => [
  esc('e1', 'GenAI key', { at: T(15, 35), sourceGone: { at: 1, what: 'gone' } }),
  esc('e2', 'row-62 proofs', { at: T(15, 35), sourceGone: { at: 1, what: 'gone' } }),
  esc('e3', '#91 LF', { at: T(15, 35), sourceGone: { at: 1, what: 'gone' } }),
  esc('e4', 'GenAI Text Generation resource + key (pasted into the app when Dylan says ready)', { at: T(20, 59), sourceGone: { at: 1, what: 'gone' } }),
  esc('e5', 'OK for the row-62 failure proofs', { at: T(20, 59) }),
  esc('e6', '#91 toolkit LF', { at: T(20, 59) }),
  esc('e7', 'GenAI Text Generation resource + key', { at: T(21, 1) }),
  esc('e8', 'merge #98', { at: T(20, 59), sourceGone: { at: 1, what: 'gone' } }),
  esc('e9', 'GenAI key', { role: 'lead-tester', by: 'Sophie', at: T(9), sourceGone: { at: 1, what: 'gone' } }),
];

test('asks-dedupe-groups: gone duplicates of the same role are offered under the newest live one; other roles and lone ones are not', () => {
  const groups = duplicateGroups(coordinator(), []);
  assert.deepEqual(groups.map((g) => [g.keep.id, g.close.map((c) => c.id).sort()]), [['e7', ['e1', 'e4']], ['e5', ['e2']], ['e6', ['e3']]]);
  assert.equal(duplicatesWords(groups).title, 'Likely duplicates: 4 asks repeat 3 others');
  assert.match(duplicatesWords(groups).lines[0], /^GenAI Text Generation resource \+ key ×3 → keep the newest/);
  // A Separate between two of them keeps that one out.
  const sep = duplicateGroups(coordinator(), [], [{ cardId: 'esc:e7', sourceId: 'esc:e1' }]);
  assert.deepEqual(sep[0].close.map((c) => c.id), ['e4']);
  assert.equal(apartOf([{ cardId: 'esc:e7', sourceId: 'esc:e1' }])('esc:e1', 'esc:e7'), true);
  // On the Needs-you card list: one clean-up card, beside the escalations themselves.
  const r = { floor: 'f1', admin: true, escalations: coordinator(), approvals: [], proposals: [] } as unknown as RosterView;
  const cards = collectDecisions({ floor: 'f1', workers: [], pulls: [], floors: [], roster: r }).cards;
  const dup = cards.find((c) => c.id === 'duplicates')!;
  assert.equal(dup.kind, 'decision');
  assert.equal(dup.duplicates!.length, 3);
  assert.equal(cards.filter((c) => c.escalation).length, 9);
});

// ---- Proposals --------------------------------------------------------------------------------------------

test('asks-dedupe-proposals: a pending proposal with the same kind and words is not harvested again; each new one has its time; legacy ones fall back to their standup', () => {
  const first = toProposals([{ kind: 'human-action', title: 'Merge PR #98', detail: 'verified' }, { kind: 'human-action', title: 'Merge PR #98.', detail: 'again' }], '2026-10-14', 'lead-tester', 'Sophie', 2, T(9, 17));
  assert.equal(first.length, 1);
  assert.equal(first[0].at, T(9, 17));
  const next = toProposals([{ kind: 'human-action', title: 'merge PR #98', detail: 'already escalated' }, { kind: 'human-action', title: 'Convert the two toolkit TSVs to LF (issue #91)', detail: '' }], '2026-10-15', 'lead-tester', 'Sophie', 2, T(10), first);
  assert.deepEqual(next.map((p) => p.title), ['Convert the two toolkit TSVs to LF (issue #91)']);
  // Decided ones don't hold a new one back.
  assert.equal(toProposals([{ kind: 'human-action', title: 'Merge PR #98', detail: '' }], 'x', 'lead-tester', 'Sophie', 2, 1, [{ ...first[0], status: 'approved' }]).length, 1);
  // Legacy (no at): the standup's start, else its date at midnight.
  assert.equal(proposalAt({ standup: '2026-10-14' }, { standups: [{ id: '2026-10-14', startedAt: T(9) }] }), T(9));
  assert.equal(proposalAt({ standup: '2026-10-15-2' }, { standups: [] }), Date.UTC(2026, 9, 15));
});

// ---- Closing, on the server ---------------------------------------------------------------------------------

class FakeFloor implements TeamFloor {
  id = `f${Math.random().toString(36).slice(2, 8)}`;
  name = 'test';
  dir = mkdtempSync(path.join(os.tmpdir(), 'dup-floor-'));
  map = new Map<string, WorkerInfo>();
  typed: { id: string; text: string }[] = [];
  workers = () => [...this.map.values()];
  worker = (id: string) => this.map.get(id);
  hire = async () => 'no';
  stop = async () => {};
  prompt = (id: string, text: string) => void this.typed.push({ id, text });
  wake = () => undefined;
  rename = () => {};
  cwdOf = () => this.dir;
  openPulls = () => [];
  toast = () => {};
  changed = () => {};
  activity = () => {};
  judged = () => {};
}

function setup() {
  const floor = new FakeFloor();
  const roster = new Roster({ dataDir: mkdtempSync(path.join(os.tmpdir(), 'dup-data-')), floors: () => [floor], makeIssue: async () => ({ number: 7 }), analysis: () => '', now: () => Date.now() }, 0);
  floor.map.set('w1', { id: 'w1', kind: 'agent', name: 'Ada', status: 'idle', viewers: [] } as unknown as WorkerInfo);
  const d = roster.data(floor.id);
  d.escalations.push(...coordinator().map((e) => ({ ...e, workerId: 'w1' })));
  const prop = (id: string, at?: number): Proposal => ({ id, standup: '2026-10-14', role: 'lead-tester', team: 'testing', by: 'Sophie', kind: 'human-action', title: 'Merge PR #98', detail: '', status: 'pending', ...(at ? { at } : {}) });
  d.proposals.push(prop('p1'), prop('p2', T(9)));
  return { floor, roster, d };
}

test('asks-dedupe-close: closed only what the person confirmed, each as superseded by the one kept, audited, nothing typed', async () => {
  const t = setup();
  // Nothing closes by itself: the groups are only offered.
  assert.equal(t.d.escalations.filter((e) => e.status === 'resolved').length, 0);
  // A stale confirmation (an id no longer offered) closes nothing.
  assert.deepEqual(await closeDuplicates(t.roster, t.floor, [{ keep: 'e7', close: ['e1', 'e5'] }], [], 'Keith'), { ok: false, error: 'These duplicates changed since you opened the card: look at it again', status: 409 });
  assert.equal(t.d.escalations.filter((e) => e.status === 'resolved').length, 0);
  const res = await closeDuplicates(t.roster, t.floor, [{ keep: 'e7', close: ['e1', 'e4'] }, { keep: 'p2', close: ['p1'] }], [], 'Keith');
  assert.deepEqual(res, { ok: true, closed: 3 });
  for (const id of ['e1', 'e4']) {
    const e = t.d.escalations.find((x) => x.id === id)!;
    assert.equal(e.status, 'resolved');
    assert.deepEqual({ v: e.resolution!.verdict, o: e.resolution!.outcome, s: e.resolution!.supersededBy }, { v: 'dismiss', o: 'superseded', s: 'e7' });
    const a = events.filter((x) => x.action === 'escalation.answer' && x.target?.id === id).at(-1)!;
    assert.equal(a.details?.verdict, 'superseded');
    assert.equal(a.details?.supersededBy, 'e7');
  }
  assert.equal(t.d.escalations.find((x) => x.id === 'e7')!.status, 'open');
  assert.equal(t.d.escalations.find((x) => x.id === 'e2')!.status, 'open');
  assert.deepEqual(t.floor.typed, []);
  const p1 = t.d.proposals.find((p) => p.id === 'p1')!;
  assert.deepEqual({ s: p1.status, by: p1.supersededBy }, { s: 'rejected', by: 'p2' });
  assert.equal(t.d.proposals.find((p) => p.id === 'p2')!.status, 'pending');
  assert.equal(events.filter((x) => x.action === 'decisions.close-duplicates').at(-1)!.summary, 'Closed 3 duplicates in Needs you, each superseded by the one kept (nothing sent to the agents)');
  assert.deepEqual(readCloseRequest([{ keep: 'e7', close: ['e1', '../x', 5] }, { keep: 'bad id!', close: ['e1'] }]), [{ keep: 'e7', close: ['e1'] }]);
});

test('asks-dedupe-perms: Close duplicates is refused on the server unless you are an admin', async () => {
  let status = 0;
  const res = { writeHead: (s: number) => (status = s), end: () => {} } as never;
  const ctx = { cfg: {}, meOf: () => ({ admin: false }), floors: new Map() } as never;
  await decisionRoutes.act.handle(ctx, { req: { headers: { 'content-type': 'application/json' } }, res, session: { account: { id: 'u1', name: 'Guest' } } } as never);
  assert.equal(status, 403);
});

test('asks-dedupe-legacy: a roster from release 48 (proposals without at, escalations without supersededBy) loads and groups', () => {
  const raw = { escalations: coordinator().map((e) => ({ ...e, refs: undefined })), proposals: [{ id: 'p1', standup: '2026-10-14', role: 'lead-tester', team: 'testing', by: 'Sophie', kind: 'human-action', title: 'Merge PR #98', detail: '', status: 'pending' }] };
  const d = reviveRoster(raw);
  assert.equal(d.proposals[0].at, undefined);
  assert.equal(duplicateGroups(d.escalations, d.proposals).length, 3);
});
