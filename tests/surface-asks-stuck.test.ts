// Nothing waits on the PM unseen, S5: stuck detection's additions. PROJECT.md open questions in the
// toolkit's own words (RAISED, UNRAISED) count as open; build-plan rows whose State starts with "blocked"
// become one item per blocker after decisionHours, and a row still blocked on a decision that's resolved
// says so ("update the build plan or name the real blocker").
import test from 'node:test';
import assert from 'node:assert/strict';
import { STUCK_DEFAULTS, leadMessage, stuckActions, stuckTitle } from '../src/shared/stuck.js';
import { detectStuck } from '../src/server/stuck/detect.js';
import { openQuestions } from '../src/server/stuck/parse.js';
import { blockedRows, blockerOf, resolvedId } from '../src/server/stuck/blocked-rows.js';
import { collectNeeds } from '../src/shared/needsyou.js';

const H = 3_600_000;
const NOW = Date.parse('2026-10-13T12:00:00Z');

const PROJECT = `# PROJECT.md

## Decisions

| Stage | Decision | Status | Notes |
|---|---|---|---|
| 4 | Integration owners: the PM owns SSO, SMTP and the AI service (OW-1) | CONFIRMED | PM via Ada 2026-10-08 |

## Open questions

| # | Question | Raised at | Status |
|---|---|---|---|
| OQ-1 | Which AI provider may the assistant use? | Stage 3 gate | ANSWERED 2026-10-06 |
| OQ-9 | Is the Finance export daily or monthly? Client to answer | Stage 2 gate 2026-10-09 | RAISED |
| OQ-10 | Retention period for rejected requests (client) | 2026-10-10 | UNRAISED |
| OI-2 | NFR volumes | 2026-10-08 | Decided |
`;

const PLAN = (state59: string, more = '') => `# Build plan

## Pending decisions

| ID | Question | Raised | Blocks (rows) | Build proceeds on |
|---|---|---|---|---|
| OW-1 | Who owns SSO, SMTP and the AI service? | PROJECT.md OW-1, 2026-10-05 | 59 | stubs | DECIDED 2026-10-08 |

## Script sequence

| # | Kind | Step | Produces | State |
|---|---|---|---|---|
| 58 | BRIEF | integration contracts | brief | built |
| 59 | BUILD | install Email Connector | real mail | ${state59} |
| 60 | BUILD | install OIDC SSO | J-09 | blocked - OW-1 (IdP owner and test tenant) since 2026-10-07; J-09 not written |
| 61 | BUILD | install GenAI Commons | assistant | blocked - OW-1 (AI endpoint not named) |
| 70 | BUILD | Team filters | P5c | blocked: the Lead Designer's sign-off on the filters (2026-10-11) |
| 71 | PROVE | J-08 | journey | blocked on #51 |
${more}`;

test("open questions in the toolkit's words: RAISED and UNRAISED are open, ANSWERED and Decided aren't", () => {
  const qs = openQuestions(PROJECT).map((q) => q.id);
  assert.deepEqual(qs, ['OQ-9', 'OQ-10']);
  const drafts = detectStuck({ now: NOW, settings: STUCK_DEFAULTS, pulls: [], files: { project: { file: 'PROJECT.md', text: PROJECT }, reports: [] }, firstSeen: () => NOW });
  assert.deepEqual(drafts.map((d) => d.id), ['decision-OQ-9', 'decision-OQ-10']);
});

test("a blocked row's blocker, and whether the decision it names is resolved", () => {
  assert.equal(blockerOf('blocked - OW-1 (SMTP host and account owner); STUB_SUB_Notification_Send in use'), 'OW-1 (SMTP host and account owner)');
  assert.equal(blockerOf('Blocked: the sign-off'), 'the sign-off');
  assert.equal(resolvedId('OW-1', PLAN('blocked - OW-1'), PROJECT), true, 'DECIDED in the pending table, CONFIRMED in PROJECT.md');
  assert.equal(resolvedId('OQ-9', PLAN('x'), PROJECT), false);
});

test('rows blocked on a resolved decision: one item that says to update the build plan; a real blocker after decisionHours', () => {
  const items = blockedRows({ now: NOW, decisionHours: 24, plan: { file: 'architecture/build-plan.md', text: PLAN('blocked - OW-1 (SMTP host and account owner)') }, project: { file: 'PROJECT.md', text: PROJECT }, openPrs: new Set([51]), firstSeen: () => NOW - 30 * H });
  // OW-1 is decided, so its pending row parks nothing any more: 59 to 61 are one item. Row 71 waits on open PR #51 (the stale-PR rule's).
  assert.deepEqual(items.map((d) => d.id), ['blocked-OW-1', 'blocked-the-lead-designer-s-sign-off-on-the-filters']);
  const ow = items[0];
  assert.equal(ow.kind, 'blocked-row');
  assert.equal(stuckTitle(ow, NOW), 'Rows 59–61 say blocked on OW-1, which is resolved: update the build plan or name the real blocker');
  assert.deepEqual(stuckActions(ow), ['ask-lead', 'snooze', 'dismiss']);
  assert.match(leadMessage('ask-lead', ow, NOW) ?? '', /update the build plan or name the real blocker/);
  assert.equal(ow.evidence[0].label, 'architecture/build-plan.md:14 (row 59)');
  assert.equal(stuckTitle(items[1], NOW), "Build-plan row 70 has been blocked for 2 days on: the Lead Designer's sign-off on the filters (2026-10-11)");
});

test('a blocked row younger than decisionHours waits; with no date it is timed from when the office first saw it', () => {
  const young = blockedRows({ now: NOW, decisionHours: 24, plan: { file: 'architecture/build-plan.md', text: PLAN('built').replace(/\| 6[01] \|.*\n/g, '').replace(/\| 7[01] \|.*\n/g, '') + '| 80 | BUILD | x | y | blocked - the client sends the logo |\n' }, openPrs: new Set(), firstSeen: () => NOW - 2 * H });
  assert.equal(young.length, 0);
  const old = blockedRows({ now: NOW, decisionHours: 24, plan: { file: 'architecture/build-plan.md', text: '| # | Produces | State |\n|---|---|---|\n| 80 | logo | blocked - the client sends the logo |\n' }, openPrs: new Set(), firstSeen: () => NOW - 26 * H });
  assert.equal(old.length, 1);
  assert.match(stuckTitle(old[0], NOW), /^Build-plan row 80 has been blocked for 26 hours on: the client sends the logo$/);
  // Needs you shows it as worth a look, with a button to its card.
  const needs = collectNeeds({ floor: 'f1', workers: [], pulls: [], floors: [], stuck: { floor: 'f1', items: [{ ...old[0], raisedAt: NOW }] }, now: NOW });
  assert.deepEqual(needs.map((n) => [n.kind, n.level, n.icon]), [['stuck', 'warn', '🧱']]);
});
