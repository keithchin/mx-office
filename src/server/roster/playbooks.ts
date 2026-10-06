// The Playbooks the office writes into a project for its team: one per role
// (.ai-context/skills/team-<role>/SKILL.md, mirrored to .claude/skills/ where Claude Code finds it),
// a subagent file per team member (.claude/agents/<id>.md, adapted from the mxcli-project-toolkit's
// agent stubs), the team journals and a lessons Playbook. Written into the folder the Lead works in
// when it's hired, so they land in the repo with its first pull request. The autonomy level is baked
// into every Playbook (with the Lead review protocol and its escalation thresholds), and they're
// written again when it changes. The human is always "the Project Manager"; the coordinating agent
// (role id `pm`) is "the Project Coordinator".

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { autonomyBrief, HUMAN_FULL, reviewBrief, type AutonomyLevel } from '../../shared/roster/autonomy.js';
import { teamLabel } from '../../shared/roster/card-team.js';
import { ASK_THE_PM } from './prompts.js';
import { journalPath, playbookMirror, playbookPath, ROLE_BY_ID, ROLES, standupPath, type RoleDef, type RoleId, type SubagentDef, type TeamId } from '../../shared/roster/roles.js';
import { craftOn, skillsBrief, type SkillOverrides } from '../../shared/roster/skills.js';
import type { SubagentRecord } from '../../shared/roster/subagents.js';
import { applyStanding } from './subagent-files.js';
import { toolkitDir as officeToolkitDir } from '../connections/store.js';

/** The lessons Playbook mx-spike-style projects already have; others get LESSONS_FALLBACK. */
export const FIELD_LESSONS = '.ai-context/skills/mxcli-field-lessons/SKILL.md';
export const LESSONS_FALLBACK = '.ai-context/skills/project-lessons/SKILL.md';

/** The lessons file for the project in `dir`: the mxcli field lessons when it has them. */
export const lessonsPathIn = (dir: string) => (existsSync(path.join(dir, FIELD_LESSONS)) ? FIELD_LESSONS : LESSONS_FALLBACK);

export interface PlaybookContext {
  project: string;
  name: string;
  level: AutonomyLevel;
  lessons: string;
  /** Every role's name, so a Playbook can say who's who. */
  names: Record<RoleId, string>;
  /** The member's skill overrides (shared/roster/skills.ts), and its subagents' standing. */
  skills?: SkillOverrides;
  subagents?: SubagentRecord[];
}

/** Where the mxcli-project-toolkit clone is (the same setting the new-project wizard uses). */
const toolkitDir = () => officeToolkitDir().replace(/\\/g, '/');

/**
 * The toolkit skills and role files this role works from, pointed at in the toolkit clone rather than copied,
 * so the team reads the toolkit's current version (see RoleDef.toolkitSkills).
 */
function toolkitSection(role: RoleDef, overrides?: SkillOverrides): string[] {
  const skills = craftOn(role.id, overrides);
  if (!skills.length && !role.toolkitAgents.length) return [];
  const dir = toolkitDir();
  return [
    '## Your toolkit skills (mxcli-project-toolkit)',
    `Before a piece of work, read the skills below that apply to it, from the toolkit clone at \`${dir}\`. They are the team's hard-won practice: where one disagrees with this Playbook on how to do something, follow the skill; on who decides, follow this Playbook.`,
    ...skills.map((s) => `- \`${dir}/skills/${s}.md\``),
    ...(role.toolkitAgents.length ? ['', 'Your lane and your subagents build on the toolkit role files:', ...role.toolkitAgents.map((a) => `- \`${dir}/agents/${a}.md\``)] : []),
    '',
  ];
}

const ONE_WRITER = 'One writer per Mendix app: only the Lead Developer runs `mxcli exec` (or any MCP write) against the .mpr. Everyone else — every other Lead and every subagent — drafts, checks (`mxcli check`, `mxcli -c "SHOW …"`) and reviews, and hands the change to the Lead Developer to apply.';

