// Real-build fixes: the wizard's team recommendation is the same for the same description and answers, and says why
// (shared/roster/recommend.ts personIntake, docs/mockups/product-assessment/real-build-test.md P2-7). The drafted
// brief's prose varied between two drafts of the same description and moved the pick from Solo · Lean to Startup ·
// Balanced; now only the person's own words steer it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { integrationsOf, personIntake, recommendShape } from '../src/shared/roster/recommend.js';
import type { IntakeAnswer } from '../src/shared/wizard.js';

const PROMPT = 'A Mendix app where staff request loans of shared equipment and coordinators approve them, track handout and return, and chase overdue items.';
const SAID = ['Loans cannot be extended, the coordinator edits the end date. Email reminders are out. Under 200 items and 100 users. The admin creates the accounts.'];

test('the same description and answers give the same team, whatever two drafts of the brief said', () => {
  // Two drafts' kickoff answers for the same description (the old input): their prose differs.
  const draftA: IntakeAnswer[] = [{ n: 4, kind: 'answered', text: 'In scope: loan requests, approval, handout and return.' }];
  const draftB: IntakeAnswer[] = [{ n: 4, kind: 'answered', text: 'In scope: the entire loan process, the whole app end to end.' }, { n: 5, kind: 'answered', text: 'Notifications by email, a scheduled overdue job and an export to a report.' }];
  const before = [draftA, draftB].map((intake) => recommendShape({ tier: 'small', entry: 'greenfield', intake }));
  assert.notDeepEqual([before[0].shape, before[0].level], [before[1].shape, before[1].level], 'the drafts’ prose used to move it');
  // Now: from the person's words only, so both drafts give one answer, every time.
  const runs = Array.from({ length: 3 }, () => recommendShape({ tier: 'small', entry: 'greenfield', intake: personIntake(PROMPT, SAID) }));
  for (const r of runs) assert.deepEqual([r.shape, r.level], ['solo', 'lean']);
  assert.ok(runs[0].why.length >= 2, 'it says why');
  assert.deepEqual(runs[0].why.slice(0, 2), ['small tier', 'greenfield']);
  // An answer the person typed for a question wins over their general words.
  const typed = personIntake(PROMPT, SAID, [{ n: 2, kind: 'answered', text: 'Hard deadline: go-live by 1 December, urgent' }]);
  assert.equal(recommendShape({ tier: 'small', entry: 'greenfield', intake: typed }).level, 'fast');
});

test('what a sentence rules out names no integration ("email reminders are out")', () => {
  assert.equal(integrationsOf('Email reminders are out. No SSO.'), 'unknown');
  assert.equal(integrationsOf('Keep the SAP feed. Email reminders are out.'), 'some');
});
