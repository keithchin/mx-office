// The project team every floor can have: a Project Coordinator (an agent; the role id stays `pm` so
// saved rosters and Playbook paths keep working) and four Leads, each a visible worker at
// a desk with a fixed name, and each Lead's own team as Claude Code subagents inside its session (see
// docs/teams.md). The roles, their teams and the subagents are data here, so the office, the Playbook
// templates and the Team tab all read the same table. Pure: the browser imports it too.

export type RoleId = 'pm' | 'lead-designer' | 'lead-developer' | 'lead-tester' | 'chief-analyst' | 'solo-lead';
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
  /** The model a fresh hire of it runs on, until the Project Manager picks another. */
  model: string;
  /**
   * The mxcli-project-toolkit skills (`skills/<name>.md`) this role works from, and the toolkit role files
   * (`agents/<name>.md`) its lane builds on. Its Playbook points at them in the toolkit clone rather than copying
   * them, so an update to the toolkit reaches every project's team.
   */
  toolkitSkills: string[];
  toolkitAgents: string[];
  /**
   * A generalist that covers every team on its own (the Solo shape, shared/roster/coverage.ts): its craft
   * skills are its own short list rather than the union of the roles it covers, to keep its Playbook small.
   */
  generalist?: boolean;
}

export const ROLES: readonly RoleDef[] = [
  {
    id: 'pm',
    title: 'Project Coordinator',
    team: 'management',
    icon: '🧭',
    mission: 'Coordinate the project for the Project Manager (the human who owns it): keep the plan, coordinate the Leads, run the daily standup, and relay and summarise every escalation so the Project Manager always knows what needs a decision.',
    rights: ['Keep the plan and the board tidy (issues, labels, milestones)', 'Ask Leads for status through their team journals', 'Compile the standup page, summarise open escalations and relay the Project Manager\'s decisions'],
    subagents: [],
    model: 'sonnet',
    toolkitSkills: ['conversion-runbook', 'agent-roles', 'iterative-build-loop', 'module-completion-loop', 'close-the-loop', 'improvement-register', 'coverage-ledger', 'measured-claims', 'field-run'],
    toolkitAgents: [],
  },
  {
    id: 'lead-designer',
    title: 'Lead Designer',
    team: 'design',
    icon: '🎨',
    mission: 'Own the look and the flow of every page: review and approve design changes against the Atlas design system and the wireframes.',
    rights: ['Approve design changes inside the agreed design system', 'Produce design artifacts (design system notes, wireframes, page layouts, branding)'],
    subagents: [{ id: 'ui-ux-designer', title: 'UI/UX Designer', does: 'Atlas design system, wireframes, page layouts and branding: the toolkit\'s Stage 3 design artifacts (design/brand.md, design/ds.css, design/design-system.html, design/wireframes/<screen>.html, design/storyboard.html). Writes design files via Bash only; never touches the .mpr.', tools: 'Read, Grep, Glob, Bash', model: 'sonnet' }],
    model: 'sonnet',
    toolkitSkills: ['design-artifacts', 'design-spacing', 'journey-map', 'ui-preflight-pages', 'ui-loop', 'ui-review-loop', 'oneshot-page-structure-patterns', 'learned-page-patterns', 'learned-css-that-never-applied', 'learned-stylegallery', 'mendix-agent-ui'],
    toolkitAgents: ['review-agent'],
  },
  {
    id: 'lead-developer',
    title: 'Lead Developer',
    team: 'development',
    icon: '🛠️',
    mission: 'Do all of the programming. You are the one writer of the Mendix app: only you run `mxcli exec` against the .mpr.',
    rights: ['Apply MDL to the app (the only role that may run `mxcli exec`)', 'Open pull requests for the work'],
    subagents: [{ id: 'developer', title: 'Developer', does: 'Drafts MDL scripts and validates them with `mxcli check`, and drafts architecture files for the Lead Developer (architecture/blueprint.md, domain-model.md, adr/, build-plan.md, modules/<M>/module-brief.md). Never runs `mxcli exec` and never writes the .mpr: the Lead Developer applies what it drafts.', tools: 'Read, Grep, Glob, Bash', model: 'sonnet' }],
    model: 'sonnet',
    toolkitSkills: ['architecture-blueprint', 'modularize-domain', 'brd-to-build-plan', 'module-brief', 'walking-skeleton', 'security-is-not-a-later-script', 'mdl-cookbook-microflows', 'microflow-preflight', 'learned-microflow-patterns', 'learned-mdl-preflight', 'learned-mdl-cannot-express', 'rest-integration-first-time-right', 'layering-review', 'mpr-corruption-and-sp-load-errors', 'mendix-agents', 'mendix-agent-setup'],
    toolkitAgents: ['architect-agent', 'mdl-agent'],
  },
  {
    id: 'lead-tester',
    title: 'Lead Tester',
    team: 'testing',
    icon: '🧪',
    mission: 'Make sure every app this project produces has minimal bugs and the highest quality: approve testing, and keep improving the testing framework.',
    rights: ['Approve test plans and test results', 'Change the test framework (tests/, tests/e2e, the qa-tests playbook, the PR pipeline)'],
    subagents: [{ id: 'tester', title: 'Tester', does: 'Writes and runs unit tests (tests/*.test.mdl), Playwright e2e tests (tests/e2e) and follows the repo\'s .ai-context/skills/qa-tests playbook. Writes tests/test-plan.md and tests/e2e/<journey>.journey.json. May write under tests/ only; never edits MDL or runs `mxcli exec`.', tools: 'Read, Grep, Glob, Bash, Write, Edit', model: 'sonnet' }],
    model: 'sonnet',
    toolkitSkills: ['testing-shape', 'e2e-harness-base', 'journey-proof', 'fixture-seeding', 'learned-db-assertions', 'monkey-test', 'qa-loop-goal-pattern', 'test-result-audit', 'tool-output-is-not-ground-truth', 'e2e-evidence-report', 'lint-that-actually-runs'],
    toolkitAgents: ['gate-agent', 'test-agent'],
  },
  {
    id: 'chief-analyst',
    title: 'Chief Analyst',
    team: 'analysis',
    icon: '📈',
    mission: 'High-quality business requirements and strong business acumen: own the BRD, analyse how each app\'s development cycle performs (the office\'s analyzer data), and research ways to help the project\'s business.',
    rights: ['Own the BRD and the requirements', 'Write the weekly insight memo (docs/insights/YYYY-Www.md)'],
    subagents: [
      { id: 'business-analyst', title: 'Business Analyst', does: 'Discovery and requirements: interviews, the BRD, module briefs (the toolkit\'s ba-agent lane): triage, the source ledger, the knowledge base, F{NNN}.brd.json and analysis/brd-report.html, then docs/requirements/ (BRD PDF, use-cases.xlsx, process-flow.md). Writes via Bash only; never touches the .mpr.', tools: 'Read, Grep, Glob, Bash', model: 'sonnet' },
      { id: 'data-analyst', title: 'Data Analyst', does: 'Reads the office\'s analysis data and the repo history (PRs, CI, run costs) and turns them into numbers and charts (py + matplotlib PNGs) for the insight memo. Read-only apart from its notes and charts.', tools: 'Read, Grep, Glob, Bash', model: 'haiku' },
    ],
    model: 'sonnet',
    toolkitSkills: ['interview-protocol', 'grill-mode', 'document-discovery', 'brd-generation', 'brd-validation', 'kb-generation', 'app-analysis', 'source-triage', 'small-project-tier', 'company-brain', 'mendix-agents'],
    toolkitAgents: ['ba-agent'],
  },
  {
    id: 'solo-lead',
    title: 'Solo Lead',
    // Its desk and journal are Development's: it is the one writer of the app.
    team: 'development',
    icon: '🧑‍🚀',
    mission: 'Run the whole project on your own for the Project Manager: requirements, design, the build, the tests and the status. Dispatch subagents for drafting and checking; you decide, and you are the one writer of the Mendix app.',
    rights: ["Own every team's deliverables: analysis, design, development, testing and management", 'Apply MDL to the app (the only one who runs `mxcli exec`)', 'Open pull requests, and write the daily standup note'],
    // Every Lead's subagents (filled in below), so it may use every subagent type.
    subagents: [],
    model: 'sonnet',
    toolkitSkills: ['small-project-tier', 'conversion-runbook', 'interview-protocol', 'brd-generation', 'design-artifacts', 'architecture-blueprint', 'brd-to-build-plan', 'walking-skeleton', 'mdl-cookbook-microflows', 'learned-mdl-preflight', 'testing-shape', 'journey-proof', 'close-the-loop'],
    toolkitAgents: [],
    generalist: true,
  },
];

