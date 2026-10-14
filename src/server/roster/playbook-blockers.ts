// The Playbook's blocker rules (travel-approval, 2026-10-12: PR #51 sat open for four days and decision
// OW-1 parked build-plan rows 59–62 while the team worked around both and nobody told the Project
// Manager). Whoever covers Management runs a blocker sweep at every standup and at least daily, and
// escalates anything only the Project Manager or the client can clear that has blocked work for more
// than a day; every Lead says so when it works around a blocker. The office's own stuck detection
// (server/stuck/) is the net under these, not a replacement for them. Nothing waits on the PM unseen
// (2026-10-13): asks that sat only in chat, a journal's AWAITING-PM line or an unmerged branch reached the
// Project Manager only when they asked the Coordinator, so every ask is an escalation, hands-on ones
// (trigger needs-human) straight away, and the Coordinator's pages go to main in a docs PR daily.

import { managerOf, type Coverage } from '../../shared/roster/coverage.js';
import type { RoleId } from '../../shared/roster/roles.js';
import { teamLabel } from '../../shared/roster/card-team.js';

export const BLOCKER_HEADING = '## Blockers only the Project Manager can clear';

export const BLOCKER_SWEEP =
  "- **Blocker sweep.** At every standup, and at least once a day while you are working, go through the build plan's pending decisions and rows whose state starts with `blocked`, PROJECT.md's open questions, the BRD's `openQuestions` that are RAISED or UNRAISED, `analysis/sme-questions.md`, every Lead's latest `AWAITING-PM` line, `.claude/.gate-advisories` and the open pull requests. Anything only the Project Manager or the client can resolve (a decision, a named owner, an access, a stale pull request) that has blocked work for more than a day must be raised with `office-workers escalate` (trigger `blocked`), with the options and your recommendation. Don't just work around it silently: stubs or workarounds only once the Project Manager has said so. An ask that needs a person's hands is raised straight away, without waiting a day.";

/** Hands-on asks (S1 of the surface-asks work): only a person can do them, so they're escalations, never task proposals. */
export const HANDS_ON =
  "- **Hands-on asks go to `escalate`, never a proposal.** Merging a pull request, signing in (`mxcli auth login`, `gh auth login`), pasting a key or secret, installing a tool, allowing something at the terminal, restarting a preview: only a person can do these. Raise each batch with `office-workers escalate --trigger needs-human` (never as a `task` proposal, which an autonomous level would approve with nobody doing it).";

/** Whoever covers Management: an ask in a reply is an escalation too, and only escalated items are "Blocked on you". */
export const REPLY_ASKS =
  "- **Every ask is an escalation.** When a reply of yours to the Project Manager asks them for something, end that turn by filing it with `office-workers escalate` (one for the batch).";

/** The journal and standup pages reach main: the office reads gates and stuck work from main only. */
export const DOCS_PR = `- **Your pages reach main.** At least once a day, after the standup, open a docs-only pull request with your journal and the standup pages: \`gh pr create --label ${teamLabel('management')} …\` from a branch with only those files. Pages left on your branch are invisible to the office.`;

export const BLOCKED_ON_YOU = '- In the standup **Summary**, list what you raised under **Blocked on you**; the office adds what it found stuck itself. Only escalated items go there: escalate anything else first.';

/** Every Lead's line: a workaround is said out loud, to `lead` (or escalated, by the one who covers Management). */
export function workaroundLine(isManager: boolean, lead: string): string {
  const tell = isManager ? 'and if only the Project Manager or the client can clear it, escalate it (the blocker sweep above)' : `and tell ${lead} (\`office-workers tell\`), who covers Management and raises it with the Project Manager`;
  return `- **Working around a blocker?** If you build on a stub, skip a test or work around an open pull request or a missing decision, say so in your handoff and your journal (what is blocked, since when, what you did instead), ${tell}. Never leave it only in a row's state or a test's notes.`;
}

/** The section for `roleId`: the sweep for whoever covers Management, the workaround line for every Lead. */
export function blockerLines(roleId: RoleId, c: Coverage | undefined, names: Partial<Record<RoleId, string>>): string[] {
  const manager = c ? managerOf(c) : 'pm';
  const isManager = roleId === manager;
  const lead = names[manager] ?? (manager === 'pm' ? 'the Project Coordinator' : 'the lead who covers Management');
  return [BLOCKER_HEADING, ...(isManager ? [BLOCKER_SWEEP, REPLY_ASKS, BLOCKED_ON_YOU, DOCS_PR] : []), HANDS_ON, ...(roleId !== 'pm' ? [workaroundLine(isManager, lead)] : []), ''];
}
