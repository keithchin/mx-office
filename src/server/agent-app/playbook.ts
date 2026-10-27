// The Playbook's runtime rule (P0-1 of the real rebuild test: four runtime defects passed every model gate and
// were found only when the Project Manager ran the app, while the agents wrote "not measured: I cannot start
// the app here"). Whoever builds pages or flows, or tests them, runs the app at its candidate through the
// office before saying done. roster/playbooks.ts adds it for the roles that write or check the model.

import type { RoleId } from '../../shared/roster/roles.js';

export const RUNTIME_HEADING = '## Run it before you say done';

export const RUNTIME_RULE = [
  RUNTIME_HEADING,
  '- After building or changing a page or flow, commit, then start the app at your candidate through the office: `office-app start --commit HEAD` (MCP `app_start`). It runs on its own ports and database and gives you its URL and test users.',
  "- Run the journeys that cover the change (`office-app journey J-12`, MCP `journey_run`: a .journey.json or the project's own .journey.js), or, when none does, a smoke click-through of the changed pages (`office-app smoke --page /p/...`). A runtime error in the app's log fails the run: fix it before you report.",
  '- A check you ran yourself (a measurement, your own script, screenshots): record it at the commit with `office-app check --name "..." --result passed|failed --shot <png>` (MCP `app_check`) so the receipt and the merge dialog show it. If the office can’t sign in or a check can’t run, say so in your report: the office raises it to the Project Manager too; never just go idle.',
  '- Report the result with its commit ("journeys J-12, J-13 passed at @abc1234"). "Not measured" is no longer acceptable when an instance can be started; if the office refuses one (memory, limit), say its reason.',
  '- Microflow tests: `office-app test --commit HEAD` (MCP `app_test`); the result is recorded at that commit. Never `mxcli run --local` or `mxcli test --local` in your worktree (they leave processes and databases behind and count for nothing), never a database superuser.',
  '- `office-app stop` when you are done (it also stops by itself after 15 minutes unused).',
  '',
];

/** The roles that build or check the model (and whoever covers Development for them). */
export const runtimeRole = (role: RoleId, also: readonly RoleId[] = []) => role === 'lead-developer' || role === 'solo-lead' || role === 'lead-tester' || also.includes('lead-developer') || also.includes('lead-tester');

export const runtimeLines = (role: RoleId, also: readonly RoleId[] = []): string[] => (runtimeRole(role, also) ? RUNTIME_RULE : []);
