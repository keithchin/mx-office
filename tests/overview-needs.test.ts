// The Portal Overview's Needs you card (src/client/ui/portal/needs-card.ts, needs-logic.ts): the escalations
// as full cards (the question, who raised it, the options with the recommendation marked, why), a merged PR
// that isn't verified with its three ways out, the other items as rows with a tag in words, and answering
// through the escalation's existing action. The card is drawn on a stand-in DOM (tests/support/fakedom.ts)
// from the Needs-you strip's published list, with the answer action handed in so the test can see it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { installFakeDom, FakeEl } from './support/fakedom.js';
import type { Escalation } from '../src/shared/roster/escalation.js';
import type { RosterView } from '../src/shared/roster/types.js';
import { collectNeeds } from '../src/shared/needsyou.js';
import { answerFor, escalationModel, isNotVerified, recommendedIndex, rowModel, verifyAnswer } from '../src/client/ui/portal/needs-logic.js';

installFakeDom();
const toasts = document.createElement('div');
toasts.id = 'toasts';
document.body.append(toasts);
// Toasts fade out later through their style: the stand-in DOM has none, so each gets one.
const made = document.createElement;
document.createElement = ((t: string) => Object.assign(made(t), { style: {} })) as typeof document.createElement;
Object.assign(globalThis, { requestAnimationFrame: (f: () => void) => setTimeout(f, 0), CSS: { escape: (s: string) => s } });
const { needsCard } = await import('../src/client/ui/portal/needs-card.js');
const { publishNeeds } = await import('../src/client/ui/needsyou/feed.js');

const esc = (o: Partial<Escalation> = {}): Escalation =>
  ({ id: 'e1', at: Date.now() - 18 * 60_000, workerId: 'w-dev', by: 'Dylan', role: 'lead-developer', urgency: 'urgent', trigger: 'design', fyi: false, level: 2, title: 'BR024 Withdraw: should a withdrawn request notify the approver?', details: 'An employee can withdraw a request that is waiting for approval.\n\nMore below.', options: ['Notify the approver', 'Remove it silently'], recommendation: 'Notify the approver: they may already be reviewing it', status: 'open', ...o }) as Escalation;
const verify = esc({ id: 'e9', urgency: 'important', trigger: undefined, title: 'PR #79 merged, not verified: required checks didn’t pass on merge commit abc1234', details: "Dylan's pull request #79 is merged, but its task isn't counted as delivered.", options: ['Re-run checks', 'Waive (with a reason)', 'Send back for rework'], recommendation: undefined });

test('an escalation as a full card: its tag in words, who raised it (via the lead), the question, the options with the recommendation marked, why', () => {
  const m = escalationModel(esc(), { leadName: 'Ada', ago: () => '18m ago' });
  assert.deepEqual([m.kind, m.tag, m.tone], ['escalation', 'Blocking', 'block']);
  assert.equal(m.meta, 'Dylan · Lead Developer · via Ada · 18m ago · a design change');
  assert.equal(m.question, 'An employee can withdraw a request that is waiting for approval.');
  assert.deepEqual(m.options, [{ key: 'A', text: 'Notify the approver', recommended: true }, { key: 'B', text: 'Remove it silently', recommended: false }]);
  assert.deepEqual(m.why, { label: 'Why A:', text: 'they may already be reviewing it' });
  assert.equal(escalationModel(esc({ urgency: 'important', trigger: 'scope' }), { ago: () => '' }).tag, 'Decision');
  // A recommendation that is just the option's words: marked, no "why" to add.
  assert.equal(escalationModel(esc({ recommendation: 'Remove it silently' }), { ago: () => '' }).why, undefined);
  // One that names no option: said as it is.
  assert.deepEqual(escalationModel(esc({ recommendation: 'Ask Finance first' }), { ago: () => '' }).why, { label: 'Recommends:', text: 'Ask Finance first' });
  assert.equal(recommendedIndex(['Yes', 'No'], 'B: because'), 1, '"B: …" picks the second');
  assert.equal(recommendedIndex(['Yes', 'No'], undefined), -1);
});

test('a merged PR not verified is its own card: "Not verified", and Re-run checks / Send back answer it with its own options', () => {
  assert.ok(isNotVerified(verify));
  const m = escalationModel(verify, { ago: () => '' });
  assert.deepEqual([m.kind, m.tag, m.tone], ['verify', 'Not verified', 'verify']);
  assert.deepEqual(verifyAnswer('rerun'), { verdict: 'reply', text: 'Go with: Re-run checks' });
  assert.deepEqual(verifyAnswer('back', 'the cost centre must be required'), { verdict: 'reply', text: 'Go with: Send back for rework. the cost centre must be required' });
});

test('what Send answer sends: the option picked ("Go with: …"), or your own words', () => {
  const m = escalationModel(esc(), { ago: () => '' });
  assert.deepEqual(answerFor(m, 'B', ''), { verdict: 'reply', text: 'Go with: Remove it silently' });
  assert.deepEqual(answerFor(m, undefined, ''), { verdict: 'reply', text: 'Go with: Notify the approver' }, 'the recommendation by default');
  assert.deepEqual(answerFor(m, 'A', '  Notify, and copy Finance  '), { verdict: 'reply', text: 'Notify, and copy Finance' });
  assert.equal(answerFor(escalationModel(esc({ options: [] }), { ago: () => '' }), undefined, ''), undefined, 'nothing to send');
});

