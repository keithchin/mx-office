// Jeff's "is it waiting on you?" kept honest (roster/jeff-ask.ts): the real last messages from a live
// floor (mx-spike, names kept, nothing secret in them) that he escalated as if they asked the Project
// Manager something, against ones that really did.
import test from 'node:test';
import assert from 'node:assert/strict';
import { realAsk, sameAsk, waitingCall } from '../src/server/roster/jeff-ask.js';

/** Progress reports and plans Jeff (on his say-so alone) raised as escalations. None asks anything. */
const FYI = [
  "I've approved #49's test results; merging it is the PM's call. I've told Anita, and the approval plus a merge proposal are in my journal on PR #48.\n\nStill running: the #51 Owner-required follow-up. When it's proven and reviewed, I'll send Anita its commit to cherry-pick into #51.",
  "Next is #51 (Owner required) and then #55 (follow-up (2), which Fran accepted). When Hedy sends her Owner-required spec commit, I'll rebase #51 onto #49 with it, then #55 on top, so each lands green.\n\nI also told Keith about my proposal that every edit popup's Cancel closes the popup.",
  'PRs as you described:\n- **#55:** A5/A10 as unexpected passes, and A1/A14 failing on the missing "Owner name" field.\n- **#57:** A2 as an unexpected pass.\n\nAnything else that\'s red, I\'ll check against the log and tell you before treating it as spec. The CI watch on #51, #55 and #57 is still running.',
  '- **Checks:** the BRD report finds 0 faults, and `brain check` is OK; the brain anchors are unaffected.\n- **Where it lives:** committed with a journal entry on `office/leslie-w42`, the same branch as the coming W42 memo. Anita knows.\n\nMerging that branch will need your approval when I open its PR.',
  "**Afterwards:** a secret only applies to new runs, so tell Hedy and she will re-run CI on #30, #31, #35 and #38. If you tell me it's set, I'll note it in the journal.",
  'A caveat on the approval: that line was a note in my own chat, not an escalation. I read "approved" as "go ahead and verify". If you meant something else, tell me.',
  "If Hedy merged it somewhere other than main, or under another branch name, tell me the PR number and I'll rebase onto that.\n\nCI from the last rebase is still running on all five branches, and my background watch is still on it.",
  "- **Branch:** `feature/run3-haiku-rerun` isn't on origin yet, so Leslie matches the run by worker id and `office/pixel-bfcc`.",
  'The journal entry is on `office/jinx-2c35-issue33`. The old temp worktree `Temp/anita/main-base` is still registered: its removal was blocked earlier and is safe to do with `git worktree remove --force`.',
  'Done. AWAITING-PM: none',
  'Fixed it. The function now reads `if (x?.y) return z?` correctly:\n\n```ts\nconst a = b ? c : d; // why?\n```',
];

/** Messages that do ask the Project Manager something. */
const ASKS: [string, RegExp][] = [
  ['All five are within the approved scope. Before I pass anything on, I need the Leads hired, because none of them is at a desk right now. Should I put that in the journal as a proposal?', /Should I put that/],
  ["**My recommendation:** approve the proposal, since you already chose this pattern for `demo_user`.\n\nI won't change anything until you answer. Hedy's administrator role check stays open in the meantime.", /until you answer/],
  ["This doesn't block merging #35; the fix can follow as a small change.\n\n**Waiting on the PM:** merging #35, #38 and #41.", /Waiting on the PM/],
  ['Her reasons: the cards make the phone usable.\n\nThis is a design change, and it holds up #54 until you decide.', /until you decide/],
  ['When you send the PR number, could you also say which rules the three extra lint warnings come from? The count went from 4 to 7.\n\nOn my side, I\'ll review your branch in the running app.\n\nI\'ve noted that the "#53" message didn\'t come from you.', /could you also say/],
  ['- **New decision for you:** Anita proposes that every NewEdit Cancel closes the popup. You approved only Save, so this is a design change.', /decision for you/],
  ['## 2026-10-05 — Handoff\n\n**Open threads**: the BRDs.\n\nAWAITING-PM: whether Person.Code is dropped', /AWAITING-PM: whether Person.Code/],
  ['Can you approve the schema change?', /approve the schema/],
];

test('a progress report, a plan or a conditional asks the Project Manager nothing', () => {
  for (const text of FYI) assert.equal(realAsk(text), undefined, text);
});

test('a question put to them, a request or approval, or an AWAITING-PM line is a real ask', () => {
  for (const [text, found] of ASKS) assert.match(realAsk(text) ?? '', found, text);
});

test('a question only in the code, a quote, or reported from someone else is not one', () => {
  assert.equal(realAsk('I asked Hedy whether the run passed?'), undefined);
  assert.equal(realAsk('Fran wrote "should we ship?" in her review. I replied in the thread.'), undefined);
  // An old question further up, answered since, isn't in the end of the message.
  assert.equal(realAsk('Should I merge it?\n\nYou said yes.\n\nMerged #4.\n\nMoving on to the tests.\n\nAll green.'), undefined);
});

test("agree (the default): his say-so without a real ask is held and logged; 'model' keeps how he was", () => {
  const base = { says: true, rule: false, duplicate: false };
  assert.deepEqual(waitingCall({ ...base, policy: 'agree', ask: undefined }), { escalate: false, held: 'no-ask' });
  assert.deepEqual(waitingCall({ ...base, policy: 'agree', ask: 'Should I?' }), { escalate: true });
  assert.deepEqual(waitingCall({ ...base, policy: 'model', ask: undefined }), { escalate: true });
  // The rule already says waiting (an escalation is open), or he says not waiting: nothing to raise, nothing held.
  assert.deepEqual(waitingCall({ ...base, policy: 'agree', rule: true, ask: 'Should I?' }), { escalate: false });
  assert.deepEqual(waitingCall({ ...base, policy: 'model', says: false, ask: 'Should I?' }), { escalate: false });
  // Raised already by the worker: held, whatever the policy.
  assert.deepEqual(waitingCall({ ...base, policy: 'model', ask: 'Should I?', duplicate: true }), { escalate: false, held: 'duplicate' });
});

test('the same ask in other words: same or nearly the same title words', () => {
  assert.ok(sameAsk('Set repo secret E2E_DEMO_ADMIN_PASSWORD', '**Set repo secret E2E_DEMO_ADMIN_PASSWORD.**'));
  assert.ok(sameAsk('Merge PR #46 (e2e spec fix): CI green', 'Merge PR #46 (e2e spec fix) — CI is green'));
  assert.ok(!sameAsk('Merge PR #46 (e2e spec fix)', 'Merge PR #47 (docs)'));
  assert.ok(!sameAsk('Set repo secret E2E_DEMO_ADMIN_PASSWORD (Hedy\'s #40 CI needs it)', 'Two design calls for the #19 work: drop Person.Code? Make Save close the popup?'));
});
