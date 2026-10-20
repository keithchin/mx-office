// Decision cards (shared/decisions/, Slice 1A): sources fold into one card only on an explicit id (a PR
// number, a register or BRD question id, a stage, a stuck item), never on similar words; each card's kind
// decides its buttons; an FYI that asks something is a decision; a release-45 record shows ungrouped.
// Fixtures shaped like the slice-0 baseline's PR #98 (7 objects) and OQ-07 (4 representations).
import test from 'node:test';
import assert from 'node:assert/strict';
import { collectDecisions, hereCount, type NeedsInput } from '../src/shared/needsyou.js';
import { makeEscalation, type Escalation } from '../src/shared/roster/escalation.js';
import type { ApprovalItem, RosterView } from '../src/shared/roster/types.js';
import type { StuckView } from '../src/shared/stuck.js';
import { stuckActions } from '../src/shared/stuck.js';
import { answersMessage, type QuestionBrief, type QuestionsNeed } from '../src/shared/questions.js';
import { explicitIds, refsFromTitle } from '../src/shared/decisions/ids.js';
import { afterWords, cardActs, cardCounts, countsWords, escalationKind } from '../src/shared/decisions/words.js';
import type { AutonomyLevel } from '../src/shared/roster/autonomy.js';

const NOW = Date.parse('2026-10-14T12:00:00Z');
const H = 3_600_000;

/** A release-46 escalation: refs worked out from its title, as makeEscalation does. */
const esc = (id: string, title: string, o: Partial<Escalation> = {}): Escalation => ({ id, at: NOW - 5 * H, workerId: 'w-ada', by: 'Ada', role: 'pm', urgency: 'important', fyi: false, level: 2, title, details: '', options: [], status: 'open', refs: refsFromTitle(title), ...o }) as Escalation;
const roster = (escalations: Escalation[], approvals: ApprovalItem[] = []): RosterView => ({ floor: 'f1', admin: true, escalations, approvals, members: [], settings: {} }) as unknown as RosterView;
const stuck = (id: string, o: Partial<StuckView>): StuckView => ({ id, kind: 'stale-pr', since: NOW - 30 * H, blocks: [], evidence: [], raisedAt: NOW - H, lead: 'Ada', ...o }) as StuckView;
const input = (o: Partial<NeedsInput>): NeedsInput => ({ floor: 'f1', workers: [], pulls: [], floors: [], now: NOW, ...o });

test('explicit ids: PR numbers, register and question ids, journeys; not UTF-8 or SHA-256; two of a kind name none', () => {
  assert.deepEqual(explicitIds('Merge PR #98 and fix OW-1 for J-08 (UTF-8, SHA-256, see https://x/y#12)'), { prs: [98], ids: ['OW-1'], journeys: ['J-08'] });
  assert.deepEqual(refsFromTitle('OK to merge #98 before the demo?'), { pr: 98 });
  assert.deepEqual(refsFromTitle('S4-3 and S4-4: which?'), {});
  assert.deepEqual(refsFromTitle('Who are the integration owners for SSO and SMTP?'), {});
});

test('decisions-group-explicit: stuck pr-51 and an escalation naming #51 are one card with two sources; similar wording without an id stays separate', () => {
  const r = roster([esc('e51', 'PR #51 needs your review'), esc('eow', 'Who are the integration owners for SSO, SMTP and the AI endpoint?')]);
  const st = { floor: 'f1', items: [stuck('pr-51', { pr: { number: 51, title: 'Fix Team_Claims' } }), stuck('decision-OW-1', { kind: 'decision', decision: { id: 'OW-1', question: 'Named owners for SSO and SMTP', rows: 'rows 59–62', journeys: ['J-09'] } })] };
  const { cards, needs } = collectDecisions(input({ roster: r, stuck: st }));
  const pr = cards.find((c) => c.sources.some((s) => s.id === 'stuck:pr-51'))!;
  assert.deepEqual(pr.sources.map((s) => s.id), ['esc:e51', 'stuck:pr-51']);
  assert.equal(pr.id, 'esc:e51');
  assert.equal(pr.need.sources, 2);
  const ow = cards.find((c) => c.sources.some((s) => s.id === 'stuck:decision-OW-1'))!;
  assert.equal(ow.sources.length, 1, 'similar words never merge');
  assert.equal(cards.length, 3);
  assert.equal(needs.length, 3);
});

