// The new-project wizard: what the browser and the office say to each other about starting a project
// with the mxcli project toolkit, and the checks both sides make on what was typed. Pure code with no
// Node imports, so the wizard page and the server agree on what a valid project name is.

/** How a project enters the toolkit's pipeline (the runbook's "Entry Modes"), plus the no-pipeline assurance shelf. */
export const ENTRY_MODES = ['greenfield', 'requirements-driven', 'existing-app-change', 'migration', 'assurance'] as const;
export type EntryMode = (typeof ENTRY_MODES)[number];

export interface EntryModeInfo {
  label: string;
  icon: string;
  /** What you're starting from, in a sentence anyone can follow. */
  from: string;
  /** What the toolkit does differently in this mode. */
  what: string;
  /** Which stages run. */
  stages: string;
  /**
   * What goes into intake Q1 and the register's flat `Entry mode:` line: the spelling gate-check's
   * entry-mode tokeniser reads. Assurance has none: it isn't a pipeline mode, so it gets no line
   * rather than one the tokeniser would call "not recognised".
   */
  token?: string;
}

/** The modes in the toolkit runbook's own words, shortened for a form. */
export const ENTRY_MODE_INFO: Record<EntryMode, EntryModeInfo> = {
  greenfield: {
    label: 'Greenfield',
    icon: '🌱',
    from: 'Just an idea, or a conversation: no old system and no written requirements yet.',
    what: 'Stage 0 still runs the scope conversation; the analysis stages collapse to whatever plan you already have. If requirements turn up mid-build, the project is really requirements-driven.',
    stages: 'P (light), 0 (scope only), 5–6',
    token: 'greenfield',
  },
  'requirements-driven': {
    label: 'Requirements-driven',
    icon: '📄',
    from: 'Specs, BRDs, workshop notes or wireframes, but no legacy code.',
    what: 'The documents become the knowledge base, then validated BRDs, an architecture and an ordered build plan before anything is built.',
    stages: 'P, 0–6 (7 only if there is legacy data to move)',
    token: 'requirements-driven',
  },
  'existing-app-change': {
    label: 'Change an existing app',
    icon: '🛠️',
    from: 'A live Mendix app you are adding to or altering, not rebuilding.',
    what: 'The knowledge base comes from the model itself (mxcli), a regression net goes under the app first, and stages 2–4 cover only the change and what it touches.',
    stages: 'P, 0–6 per change (no cutover: the app is live)',
    token: 'Change an existing app',
  },
  migration: {
    label: 'Migration',
    icon: '🚚',
    from: 'An old system whose source code encodes behaviour you want to keep.',
    what: 'The code extractors analyse the legacy source, then every stage runs, ending with a cutover.',
    stages: 'P, 0–7 (all)',
    token: 'migration',
  },
  assurance: {
    label: 'Assurance only',
    icon: '🔎',
    from: 'An existing Mendix app that needs an audit, a lint pass or a regression test net, and nobody is changing it.',
    what: 'No pipeline, no gates: the toolkit is used as a tool shelf (existing-app-assurance.md). The repo still gets the agents and scripts.',
    stages: 'none (à la carte)',
  },
};

export type SizeTier = 'small' | 'standard';
/** The runbook's small-project line: at or under this, the small tier applies. */
export const SMALL_TIER_LIMITS = '1 module, 8 screens, 25 use cases';

/** The roles a project can be staffed with. The team model picks the selection up from the project's settings file. */
export const PROJECT_ROLES = [
  { id: 'pm', label: 'Project Manager', icon: '📋' },
  { id: 'lead-designer', label: 'Lead Designer', icon: '🎨' },
  { id: 'lead-developer', label: 'Lead Developer', icon: '🧑‍💻' },
  { id: 'lead-tester', label: 'Lead Tester', icon: '🧪' },
  { id: 'chief-analyst', label: 'Chief Analyst / Consultant', icon: '🧭' },
] as const;
export type ProjectRole = (typeof PROJECT_ROLES)[number]['id'];

/** One of the toolkit's intake questions, as its template words it. */
export interface IntakeQuestion {
  n: number;
  title: string;
  /** The guidance under the heading, without the "_Not yet asked._" placeholder. */
  help: string;
}

/**
 * How an answer goes into intake.md. All three pass gate-check's Stage P: `answered` is the user's
 * own answer, `assumed` a default the user handed back ("you decide"), `unverified` a question that
 * was asked whose answer isn't known yet, with how it will be found out.
 */
export type AnswerKind = 'answered' | 'assumed' | 'unverified';
export interface IntakeAnswer {
  n: number;
  kind: AnswerKind;
  text: string;
}

