// 🚀 First-run setup (server/first-run/, the /setup page in client/first-run/): what a brand-new office
// walks its first admin through, a step at a time: the office password, the machine's prerequisites,
// GitHub, Mendix and the toolkit, then the first project. What each prerequisite is for, whether it's
// required and where to get it live here, so the page and the server's checks say the same thing.
// Pure, no Node imports: the page and the server both use it.

export const FIRST_RUN_STEPS = ['welcome', 'prereqs', 'github', 'mendix', 'toolkit', 'done'] as const;
export type FirstRunStep = (typeof FIRST_RUN_STEPS)[number];
export const isFirstRunStep = (v: unknown): v is FirstRunStep => FIRST_RUN_STEPS.includes(v as FirstRunStep);

export const STEP_LABEL: Record<FirstRunStep, string> = {
  welcome: 'Welcome',
  prereqs: 'Prerequisites',
  github: 'GitHub',
  mendix: 'Mendix',
  toolkit: 'Toolkit',
  done: 'Done',
};

/** The shortest office password the page lets through (the server's own rule is connections/password.ts PASSWORD_MIN). */
export const PASSWORD_MIN_CHARS = 8;

/** The page that runs it. */
export const SETUP_PAGE = '/setup';

/** What the office keeps of the setup in office-settings.json (never a secret). */
export interface SetupRecord {
  /** The step the admin was last on: a reload opens there. */
  step?: FirstRunStep;
  /** Finished (Done reached and confirmed): the office doesn't ask again on its own. */
  completedAt?: number;
  completedBy?: string;
  /** Settings → Run setup again: show it once more even though it was finished. */
  rerun?: boolean;
}

/** Why the office opens the setup by itself: what it's missing. Empty means it doesn't. */
export function firstRunReasons(o: { passwordGenerated: boolean; adminAccount: boolean; projectsDirExists: boolean; floors: number; setup: SetupRecord | undefined }): string[] {
  if (o.setup?.rerun) return ['Run setup again was picked in ⚙️ Settings'];
  if (o.setup?.completedAt) return [];
  // An office that already has projects is set up, whatever else it lacks: an upgrade never lands it here.
  if (o.floors > 0) return [];
  const why: string[] = [];
  if (o.passwordGenerated && !o.adminAccount) why.push('The office password hasn’t been set yet (it’s still the generated one)');
  if (!o.projectsDirExists) why.push('The folder new projects go in isn’t there yet');
  return why;
}

/** The step after `s` (Done stays Done). */
export const nextStep = (s: FirstRunStep): FirstRunStep => FIRST_RUN_STEPS[Math.min(FIRST_RUN_STEPS.indexOf(s) + 1, FIRST_RUN_STEPS.length - 1)];

// ---- Prerequisites --------------------------------------------------------------------------------

export const PREREQ_IDS = ['node', 'git', 'gitbash', 'gh', 'gh-auth', 'claude', 'claude-auth', 'studio', 'mxcli', 'jq', 'toolkit', 'postgres'] as const;
export type PrereqId = (typeof PREREQ_IDS)[number];

/** ok: there and working. missing: not there (or not working). warn: there, but something to look at. */
export type PrereqStatus = 'ok' | 'missing' | 'warn';

export interface PrereqResult {
  id: PrereqId;
  status: PrereqStatus;
  /** What was found: "git version 2.47.1", "Signed in to github.com as octocat". */
  text: string;
  /** What to do about it, when it isn't ok. */
  fix?: string;
  /** A path the check found or used (mxcli, the toolkit folder). */
  path?: string;
}

export interface PrereqMeta {
  label: string;
  /** What the office uses it for. */
  purpose: string;
  /** Without it the office (or a new project) can't work; the others are nice to have. */
  required: boolean;
  /** Where to get it. */
  link?: string;
  linkLabel?: string;
  /** Only checked on Windows (elsewhere it's part of the system). */
  windowsOnly?: boolean;
}

/** The Node.js the office needs: 22.5 or newer, for node:sqlite (the Model view reads .mpr files with it). */
export const NODE_MIN = [22, 5] as const;

/** Whether `version` ("22.11.0", "v24.1.0") is at least NODE_MIN. */
export function nodeVersionOk(version: string): boolean {
  const [major, minor] = version.replace(/^v/, '').split('.').map((n) => Number.parseInt(n, 10) || 0);
  return major > NODE_MIN[0] || (major === NODE_MIN[0] && minor >= NODE_MIN[1]);
}