test('decisions-pr-across-sources: #98 as 2 FYIs, 2 AWAITING-PM lines, a chat ask, a human-action proposal and a stuck item is one card with 7 sources', () => {
  const escs = [
    esc('f1', 'Merged #98 after the checks passed', { fyi: true }),
    esc('f2', 'PR #98: CI is green now', { fyi: true }),
    esc('a1', 'merge PR #98', { from: { kind: 'awaiting', key: 'pm:merge pr #98' }, trigger: 'needs-human' }),
    esc('a2', 'OK to merge #98 before the demo?', { by: 'Dylan', role: 'lead-developer', from: { kind: 'awaiting', key: 'lead-developer:ok to merge #98 before the demo?' } }),
    esc('c1', 'From the chat: can you merge #98 today?'),
  ];
  const proposal = { id: 'p-x', kind: 'proposal', title: 'Merge PR #98 (needs a person)', detail: 'Ada (Project Coordinator) · human-action · standup 2026-10-14', proposalId: 'x' } as ApprovalItem;
  const { cards, needs } = collectDecisions(input({ roster: roster(escs, [proposal]), stuck: { floor: 'f1', items: [stuck('pr-98', { pr: { number: 98, title: 'Visitor checkout' } })] } }));
  assert.equal(cards.length, 1, 'one card, not seven');
  const c = cards[0];
  assert.equal(c.sources.length, 7);
  assert.deepEqual(new Set(c.sources.map((s) => s.type)), new Set(['escalation', 'approval', 'stuck']));
  assert.equal(c.kind, 'decision', 'the strongest kind leads (a question about merging)');
  assert.ok(c.sources.filter((s) => s.fyi).length === 2, 'the FYIs are sources (noted when the card is answered)');
  assert.equal(hereCount(needs), 1);
  assert.match(countsWords(cardCounts(cards)), /^1 decision$/);
});

const brief = (o: Partial<QuestionBrief> = {}): QuestionBrief => ({ key: 'F002-visitor-invitations.brd.json#OQ-07', id: 'OQ-07', file: 'F002-visitor-invitations.brd.json', brd: 'F002', question: 'Who signs off how long visitor data is kept?', kind: 'user-only', state: 'RAISED', blocks: 'FR15, FR04', where: 'main', ...o });
const qneed = (items: QuestionBrief[]): QuestionsNeed => ({ floor: 'f1', waiting: items.filter((b) => !b.answered).length, brds: 1, blocking: items.filter((b) => !b.answered).length, batch: 3, items });
const register = stuck('decision-OQ-07', { kind: 'decision', decision: { id: 'OQ-07', question: 'Who signs off visitor data retention?', rows: '', journeys: [] }, evidence: [{ label: 'PROJECT.md:49', file: 'PROJECT.md', line: 49 }] });
const brdStuck = stuck('decision-F002-OQ-07', { kind: 'decision', decision: { id: 'OQ-07', question: 'Who signs off how long visitor data is kept?', rows: '', journeys: [], brd: 'F002-visitor-invitations.brd.json' }, questionKey: 'F002-visitor-invitations.brd.json#OQ-07' });