function roleSpecific(role: RoleDef, ctx: PlaybookContext): string[] {
  switch (role.id) {
    case 'pm':
      return [
        '## Coordinating the team',
        `- You are the Project Coordinator, an agent. The Project Manager is the human who owns the project: you relay to them and summarise for them, you never decide for them.`,
        `- Read every team journal (\`docs/team/*.md\`) at the start of a session and before a standup; summarise, don't relay chatter.`,
        `- The office runs the standup: it asks each active Lead, reads the journals of the benched ones, and drafts \`${standupPath('YYYY-MM-DD')}\`. When it hands you the draft, add a short **Summary** at the top (≤ 5 lines: progress, risks, what needs the Project Manager, open escalations), then commit and push it.`,
        '- When the office tells you about new escalations, note them in `docs/team/management.md` and put them in the next standup summary; never answer one yourself: the Project Manager answers on the project console and the office sends the answer to whoever raised it.',
        '- Escalate yourself (`office-workers escalate`) only what affects the whole project: a cross-team conflict, a slipping milestone, the budget — and any question of your own for the Project Manager (never ask it in your chat).',
        '- When the office tells you the Project Manager\'s decisions on proposals, note them in `docs/team/management.md` and tell the Lead concerned through its journal (or `office-workers tell` if it is hired and the decision is urgent).',
        '- Hiring: Leads are hired from the office\'s Team tab with their fixed names. Do not hire extra workers for a Lead\'s job; a Lead may hire one only for real parallel work (e.g. two test suites).',
      ];
    case 'lead-designer':
      return ['## Design', '- Every page follows the Atlas design system and the agreed wireframes. Review design changes and record approvals (or what must change) in `docs/team/design.md`.', '- Hand page specs to the Lead Developer; never build pages yourself.'];
    case 'lead-developer':
      return ['## Development', '- Developers (subagents) draft MDL and run `mxcli check`; you review and apply it with `mxcli exec`, one script at a time, then run the project\'s gates.', '- Open a pull request for each coherent change; merging follows the autonomy level below.'];
    case 'lead-tester':
      return ['## Testing', '- Unit tests live in `tests/*.test.mdl`, Playwright e2e in `tests/e2e`; follow `.ai-context/skills/qa-tests` and the PR pipeline when the repo has them.', '- Approve test plans and results; when the framework is the bottleneck, improve it (and say so in the journal).', '- A failing test that shows the model is wrong is a finding for the Lead Developer, never a fix you make in MDL.'];
    case 'chief-analyst':
      return [
        '## Analysis',
        '- Own the BRD (toolkit discovery: `brd-generation.md`, `brd-validation.md`) and keep requirements traceable.',
        '- Analyse each app\'s development cycle from the office\'s analyzer data (it is handed to you at standups: runs, scores, costs per model) and the repo history.',
        '- Write a **weekly insight memo** to `docs/insights/YYYY-Www.md`: what the numbers say, what to change, and one R&D idea for the project\'s business. Proposals from it go in your journal.',
      ];
  }
}

/** A role's Playbook, the SKILL.md its session starts from. */
export function playbook(roleId: RoleId, ctx: PlaybookContext): string {
  const role = ROLE_BY_ID.get(roleId)!;
  const team = role.subagents.length
    ? role.subagents.map((s) => `- **${s.title}** — the \`${s.id}\` subagent (\`.claude/agents/${s.id}.md\`): ${s.does}`).join('\n')
    : '- No subagents: you coordinate the Leads.';
  const who = ROLES.map((r) => `${r.title}: ${ctx.names[r.id]}`).join(' · ');
  return [
    '---',
    `name: team-${role.id}`,
    `description: "The ${role.title}'s Playbook for ${ctx.project}: mission, rights, what needs the Project Manager at the current autonomy level, the review protocol, journal etiquette and the one-writer rule. Read at the start of every session as ${ctx.name}."`,
    '---',
    '',
    `# ${role.icon} ${role.title} — ${ctx.name}`,
    '',
    `<!-- Written by Agent Office from its team templates. Re-written when the Project Manager changes the autonomy level; edit the office's templates, not this copy. -->`,
    '',
    `**Mission.** ${role.mission}`,
    '',
    `**The team.** ${who}. You all work for ${HUMAN_FULL}; the Project Coordinator is an agent that coordinates the Leads and relays escalations to them.`,
    '',
    '## Your rights',
    ...role.rights.map((r) => `- ${r}`),
    '',
    '## What needs the Project Manager',
    autonomyBrief(ctx.level),
    '',
    ASK_THE_PM,
    '',
    ...skillsBrief(roleId, ctx.level, ctx.skills),
    '## Your team (Claude Code subagents in your session)',
    team,
    ...standingLines(ctx.subagents),
    'Dispatch them with the Agent tool for drafting, checking and research; keep every decision, every question to the Project Manager and every write to the app in your own session. A subagent returns the file it wrote, not a summary of it.',
    '',
    ...(role.subagents.length ? ['## The review protocol (after every subagent result)', reviewBrief(ctx.level, journalPath(role.team)), ''] : []),
    ...toolkitSection(role, ctx.skills),
    '## The one-writer rule',
    ONE_WRITER,
    'Git worktrees go only under the project’s `.agent-office/worktrees/` (`git worktree add .agent-office/worktrees/<name> -b <branch>` from the project root), never in a temp folder or next to the project: the office refuses any other place and cleans these up once merged.',
    '',
    '## Journal etiquette',
    `- Your team's journal is \`${journalPath(role.team)}\`. Append dated entries at the bottom, headed \`## YYYY-MM-DD HH:MM — <what>\` (e.g. \`— Standup\`, \`— Handoff\`, \`— Decision\`). Never rewrite old entries.`,
    '- Keep entries short and factual: decisions and why, what changed, what is blocked, links to PRs/issues. No chatter: the other Leads read it instead of messaging you.',
    '- Anything that needs the Project Manager goes under `### Proposals` as `- [kind] Title — why`, kind one of task, scope, design, architecture, peer-review, merge, milestone, client-milestone, budget. A question or sign-off you are waiting on is an escalation, not a proposal.',
    '- Commit journal updates with your work, so the team sees them once your branch lands.',
    `- Open pull requests with your team's label: \`gh pr create --label ${teamLabel(role.team)} …\`, so the PR lands on your team's board.`,
    '',
    '## Lessons',
    `Durable lessons (a gotcha, a working recipe, a mistake not to repeat) go in \`${ctx.lessons}\` — append, one dated bullet each. If \`mxcli brain capture\` is available, capture them there too.`,
    '',
    ...roleSpecific(role, ctx),
    '',
  ].join('\n');
}

