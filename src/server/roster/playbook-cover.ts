// What a Playbook says about the teams its member covers besides its own (shared/roster/coverage.ts):
// a line per covered team, and how to label a covered team's pull requests. Short on purpose: the
// deliverables section lists the covered teams' files, and every line here costs tokens on each turn.
// A member covering only its own team (every Enterprise one) gets none of it.

import { teamLabel } from '../../shared/roster/card-team.js';
import { coveredBy, type Coverage } from '../../shared/roster/coverage.js';
import { ROLE_BY_ID, type RoleId, type TeamId } from '../../shared/roster/roles.js';

const COVER: Record<TeamId, string> = {
  management: "Management: the office hands you the standup page to summarise and commit, and relays the other members' escalations and the Project Manager's decisions. Note them in `docs/team/management.md`; never answer an escalation yourself.",
  analysis: 'Analysis: you own the BRD and the requirements (dispatch the business-analyst subagent).',
  design: 'Design: the design artifacts are yours (dispatch the ui-ux-designer subagent); every page follows the Atlas design system.',
  development: 'Development: you are the one writer of the app; developer subagents draft MDL, you apply it.',
  testing: 'Testing: the tester subagent writes the tests under `tests/`; you approve the test plan and the results, and test against the requirements rather than how it was built.',
};

/** The "## Teams you cover" section: one line per team it covers that isn't its own. */
export function coverLines(c: Coverage, role: RoleId): string[] {
  const own = ROLE_BY_ID.get(role)!.team;
  const teams = coveredBy(c, role).filter((t) => t !== own);
  if (!teams.length) return [];
  return ['', '## Teams you cover', 'This project has no Lead of its own for these teams: you cover them, with their subagents.', ...teams.map((t) => `- ${COVER[t]}`)];
}

/** The journal etiquette's line on labelling a covered team's pull requests. */
export function coverTeamLine(c: Coverage, role: RoleId): string {
  const own = ROLE_BY_ID.get(role)!.team;
  const others = coveredBy(c, role).filter((t) => t !== own);
  return `- Work for a team you cover goes under its label instead (${others.map((t) => `\`${teamLabel(t)}\``).join(', ')}), so it lands on that team's board.`;
}
