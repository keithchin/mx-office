// The project team every floor can have: a Project Manager and four Leads, each a visible worker at
// a desk with a fixed name, and each Lead's own team as Claude Code subagents inside its session (see
// docs/teams.md). The roles, their teams and the subagents are data here, so the office, the Playbook
// templates and the Team tab all read the same table. Pure: the browser imports it too.

export type RoleId = 'pm' | 'lead-designer' | 'lead-developer' | 'lead-tester' | 'chief-analyst';
export type TeamId = 'management' | 'design' | 'development' | 'testing' | 'analysis';

/** A Lead's team member: a Claude Code subagent file (`.claude/agents/<id>.md`) in the project. */
export interface SubagentDef {
  id: string;
  title: string;
  /** What it does, for the subagent's frontmatter `description`. */
  does: string;
  /** Claude Code tools it gets. Never Write/Edit unless its lane is a folder (the tester's tests/). */
  tools: string;
  model: 'haiku' | 'sonnet' | 'opus';
}

export interface RoleDef {
  id: RoleId;
  title: string;
  team: TeamId;
  icon: string;
  mission: string;
  /** What this role may do on its own, whatever the autonomy level allows on top. */
  rights: string[];
  subagents: SubagentDef[];
  /** The model a fresh hire of it runs on, until the CTO picks another. */
  model: string;
}

export const ROLES: readonly RoleDef[] = [
  {
    id: 'pm',
    title: 'Project Manager',
    team: 'management',
    icon: '🧭',
    mission: 'Run the project: keep the plan, coordinate the Leads, run the daily standup, and make sure the CTO always knows what needs a decision.',
    rights: ['Keep the plan and the board tidy (issues, labels, milestones)', 'Ask Leads for status through their team journals', 'Compile the standup page and relay the CTO\'s decisions'],
    subagents: [],
    model: 'sonnet',
  },
  {
    id: 'lead-designer',
    title: 'Lead Designer',
    team: 'design',
    icon: '🎨',
    mission: 'Own the look and the flow of every page: review and approve design changes against the Atlas design system and the wireframes.',
    rights: ['Approve design changes inside the agreed design system', 'Produce design artifacts (design system notes, wireframes, page layouts, branding)'],
    subagents: [{ id: 'ui-ux-designer', title: 'UI/UX Designer', does: 'Atlas design system, wireframes, page layouts and branding: the toolkit\'s Stage 3 design artifacts. Writes design files via Bash only; never touches the .mpr.', tools: 'Read, Grep, Glob, Bash', model: 'sonnet' }],
    model: 'sonnet',
  },
  {
    id: 'lead-developer',
    title: 'Lead Developer',
    team: 'development',
    icon: '🛠️',
    mission: 'Do all of the programming. You are the one writer of the Mendix app: only you run `mxcli exec` against the .mpr.',
    rights: ['Apply MDL to the app (the only role that may run `mxcli exec`)', 'Open pull requests for the work'],
    subagents: [{ id: 'developer', title: 'Developer', does: 'Drafts MDL scripts and validates them with `mxcli check`. Never runs `mxcli exec` and never writes the .mpr: the Lead Developer applies what it drafts.', tools: 'Read, Grep, Glob, Bash', model: 'sonnet' }],
    model: 'sonnet',
  },
  {
    id: 'lead-tester',
    title: 'Lead Tester',
    team: 'testing',
    icon: '🧪',
    mission: 'Make sure every app this project produces has minimal bugs and the highest quality: approve testing, and keep improving the testing framework.',
    rights: ['Approve test plans and test results', 'Change the test framework (tests/, tests/e2e, the qa-tests playbook, the PR pipeline)'],
    subagents: [{ id: 'tester', title: 'Tester', does: 'Writes and runs unit tests (tests/*.test.mdl), Playwright e2e tests (tests/e2e) and follows the repo\'s .ai-context/skills/qa-tests playbook. May write under tests/ only; never edits MDL or runs `mxcli exec`.', tools: 'Read, Grep, Glob, Bash, Write, Edit', model: 'sonnet' }],
    model: 'sonnet',
  },
  {
    id: 'chief-analyst',
    title: 'Chief Analyst',
    team: 'analysis',
    icon: '📈',
    mission: 'High-quality business requirements and strong business acumen: own the BRD, analyse how each app\'s development cycle performs (the office\'s analyzer data), and research ways to help the project\'s business.',
    rights: ['Own the BRD and the requirements', 'Write the weekly insight memo (docs/insights/YYYY-Www.md)'],
    subagents: [
      { id: 'business-analyst', title: 'Business Analyst', does: 'Discovery and requirements: interviews, the BRD, module briefs (the toolkit\'s ba-agent lane). Writes via Bash only; never touches the .mpr.', tools: 'Read, Grep, Glob, Bash', model: 'sonnet' },
      { id: 'data-analyst', title: 'Data Analyst', does: 'Reads the office\'s analysis data and the repo history (PRs, CI, run costs) and turns them into numbers and charts for the insight memo. Read-only apart from its notes.', tools: 'Read, Grep, Glob, Bash', model: 'haiku' },
    ],
    model: 'sonnet',
  },
];

export const ROLE_BY_ID: ReadonlyMap<RoleId, RoleDef> = new Map(ROLES.map((r) => [r.id, r]));
export const isRoleId = (v: unknown): v is RoleId => typeof v === 'string' && ROLE_BY_ID.has(v as RoleId);

/** The Leads: everyone but the PM, who runs the standup instead of reporting to it. */
export const LEADS: readonly RoleDef[] = ROLES.filter((r) => r.id !== 'pm');

/** Where a team keeps its journal in the repo: dated entries, newest at the bottom. */
export const journalPath = (team: TeamId) => `docs/team/${team}.md`;
/** A role's Playbook in the repo, and its mirror where Claude Code finds skills. */
export const playbookPath = (role: RoleId) => `.ai-context/skills/team-${role}/SKILL.md`;
export const playbookMirror = (role: RoleId) => `.claude/skills/team-${role}/SKILL.md`;
export const standupPath = (date: string) => `docs/standups/${date}.md`;

/**
 * Display names for the roles, picked at random until the CTO renames them. People's names rather
 * than the workers' pool (Pixel, Byte…), so a Lead is told apart from a worker at a glance.
 */
export const NAME_POOL = [
  'Ada', 'Grace', 'Linus', 'Margaret', 'Alan', 'Hedy', 'Katherine', 'Dennis', 'Barbara', 'Ken',
  'Frances', 'Edsger', 'Radia', 'Anita', 'Donald', 'Sophie', 'Guido', 'Annie', 'Niklaus', 'Jean',
  'Leslie', 'Joan', 'Claude', 'Evelyn', 'Tim', 'Mary', 'John', 'Lynn', 'Fran', 'Carl',
];

/** A name for every role, all different; `rng` is Math.random unless a test fixes it. */
export function pickNames(rng: () => number = Math.random, taken: Iterable<string> = []): Record<RoleId, string> {
  const left = NAME_POOL.filter((n) => !new Set(taken).has(n));
  const out = {} as Record<RoleId, string>;
  for (const r of ROLES) {
    const i = Math.floor(rng() * left.length) % Math.max(1, left.length);
    out[r.id] = left.splice(i, 1)[0] ?? `${r.title}`;
  }
  return out;
}

/** A name the CTO typed: trimmed, one line, short, and not empty. Undefined when it won't do. */
export function cleanName(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  const s = v.replace(/[\r\n\t]+/g, ' ').replace(/[<>`]/g, '').trim().slice(0, 24);
  return s || undefined;
}