test('the other items are rows with a tag in words as well as colour', () => {
  const items = collectNeeds({ floor: 'f1', workers: [], pulls: [], floors: [], setup: { show: true, stages: [{ id: '6', title: 'Test', status: 'MANUAL' }] } as never });
  const r = rowModel(items[0]);
  assert.deepEqual([r.tag, r.tone], ['✋ Sign-off', 'normal']);
  assert.match(r.text, /Stage 6 \(Test\) waits for your sign-off/);
});

const roster = (escalations: Escalation[], admin = true): RosterView =>
  ({ floor: 'f1', admin, coverage: { management: 'pm', analysis: 'chief-analyst', design: 'lead-designer', development: 'lead-developer', testing: 'lead-tester' }, members: [{ role: 'pm', title: 'Project Coordinator', name: 'Ada', status: 'idle', workerId: 'w-pm' }], escalations, approvals: [], settings: {} }) as unknown as RosterView;

const text = (el: FakeEl) => el.outerHTML.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

test('the card draws the escalations from the strip’s list, and Send answer calls the existing answer action', async () => {
  const calls: unknown[][] = [];
  const asked: string[] = [];
  const shown: string[] = [];
  const card = needsCard({
    show: (t) => shown.push(t),
    answer: async (...a) => {
      calls.push(a);
      return undefined; // refused (act toasts why): the card stays, its buttons come back
    },
    ask: (t) => (asked.push(t), true),
  });
  const r = roster([esc(), verify]);
  const items = collectNeeds({ floor: 'f1', roster: r, workers: [], pulls: [], floors: [] });
  publishNeeds({ floor: 'f1', items, roster: r, go: () => {} });
  const el = card.el as unknown as FakeEl;
  const all = text(el);
  assert.match(all, /Needs you/);
  assert.match(all, /2 now/);
  assert.match(all, /Blocking/);
  assert.match(all, /BR024 Withdraw: should a withdrawn request notify the approver\?/);
  assert.match(all, /A\. Notify the approver Recommended/);
  assert.match(all, /B\. Remove it silently/);
  assert.doesNotMatch(all, /B\. Remove it silently Recommended/);
  assert.match(all, /Why A: they may already be reviewing it/);
  assert.match(all, /Not verified/);
  assert.match(all, /Re-run checks/);
  const escCard = el.querySelector('.pt-esc')!;
  assert.equal(escCard.getAttribute('data-id'), 'e1');
  (escCard.querySelector('.pt-esc-send') as FakeEl).click();
  await new Promise((res) => setTimeout(res, 0));
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 'f1');
  assert.equal((calls[0][1] as Escalation).id, 'e1');
  assert.deepEqual(calls[0].slice(2), ['reply', 'Go with: Notify the approver']);
  // Ask Ada: the panel's box, prefilled.
  (escCard.querySelector('.pt-esc-ask') as FakeEl).click();
  assert.deepEqual(asked, ['About "BR024 Withdraw": ']);
  // The verify card: Re-run checks answers with its option, Waive opens the Testing tab.
  const v = el.querySelectorAll('.pt-esc').find((x) => x.getAttribute('data-id') === 'e9')!;
  const [rerun, waive] = v.querySelectorAll('.pt-esc-acts .btn');
  rerun.click();
  await new Promise((res) => setTimeout(res, 0));
  assert.deepEqual(calls[1].slice(2), ['reply', 'Go with: Re-run checks']);
  waive.click();
  assert.deepEqual(shown, ['testing']);
});

test('answered: the card goes, an Answered row says what was sent; a redraw keeps the cards it already shows', async () => {
  const sent: string[] = [];
  // Accepted: the team as it is afterwards (another floor's here, so the page's roster is left alone).
  const answer = async (_f: string, _e: Escalation, _v: string, t: string) => (sent.push(t), { ...roster([]), floor: 'other' } as RosterView);
  const card = needsCard({ show: () => {}, answer, ask: () => true });
  const r = roster([esc(), esc({ id: 'e2', title: 'Cost limit: over €5,000?', urgency: 'important', trigger: undefined })]);
  const items = collectNeeds({ floor: 'f1', roster: r, workers: [], pulls: [], floors: [] });
  publishNeeds({ floor: 'f1', items, roster: r, go: () => {} });
  const el = card.el as unknown as FakeEl;
  const second = el.querySelectorAll('.pt-esc')[1];
  // The same list again (the strip publishes on every change): the cards are the same elements.
  publishNeeds({ floor: 'f1', items, roster: r, go: () => {} });
  assert.equal(el.querySelectorAll('.pt-esc')[1], second);
  (el.querySelector('.pt-esc .pt-esc-send') as FakeEl).click();
  await new Promise((res) => setTimeout(res, 0));
  assert.deepEqual(sent, ['Go with: Notify the approver']);
  const all = text(el);
  assert.match(all, /Answered/);
  assert.match(all, /Notify the approver · sent to Dylan/);
  assert.equal(el.querySelectorAll('.pt-esc').length, 1, 'the answered card is gone');
  assert.match(all, /1 now/);
});

test('someone who isn’t the Project Manager sees the card but can’t answer it', () => {
  const card = needsCard({ show: () => {}, answer: async () => undefined, ask: () => true });
  const r = roster([esc()], false);
  publishNeeds({ floor: 'f1', items: collectNeeds({ floor: 'f1', roster: r, workers: [], pulls: [], floors: [] }), roster: r, go: () => {} });
  const all = text(card.el as unknown as FakeEl);
  assert.match(all, /Only the Project Manager \(an admin\) can answer it\./);
  assert.equal((card.el as unknown as FakeEl).querySelector('.pt-esc-send'), null);
});