test('decisions-register-and-brd-question: OQ-07 in PROJECT.md and in F002 (and its stuck item) is one card, answered on the Questions page', () => {
  const { cards } = collectDecisions(input({ questions: qneed([brief()]), stuck: { floor: 'f1', items: [register, brdStuck] } }));
  assert.equal(cards.length, 1);
  const c = cards[0];
  assert.equal(c.id, 'q:F002-visitor-invitations.brd.json#OQ-07', 'the question leads: its one answer path');
  assert.deepEqual(c.sources.map((s) => s.id).sort(), ['q:F002-visitor-invitations.brd.json#OQ-07', 'stuck:decision-F002-OQ-07', 'stuck:decision-OQ-07'].sort());
  assert.deepEqual(c.need.target, { to: 'questions', key: 'F002-visitor-invitations.brd.json#OQ-07' });
  assert.match(c.after, /Questions page/);
  assert.deepEqual(c.blocks.map((b) => b.label), ['FR15', 'FR04']);
  // Answered and sent: the BRD's stuck item resolves; the register's still lists it, and the card says why (not waiting on you).
  const after = collectDecisions(input({ questions: qneed([brief({ answered: { status: 'sent', to: 'Tim', kind: 'answer' } })]), stuck: { floor: 'f1', items: [register] } }));
  assert.equal(after.cards.length, 1);
  assert.equal(after.cards[0].level, 'info');
  assert.ok(after.cards[0].notes.some((n) => /still lists it as open: it closes once the register is updated/.test(n)));
  assert.equal(hereCount(after.needs), 0);
  // The answer message asks the analyst to update the register too, so both close.
  const msg = answersMessage([{ key: brief().key, id: 'OQ-07', file: brief().file, kind: 'answer', text: 'The DPO', by: 'Keith', at: NOW, status: 'pending' }], new Map(), 'Keith');
  assert.match(msg, /PROJECT\.md's Open questions \(the register\) lists the same id, mark that row answered too/);
});

test('decisions-question-single-path: a BRD question shows once; its stuck source answers on the Questions page, never as a message to the lead', () => {
  const { cards } = collectDecisions(input({ questions: qneed([brief()]), stuck: { floor: 'f1', items: [brdStuck] } }));
  assert.equal(cards.length, 1);
  assert.ok(cards[0].sources.every((s) => s.target.to === 'questions'));
  assert.ok(!stuckActions(brdStuck).includes('answer'), 'no lead message from the stuck card');
  // Alone (no question card yet), the stuck item's own Answer still goes to the Questions page at its question.
  const alone = collectDecisions(input({ stuck: { floor: 'f1', items: [brdStuck] } }));
  assert.deepEqual(alone.needs[0].target, { to: 'questions', key: 'F002-visitor-invitations.brd.json#OQ-07' });
  // Two BRDs with the same id: the register row can't say which, so nothing merges on the id.
  const twin = brief({ key: 'F003-x.brd.json#OQ-07', file: 'F003-x.brd.json', brd: 'F003' });
  assert.equal(collectDecisions(input({ questions: qneed([brief(), twin]), stuck: { floor: 'f1', items: [register] } })).cards.length, 3);
});

test('decisions-fyi-with-options-is-decision: an FYI with options or a question is a decision card, noted as filed as FYI; a plain FYI has Noted only', () => {
  const r = roster([esc('s43', 'S4-3: which login screen?', { fyi: true, options: ['SSO only', 'SSO and local'] }), esc('s44', 'Does the export need a header row?', { fyi: true }), esc('n', 'Merged #97 after review', { fyi: true })]);
  const { cards, needs } = collectDecisions(input({ roster: r }));
  const byId = (id: string) => cards.find((c) => c.escalation === id)!;
  for (const id of ['s43', 's44']) {
    assert.equal(byId(id).kind, 'decision');
    assert.ok(byId(id).notes.some((n) => /Filed as FYI/.test(n)));
    assert.notEqual(byId(id).level, 'info', 'counted as waiting on you');
    assert.ok(!cardActs(byId(id)).includes('noted'));
  }
  assert.equal(byId('n').kind, 'fyi');
  assert.deepEqual(cardActs(byId('n')), ['noted']);
  assert.equal(byId('n').after, "Noting doesn't approve anything.");
  assert.equal(hereCount(needs), 2);
  assert.equal(countsWords(cardCounts(cards)), '2 decisions · 1 FYI');
});

/** A release-45 record: no refs at all. */
const legacy = (id: string, title: string, o: Partial<Escalation> = {}) => {
  const e = { ...esc(id, title, o) } as Escalation;
  delete (e as { refs?: unknown }).refs;
  return e;
};

test('decisions-legacy-derived-refs: a legacy escalation naming one PR in its title groups (id read from the title, nothing written back); one naming two PRs does not', () => {
  const old = legacy('old98', 'Please merge #98');
  const two = legacy('two', 'Merge #98 and #99?');
  const fresh = esc('new98', 'OK to merge #98 before the demo?');
  const { cards } = collectDecisions(input({ roster: roster([old, two, fresh]), stuck: { floor: 'f1', items: [stuck('pr-98', { pr: { number: 98, title: 'x' } })] } }));
  const c = cards.find((x) => x.sources.some((s) => s.id === 'stuck:pr-98'))!;
  assert.deepEqual(c.sources.map((s) => s.id).sort(), ['esc:new98', 'esc:old98', 'stuck:pr-98']);
  assert.equal(c.sources.find((s) => s.id === 'esc:old98')!.note, 'recorded before decision cards, id read from the title');
  assert.equal(old.refs, undefined, 'nothing written back to the record');
  const t = cards.find((x) => x.escalation === 'two')!;
  assert.equal(t.sources.length, 1, 'two PRs in one title name neither');
  assert.ok(t.notes.some((n) => /no id in its title/.test(n)));
  // Separate still works on it.
  const split = collectDecisions(input({ roster: roster([old, two, fresh]), stuck: { floor: 'f1', items: [stuck('pr-98', { pr: { number: 98, title: 'x' } })] }, splits: [{ cardId: c.id, sourceId: 'esc:old98' }] }));
  assert.equal(split.cards.find((x) => x.escalation === 'old98')!.sources.length, 1);
});

test('decisions-legacy-records: a release-45 escalation (no refs) with no id in its title shows on its own with a legacy note; nothing is invented', () => {
  const old = legacy('old', 'Can you look at the checkout flow');
  const answered = { ...esc('done', 'Old one'), status: 'resolved', resolution: { verdict: 'approve', text: '', by: 'Keith', at: NOW - H, delivered: true } } as Escalation;
  delete (answered as { refs?: unknown }).refs;
  const { cards } = collectDecisions(input({ roster: roster([old, answered]), stuck: { floor: 'f1', items: [stuck('pr-98', { pr: { number: 98, title: 'x' } })] } }));
  assert.equal(cards.length, 2, 'not grouped with stuck pr-98: similar words never merge');
  const c = cards.find((x) => x.escalation === 'old')!;
  assert.ok(c.notes.some((n) => /Recorded before decision cards: no id in its title/.test(n)));
  assert.equal(c.sources[0].note, 'recorded before decision cards');
  assert.equal(old.refs, undefined, 'no ids invented on the record');
  assert.equal(c.since, old.at, 'its own time, nothing invented');
  assert.ok(!cards.some((x) => x.escalation === 'done'), 'answered ones aren’t cards');
});

test('decisions-kinds: needs-human is hands-on, a plain FYI is Noted only, a decision has its options; the same at autonomy levels 1–4', () => {
  const who = { workerId: 'w', by: 'Ada', role: 'pm' as const };
  for (const level of [1, 2, 3, 4] as AutonomyLevel[]) {
    const hands = makeEscalation({ urgency: 'important', trigger: 'needs-human', title: 'Sign in to the Marketplace on this machine: mxcli auth login', details: '', options: [] }, who, level, `h${level}`, NOW);
    assert.equal(escalationKind(hands).kind, 'hands-on', `level ${level}`);
    const dec = makeEscalation({ urgency: 'urgent', title: 'Who owns SSO?', details: '', options: ['Name them now', 'Keep stubs'] }, who, level, `d${level}`, NOW);
    const fyi = makeEscalation({ urgency: 'info', title: 'Merged #98 after the checks passed', details: '', options: [] }, who, level, `f${level}`, NOW);
    const { cards } = collectDecisions(input({ roster: roster([hands, dec, fyi]) }));
    const of = (id: string) => cards.find((c) => c.escalation === id)!;
    assert.deepEqual(cardActs(of(`h${level}`)), ['done', 'cant-now', 'ask']);
    assert.match(of(`h${level}`).after, /press I've done it\. Ada is told and re-checks\. Pressing it doesn't prove it worked\./);
    assert.deepEqual(cardActs(of(`d${level}`)), ['option', 'reply', 'ask']);
    const f = of(`f${level}`);
    if (fyi.fyi) assert.deepEqual(cardActs(f), ['noted']);
    else assert.ok(!cardActs(f).includes('done'));
    assert.deepEqual(fyi.refs, { pr: 98 }, 'a new record carries its refs');
  }
});

test('a decision card says what happens: typed to the agent now, even mid-turn, never "after their current turn"', () => {
  const w = afterWords('decision', { owner: 'Ada' });
  assert.match(w, /^After you answer: it's typed to Ada now, even mid-turn \(taken in at its next step; held only while a question is open in its terminal\), and Ada records it\. This card shows Sent until then\.$/);
  assert.doesNotMatch(w, /after their current turn/, 'roster/escalation-answer.ts types a working agent at once (only interruption-rule actions ask first)');
});