/** What the Playbook says of subagents on warning or benched. */
function standingLines(subs: SubagentRecord[] = []): string[] {
  const out: string[] = [];
  for (const s of subs) {
    const until = s.benchedUntil ? ` until ${new Date(s.benchedUntil).toISOString().slice(0, 16).replace('T', ' ')} UTC` : '';
    if (s.state === 'benched') out.push(`- 🪑 **${s.name} is benched**${until}${s.benchReason ? ` (${s.benchReason})` : ''}: don't dispatch ${s.name}; do the work yourself or use another subagent.`);
    else if (s.state === 'warning') out.push(`- ⚠️ **${s.name} is on warning**: its definition ends with what went wrong; review its next results closely.`);
  }
  return out.length ? ['', ...out] : [];
}

/** A team member's subagent file, after the toolkit's stub shape (agent-roles.md): scoped tools, the one-writer line. */
export function subagentFile(sub: SubagentDef, lead: RoleDef, project: string): string {
  return [
    '---',
    `name: ${sub.id}`,
    `description: "${sub.title} on the ${lead.title}'s team for ${project}. ${sub.does.replace(/"/g, "'")}"`,
    `model: ${sub.model}`,
    `tools: ${sub.tools}`,
    '---',
    '',
    `You are a ${sub.title} working for the ${lead.title} on ${project}. ${sub.does}`,
    '',
    `- Read the project's CLAUDE.md, the ${lead.title}'s Playbook (\`${playbookPath(lead.id)}\`) and the team journal (\`${journalPath(lead.team)}\`) before you start.`,
    '- You never run `mxcli exec` and never write the `.mpr`: only the Lead Developer applies changes to the app.',
    `- Never ask the Project Manager (the human) anything yourself, and never escalate: report open questions, blockers and anything that changes scope or design to the ${lead.title} who dispatched you. The ${lead.title} reviews every result you return and decides whether to accept it, send it back or escalate it.`,
    '- End every result with: **Done** (what you did, against the acceptance criteria), **Checks** (what you ran and what it said), **Open** (questions, assumptions, anything blocked), **Next** (the step you would take next).',
    '- Return the file(s) you wrote and anything you had to assume, not a summary of them.',
    '',
  ].join('\n');
}

const journalSeed = (team: TeamId) => `# ${team[0].toUpperCase()}${team.slice(1)} team journal\n\nDated entries, newest at the bottom: \`## YYYY-MM-DD HH:MM — <what>\`. See the team Playbooks in \`.ai-context/skills/team-*/\`.\n`;
const lessonsSeed = (project: string) => `---\nname: project-lessons\ndescription: "Durable lessons learned on ${project}: gotchas, working recipes and mistakes not to repeat. Read before starting work; append one dated bullet per lesson."\n---\n\n# Project lessons\n\n`;

/**
 * Writes a role's Playbook (and its mirror), its team's subagent files, its team journal and the
 * lessons Playbook (the last two only when missing) into `dir`. Returns the paths it wrote.
 */
export function writeRoleFiles(dir: string, roleId: RoleId, ctx: PlaybookContext): string[] {
  const role = ROLE_BY_ID.get(roleId)!;
  const wrote: string[] = [];
  const put = (rel: string, text: string, keep = false) => {
    const file = path.join(dir, rel);
    if (keep && existsSync(file)) return;
    if (existsSync(file) && readFileSync(file, 'utf8') === text) return;
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, text);
    wrote.push(rel);
  };
  const text = playbook(roleId, ctx);
  put(playbookPath(roleId), text);
  put(playbookMirror(roleId), text);
  // Each subagent's definition with its standing: model swap, warnings, benched (subagent-files.ts).
  const standing = new Map((ctx.subagents ?? []).map((s) => [s.name, s]));
  for (const sub of role.subagents) {
    const rec = standing.get(sub.id) ?? { name: sub.id, lead: roleId, state: 'active' as const, warnings: [], runs: [] };
    wrote.push(...applyStanding(dir, rec, subagentFile(sub, role, ctx.project)));
  }
  for (const rec of standing.values()) if (!role.subagents.some((s) => s.id === rec.name)) wrote.push(...applyStanding(dir, rec));
  put(journalPath(role.team), journalSeed(role.team), true);
  put(ctx.lessons, lessonsSeed(ctx.project), true);
  return wrote;
}
