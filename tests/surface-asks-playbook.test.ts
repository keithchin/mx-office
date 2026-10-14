// Nothing waits on the PM unseen, S1: the Playbook and prompt rules. Every ask for the Project Manager is an
// escalation (the toolkit's "ask in chat" is overridden for the office), hands-on asks are `needs-human`
// escalations rather than task proposals, the blocker sweep reads every place an ask hides, the Coordinator
// lists only escalated items under Blocked on you and opens a docs PR daily, and the chat- and journal-only
// outlets in the prompts ask for the escalation as well.
import test from 'node:test';
import assert from 'node:assert/strict';
import { playbook, type PlaybookContext } from '../src/server/roster/playbooks.js';
import { benchPrompt, primePrompt, standupCompiledPrompt, standupPrompt } from '../src/server/roster/prompts.js';
import { handoffPrompt } from '../src/server/project-run/brief.js';
import { pinBlock } from '../src/server/toolkit-pin/instructions.js';
import { defaultCoverage, managerOf, SHAPES } from '../src/shared/roster/coverage.js';
import { ROLES, type RoleId } from '../src/shared/roster/roles.js';

const names = Object.fromEntries(ROLES.map((r) => [r.id, r.title.split(' ')[0]])) as Record<RoleId, string>;
const ctx = (over: Partial<PlaybookContext> = {}): PlaybookContext => ({ project: 'travel-approval', name: 'Sam', level: 4, lessons: '.ai-context/skills/project-lessons/SKILL.md', names, earlyDrafts: true, toolkit: { dir: 'C:/tk', sha: '7b4b4cf13b9f' }, ...over });

test("every role's Playbook overrides the toolkit's ask-in-chat and sends hands-on asks to escalate as needs-human", () => {
  for (const shape of Object.keys(SHAPES) as (keyof typeof SHAPES)[]) {
    const coverage = defaultCoverage(shape);
    for (const r of new Set(Object.values(coverage))) {
      const text = playbook(r, ctx({ coverage }));
      assert.match(text, /this wins over any toolkit skill that says to ask the user in chat/, `${shape}: ${r}`);
      assert.match(text, /never leave an ask only in your chat, a journal, a handoff or a standup page/, `${shape}: ${r}`);
      assert.match(text, /\*\*Hands-on asks go to `escalate`, never a proposal\.\*\*.*`office-workers escalate --trigger needs-human`/, `${shape}: ${r}`);
      assert.match(text, /mxcli auth login/, `${shape}: ${r}`);
    }
  }
  // Where the toolkit section is written, it says the one exception to "follow the skill on how".
  assert.match(playbook('lead-developer', ctx()), /One exception: where a skill says to ask the user .* you file the question or ask with `office-workers escalate`, one escalation per batch/);
});

test('whoever covers Management: replies with an ask end in an escalation, Blocked on you is escalated items only, a daily docs PR', () => {
  for (const shape of Object.keys(SHAPES) as (keyof typeof SHAPES)[]) {
    const coverage = defaultCoverage(shape);
    const lead = managerOf(coverage);
    const text = playbook(lead, ctx({ coverage }));
    assert.match(text, /\*\*Every ask is an escalation\.\*\* When a reply of yours to the Project Manager asks them for something/, shape);
    assert.match(text, /Only escalated items go there/, shape);
    assert.match(text, /\*\*Your pages reach main\.\*\* At least once a day, after the standup, open a docs-only pull request/, shape);
    assert.match(text, /gh pr create --label team:management|gh pr create --label \S*management/, shape);
    // The widened sweep: every place an ask hides, and no day's wait for a hands-on ask.
    for (const src of ['`openQuestions` that are RAISED or UNRAISED', 'analysis/sme-questions.md', "every Lead's latest `AWAITING-PM` line", '.claude/.gate-advisories', 'starts with `blocked`']) assert.ok(text.includes(src), `${shape}: ${src}`);
    assert.match(text, /An ask that needs a person's hands is raised straight away, without waiting a day/, shape);
    // Other Leads don't run the sweep, but still escalate hands-on asks.
    for (const r of new Set(Object.values(coverage))) {
      if (r === lead) continue;
      const t = playbook(r, ctx({ coverage }));
      assert.doesNotMatch(t, /\*\*Your pages reach main\.\*\*/, `${shape}: ${r}`);
    }
  }
});

test('the journal etiquette: questions, sign-offs and hands-on actions are escalations, not proposals', () => {
  const t = playbook('lead-developer', ctx());
  assert.match(t, /A question or sign-off you are waiting on is an escalation, not a proposal, and so is a hands-on action only a person can do/);
  assert.match(t, /A proposal the Project Manager must act on today is escalated as well/);
  assert.match(playbook('pm', ctx()), /Everything you list as needing the Project Manager must be in an open escalation/);
});

test('the prompts keep their outlets but ask for the escalation too', () => {
  assert.match(primePrompt('lead-developer', 'Sam', 2), /file that with `office-workers escalate` first: they never read this chat/);
  assert.match(benchPrompt('lead-developer', 'L.md', '2026-10-13 10:00'), /each item also in the escalation of step 1: the line alone is not an ask/);
  assert.match(handoffPrompt('Maurits', 'lead-developer', '2026-10-13 10:00'), /raise it now with `office-workers escalate` \(one escalation for the batch\), then end the entry with `AWAITING-PM/);
  assert.match(standupCompiledPrompt('2026-10-13', 2), /each item already in an open escalation \(file one first for any that isn't\)/);
  const up = standupPrompt('lead-developer', '2026-10-13', '2026-10-13 09:00');
  assert.match(up, /client-milestone, budget, human-action\./);
  assert.match(up, /is `human-action`, never `task`, and escalate it too \(`office-workers escalate --trigger needs-human`\)/);
});

test('the pin block no longer sends a toolkit ask to chat', () => {
  const b = pinBlock('C:/pins/7b4b4cf', '7b4b4cf13b9f');
  assert.doesNotMatch(b, /say so in chat or in your journal/);
  assert.match(b, /raise it with `office-workers escalate`/);
  assert.match(b, /where the toolkit says to ask the user in chat, in this Mx Office/);
});
