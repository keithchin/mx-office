// The "Discovery" issue the wizard can open for the Chief Analyst (the Consultant agent): the brief
// that sends an agent through the toolkit's Stages P to 4 with the client, stopping at every ✋ gate.
// It's the brief the first hand-run experiment used, with this project's answers filled in.

import { ENTRY_MODE_INFO, PROJECT_ROLES, type ProjectPlan } from '../../shared/wizard.js';
import { SHAPES, shapeForRoles } from '../../shared/roster/coverage.js';

export const DISCOVERY_TITLE = 'Discovery: kickoff with the client (Stages P → 4)';

const list = (xs: string[]) => (xs.length > 1 ? `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}` : (xs[0] ?? ''));

export function discoveryBrief(plan: ProjectPlan, toolkitDir: string, pinnedSha?: string): string {
  const mode = ENTRY_MODE_INFO[plan.entry];
  const client = plan.clients.length ? list(plan.clients) : 'the client';
  const operator = plan.operators.length ? list(plan.operators) : 'the operator';
  const roles = PROJECT_ROLES.filter((r) => plan.roles.includes(r.id)).map((r) => r.label);
  // Whoever covers Analysis on this team shape runs Discovery: the Chief Analyst, or the Solo Lead on a Solo team.
  const shape = plan.shape ?? shapeForRoles(plan.roles);
  const who = SHAPES[shape].coverage.analysis;
  const runner = who === 'chief-analyst' ? 'Chief Analyst (Consultant agent)' : (PROJECT_ROLES.find((r) => r.id === who)?.label.replace(/ \(.*\)$/, '') ?? 'Lead') + ', running discovery as the analyst';
  const goal = plan.intake.find((a) => a.n === 2)?.text.trim() || plan.description || 'see intake.md';
  return [
    `**Discovery for ${plan.name}.** You are the **${runner}**.`,
    '',
    '## Your role',
    'Run the discovery for this Mendix app with the client, using the **mxcli-project-toolkit** that is set up in this repo',
    '(read `CLAUDE.local.md` first and follow its session-start ritual; the toolkit runbook is',
    `\`skills/conversion-runbook.md\` in the toolkit clone at \`${toolkitDir}\`).`,
    ...(pinnedSha ? [`The toolkit is pinned for this project at \`${pinnedSha.slice(0, 7)}\`: never \`git pull\`, fetch or check out in that folder (the office's Update toolkit moves it).`] : []),
    '',
    `- **The client is ${client}**, answering through ${operator} in this terminal. Treat them as the business owner.`,
    `- **What the project is:** ${goal}`,
    `- **Entry mode:** ${mode.label.toLowerCase()}, **${plan.tier} tier**${plan.tier === 'small' ? ' (one module)' : ''}. Both are already recorded in \`PROJECT.md\` by the new-project wizard; correct them there (with the client's confirmation) if discovery shows otherwise.`,
    `- **Mendix version:** ${plan.mendix}. **Interview mode:** ${plan.interview}.`,
    roles.length ? `- **The project team** (hired on this floor by the wizard; see the Team tab): ${roles.join(', ')}.` : '',
    '- `intake.md` already carries the answers given in the wizard. Ask the questions still marked `_Not yet asked._`, and confirm the rest briefly rather than asking them again.',
    '- Run **Stages P → 4**: intake, triage/scope, requirements, architecture & design, and the **build plan** (`architecture/build-plan.md`).',
    "- Ask the customer checkpoints (CAC-1 … CAC-5) in the toolkit's **2+1 format** (two predefined questions with options and a recommendation, plus one open question), **one checkpoint at a time**, and wait for the answer.",
    "- **Stop at every ✋ gate (0, 3, 4)** and ask the client to confirm; record `CONFIRMED <date>` rows in `PROJECT.md ## Decisions` only after they say so. Never record a decision they didn't make (use the toolkit's ASSUMED rules only if they delegate).",
    '- **Do not start Stage 5 (build).** When Stage 4 is CONFIRMED, run `bin/build-plan-status.sh --json` so `architecture/build-plan.json` exists, commit everything, and stop.',
    '',
    '## Practical',
    '- Windows + Git Bash. Use `mxcli` on PATH (not `./mxcli`). Machine paths are in `.claude/toolkit.env` (git-ignored).',
    '- Commit your work at the end of each stage with a clear message (the pre-commit hook finishes in seconds).',
    '- Keep the conversation business-friendly: the client is not a developer.',
  ]
    .filter((l, i, all) => l !== '' || all[i - 1] !== '')
    .join('\n');
}

/** The one-line task the queue hands the agent: long pasted prompts get mangled in a Windows terminal. */
export const discoveryPrompt = (issue: number) => `Work on GitHub issue #${issue} in this repo: read it with \`gh issue view ${issue}\` and follow it exactly.`;