/** Everything the wizard collected: what the office needs to set the project up. */
export interface ProjectPlan {
  /** A brand-new repository, or the toolkit's existing-app path on a repository that's already there. */
  kind: 'new' | 'change';
  owner: string;
  name: string;
  description: string;
  private: boolean;
  /** Studio Pro version on the office's machine, like 11.6.4. */
  mendix: string;
  entry: EntryMode;
  tier: SizeTier;
  interview: 'attended' | 'unattended';
  execApproval: 'auto' | 'ask';
  intake: IntakeAnswer[];
  clients: string[];
  operators: string[];
  roles: ProjectRole[];
  /** Open a "Discovery" issue for the Chief Analyst, and maybe queue it. */
  discovery: { issue: boolean; queue: boolean; model: string };
  /** Nobody configured the admin token: the operator made the repository on GitHub by hand. */
  createdByHand: boolean;
}

/** The setup, a step at a time. Each step checks what's already done first, so running it again is safe. */
export const SETUP_STEPS = [
  { id: 'repo', label: 'Create the GitHub repository' },
  { id: 'clone', label: 'Clone it as a floor' },
  { id: 'env', label: 'Write .claude/toolkit.env' },
  { id: 'init', label: 'Run the toolkit’s init-project.sh' },
  { id: 'hooks', label: 'Install the pre-commit hook' },
  { id: 'intake', label: 'Write the intake answers' },
  { id: 'decisions', label: 'Record decisions in PROJECT.md' },
  { id: 'settings', label: 'Save client and team settings' },
  { id: 'gates', label: 'Refresh the gate dashboard' },
  { id: 'commit', label: 'Commit and push' },
  { id: 'issue', label: 'Open the Discovery issue' },
  { id: 'queue', label: 'Queue the Chief Analyst' },
] as const;
export type StepId = (typeof SETUP_STEPS)[number]['id'];
export type StepStatus = 'pending' | 'running' | 'done' | 'skipped' | 'failed';

export interface StepView {
  id: StepId;
  label: string;
  status: StepStatus;
  /** What it found or did, or why it failed, in a line. */
  detail?: string;
}

export interface JobView {
  id: string;
  plan: ProjectPlan;
  steps: StepView[];
  /** The end of the setup's log: what each command said. */
  log: string[];
  status: 'running' | 'done' | 'failed' | 'idle';
  /** The floor, once it's there. */
  floor?: string;
  issue?: number;
  by: string;
  startedAt: number;
  updatedAt: number;
}

/** What the wizard needs to know about the office before it opens. */
export interface WizardInfo {
  /** Only admins (operators) can make projects. */
  admin: boolean;
  org: string;
  /** Where the admin token is read from, for the instructions; never its contents. */
  adminToken: { configured: boolean; file: string };
  /** Repositories are made as local bare repos instead of on GitHub (a test office). */
  offline: boolean;
  mendixVersions: string[];
  defaultMendix: string;
  questions: IntakeQuestion[];
  /** What's missing on the office's machine for the toolkit to run, in words. */
  problems: string[];
  toolkitDir: string;
  /** Unfinished setups, to carry on with. */
  jobs: { id: string; repo: string; status: JobView['status'] }[];
}

/** Where a toolkit project stands, for the setup panel above its board. */
export interface SetupView {
  /** Not a toolkit project, or past Stage 4: no panel. */
  show: boolean;
  entry?: string;
  tier?: string;
  stages: { id: string; title: string; status: string; detail?: string }[];
  next?: string;
  questions: string[];
  /** The wizard's setup for this floor, to edit its answers. */
  job?: string;
  checking: boolean;
  checkedAt?: number;
  /** Whoever's looking is an admin: only admins re-check the gates or save edited answers. */
  admin?: boolean;
}

const SLUG = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;

/** Why `name` can't be the new repository's name, or undefined when it can: lower case, digits and single hyphens. */
export function slugProblem(name: string): string | undefined {
  if (!name) return 'Give the project a name';
  if (name.length < 2) return 'At least two characters';
  if (name.length > 64) return 'At most 64 characters';
  if (/[A-Z]/.test(name)) return 'Lower case only';
  if (/\s/.test(name)) return 'No spaces: use hyphens, like travel-approval';
  if (!SLUG.test(name)) return 'Letters, digits and hyphens, starting and ending with a letter or digit';
  if (name.includes('--')) return 'No double hyphens';
  if (/\.git$/.test(name)) return 'It can’t end in .git';
  return undefined;
}

/** A project name typed any old way, as a slug suggestion: "Travel Approval!" → "travel-approval". */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
    .replace(/-+$/, '');
}

/** Why `owner` can't be a GitHub account or organization name. */
export function ownerProblem(owner: string): string | undefined {
  return /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/.test(owner) && !owner.includes('--') ? undefined : 'Not a GitHub organization or user name';
}