export const PREREQ_META: Record<PrereqId, PrereqMeta> = {
  node: { label: `Node.js ${NODE_MIN.join('.')} or newer`, purpose: 'Runs the office itself (node:sqlite reads Mendix models).', required: true, link: 'https://nodejs.org/en/download', linkLabel: 'nodejs.org' },
  git: { label: 'Git', purpose: 'Clones projects, makes each agent its own worktree, commits and pushes.', required: true, link: 'https://git-scm.com/download/win', linkLabel: 'git-scm.com' },
  gitbash: { label: 'Git Bash', purpose: 'Runs the toolkit’s scripts (it comes with Git for Windows).', required: true, link: 'https://git-scm.com/download/win', linkLabel: 'git-scm.com', windowsOnly: true },
  gh: { label: 'GitHub CLI (gh)', purpose: 'Lists your repositories, opens issues and pull requests for the agents.', required: true, link: 'https://cli.github.com', linkLabel: 'cli.github.com' },
  'gh-auth': { label: 'gh signed in', purpose: 'gh needs a GitHub sign-in (or the agents’ token, next step) to reach your repositories.', required: true, link: 'https://cli.github.com/manual/gh_auth_login', linkLabel: 'gh auth login' },
  claude: { label: 'Claude Code (claude)', purpose: 'Every agent is a Claude Code session.', required: true, link: 'https://docs.claude.com/en/docs/claude-code/setup', linkLabel: 'Install Claude Code' },
  'claude-auth': { label: 'Claude Code signed in', purpose: 'Agents run on your Claude Code sign-in (or an API key).', required: true, link: 'https://docs.claude.com/en/docs/claude-code/setup', linkLabel: 'Sign in' },
  studio: { label: 'Mendix Studio Pro', purpose: 'Builds and checks the Mendix apps (mxbuild, mx); new projects start on one of these versions.', required: true, link: 'https://marketplace.mendix.com/link/studiopro/', linkLabel: 'Mendix Marketplace' },
  mxcli: { label: 'mxcli', purpose: 'How agents read and change Mendix models, and runs the Live app.', required: true, link: 'https://github.com/mendixlabs/mxcli/releases', linkLabel: 'mxcli releases' },
  jq: { label: 'jq', purpose: 'The toolkit’s scripts read JSON with it.', required: true, link: 'https://jqlang.org/download/', linkLabel: 'jqlang.org', windowsOnly: true },
  toolkit: { label: 'mxcli project toolkit', purpose: 'The scripts, gates and playbooks every Mendix project is set up with (step 5 picks or clones it).', required: true },
  postgres: { label: 'PostgreSQL (for the Live app)', purpose: 'The 🌐 Live app keeps each project’s running app’s data in it. Optional: everything else works without it.', required: false, link: 'https://www.postgresql.org/download/windows/', linkLabel: 'postgresql.org' },
};

/** Whether every required check passed (warnings don't hold anything up). */
export const prereqsReady = (rows: readonly PrereqResult[]): boolean => rows.every((r) => r.status !== 'missing' || !PREREQ_META[r.id].required);

// ---- The view ---------------------------------------------------------------------------------------

export type OrgSource = 'settings' | 'env' | 'default';

export interface FirstRunView {
  /** Whether the office opens the setup by itself, and why. */
  needed: boolean;
  why: string[];
  admin: boolean;
  step: FirstRunStep;
  completedAt?: number;
  completedBy?: string;
  /** Where the office password comes from: generated (not set yet), env (the launcher / --password), connections (set here). */
  password: { set: boolean; source: 'generated' | 'env' | 'connections' | 'accounts' };
  /** The GitHub organization (or user) new projects are created in. */
  org: { value: string; source: OrgSource };
  /** Studio Pro versions found, newest first, and the one new projects start on. */
  mendix: { versions: string[]; dir: string; preferred: string; saved?: string };
  toolkit: { dir: string; problem?: string; repoUrl: string; defaultCloneDir: string };
  projectsDir: string;
  /** The office's own folder (its home). */
  home: string;
}

/** GitHub's rule for an account or organization name. */
export const GITHUB_OWNER = /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/;

/** What the toolkit is cloned from when nobody says otherwise: its upstream. */
export const DEFAULT_TOOLKIT_REPO = 'https://github.com/MendixMau/mxcli-project-toolkit.git';

/** A clone URL the office will hand to git: https or ssh, nothing that starts like an option. */
export function cloneUrlProblem(url: string): string | undefined {
  const u = url.trim();
  if (!u) return 'Give the toolkit’s Git URL';
  if (/\s/.test(u) || u.startsWith('-')) return 'That isn’t a Git URL';
  if (/^https:\/\/[^/\s]+\/.+/.test(u) || /^git@[^:\s]+:.+/.test(u) || /^ssh:\/\/.+/.test(u)) return undefined;
  return 'Use an https:// (or git@…) Git URL';
}

/** One line of a toolkit clone's progress, as the office streams it (NDJSON). */
export type CloneEvent = { t: 'line'; text: string } | { t: 'done'; ok: true; dir: string } | { t: 'done'; ok: false; error: string };