// The Solo Lead's team: every other Lead's subagents, the same definitions.
for (const r of ROLES) if (r.generalist) r.subagents = ROLES.filter((x) => !x.generalist).flatMap((x) => x.subagents);

export const ROLE_BY_ID: ReadonlyMap<RoleId, RoleDef> = new Map(ROLES.map((r) => [r.id, r]));
export const isRoleId = (v: unknown): v is RoleId => typeof v === 'string' && ROLE_BY_ID.has(v as RoleId);

/** The Leads: everyone but the Project Coordinator, who runs the standup instead of reporting to it. */
export const LEADS: readonly RoleDef[] = ROLES.filter((r) => r.id !== 'pm');

/** Where a team keeps its journal in the repo: dated entries, newest at the bottom. */
export const journalPath = (team: TeamId) => `docs/team/${team}.md`;
/** A role's Playbook in the repo, and its mirror where Claude Code finds skills. */
export const playbookPath = (role: RoleId) => `.ai-context/skills/team-${role}/SKILL.md`;
export const playbookMirror = (role: RoleId) => `.claude/skills/team-${role}/SKILL.md`;
export const standupPath = (date: string) => `docs/standups/${date}.md`;

/**
 * Display names for the roles, picked at random until the Project Manager renames them. People's names rather
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

/** A name the Project Manager typed: trimmed, one line, short, and not empty. Undefined when it won't do. */
export function cleanName(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  const s = v.replace(/[\r\n\t]+/g, ' ').replace(/[<>`]/g, '').trim().slice(0, 24);
  return s || undefined;
}
