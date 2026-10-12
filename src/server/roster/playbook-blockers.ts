// The Playbook's blocker rules (travel-approval, 2026-10-12: PR #51 sat open for four days and decision
// OW-1 parked build-plan rows 59–62 while the team worked around both and nobody told the Project
// Manager). Whoever covers Management runs a blocker sweep at every standup and at least daily, and
// escalates anything only the Project Manager or the client can clear that has blocked work for more
// than a day; every Lead says so when it works around a blocker. The office's own stuck detection
// (server/stuck/) is the net under these, not a replacement for them.

import { managerOf, type Coverage } from '../../shared/roster/coverage.js';
import type { RoleId } from '../../shared/roster/roles.js';

export const BLOCKER_HEADING = '## Blockers only the Project Manager can clear';

export const BLOCKER_SWEEP =
  "- **Blocker sweep.** At every standup, and at least once a day while you are working, go through the build plan's pending decisions and blocked rows, PROJECT.md's open questions, the open pull requests and the Leads' journals and handoffs. Anything only the Project Manager or the client can resolve (a decision, a named owner, an access, a stale pull request that needs a person to review, merge or close) that has blocked work for more than a day must be raised with `office-workers escalate` (the `escalate` tool, trigger `blocked`), with the options and your recommendation. Don't just work around it silently: building on stubs or around an open pull request is fine only once the Project Manager has said so, and the escalation is how they find out.";

export const BLOCKED_ON_YOU = '- In the standup **Summary**, list what you raised (and anything still waiting on the Project Manager) under **Blocked on you**; the office adds what it found stuck itself.';

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
  return [BLOCKER_HEADING, ...(isManager ? [BLOCKER_SWEEP, BLOCKED_ON_YOU] : []), ...(roleId !== 'pm' ? [workaroundLine(isManager, lead)] : []), ''];
}
