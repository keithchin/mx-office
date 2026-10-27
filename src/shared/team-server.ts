// Mendix Team Server for a project (server/team-server/, wizard/team-server-step.ts): the words and pure rules
// both sides use. A project on Team Server has a Mendix Portal app (made by the Projects API, or one whose id the
// Project Manager pasted) and a `teamserver` remote at https://git.api.mendix.com/<projectId>.git, stored as the
// plain URL: the Mendix token is handed to git per command, never written into a URL, a config file or a log.
// The project's own `origin` stays what it was (the bare repository on this machine, or GitHub for a mirrored
// project), so agents never need the token; the office brings main to Team Server after every change of main.

/** Where a new project's code lives, as the New project wizard offers it. */
export type RepoHome = 'teamserver' | 'teamserver-github' | 'github' | 'local';

export const REPO_HOMES: readonly RepoHome[] = ['teamserver', 'teamserver-github', 'github', 'local'];

/** What a project's agent-office.project.json says about Team Server (`teamServer`). */
export interface TeamServerRecord {
  /** The Mendix Portal app's id (a GUID): also the Team Server repository's name. */
  projectId: string;
  /** The remote's plain URL (no token, ever). */
  url: string;
  /** The remote's name in the project's checkout. */
  remote: string;
  /** GitHub carries the pull requests and is kept equal to Team Server's main. */
  mirror?: boolean;
  /** made: the office created the Portal app; linked: the Project Manager gave an existing app's id. */
  how: 'made' | 'linked';
  by: string;
  at: number;
}

/** The last time the office brought main and Team Server together (server/team-server/sync.ts). */
export interface TeamServerSync {
  at: number;
  /** pushed: main went to Team Server; pulled: Team Server's newer commits came to main; same: nothing to do. */
  state: 'pushed' | 'pulled' | 'same' | 'diverged' | 'failed' | 'no-token';
  /** main's commit after it (Team Server's, when they're the same). */
  sha?: string;
  message: string;
}

/** What the project screen and Project settings show. */
export interface TeamServerView {
  floor: string;
  /** Undefined: the project isn't on Team Server. */
  record?: TeamServerRecord;
  portalUrl?: string;
  last?: TeamServerSync;
  /** A sync is running now. */
  running: boolean;
  /** The office has a Mendix token (from 🔌 Connections) to create apps and push with. */
  token: boolean;
  /** The project is local only (no GitHub): Connect to Team Server is offered for these. */
  localOnly: boolean;
  /** Whether the viewer may connect or push (admins). */
  may: boolean;
}

/** The Projects API (v2) and Team Server's git host. Tests pass fakes; the office never reads these from its environment. */
export interface TeamServerEndpoints {
  projectsApi: string;
  git: string;
}

export const MENDIX_ENDPOINTS: TeamServerEndpoints = {
  projectsApi: 'https://projects-api.home.mendix.com/v2',
  git: 'https://git.api.mendix.com',
};

/** The remote's name in a project's checkout (the toolkit's skills/teamserver-alignment.md uses the same). */
export const TEAMSERVER_REMOTE = 'teamserver';

/** The scope creating an app needs. */
export const APP_CREATE_SCOPE = 'mx:app:create';
/** The scopes Team Server's git needs (read to clone and fetch, write to push). */
export const REPO_SCOPES = 'mx:modelrepository:repo:read and mx:modelrepository:repo:write';

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A Portal app id (a GUID, as the Portal shows it under General › App ID), lower-cased; undefined when it isn't one. */
export function cleanProjectId(raw: unknown): string | undefined {
  const s = typeof raw === 'string' ? raw.trim().replace(/^\{|\}$/g, '') : '';
  return GUID.test(s) ? s.toLowerCase() : undefined;
}

/** The Team Server repository's URL: plain, never with a user or token in it. */
export const teamServerUrl = (projectId: string, git = MENDIX_ENDPOINTS.git) => `${git.replace(/\/+$/, '')}/${projectId}.git`;

/** The app's page in the Mendix Portal. */
export const portalUrl = (projectId: string) => `https://sprintr.home.mendix.com/link/project/${projectId}`;

/**
 * A Portal app's name from the project's: the Projects API takes `^\w[\w- ]*`, at most 100 characters
 * (projects-v2.yaml), so dots and other marks become spaces. Undefined when nothing is left.
 */
export function portalAppName(name: string): string | undefined {
  const s = name.replace(/[^\w\- ]+/g, ' ').replace(/\s+/g, ' ').trim().replace(/^[-\s]+/, '').slice(0, 100).trim();
  return /^\w/.test(s) ? s : undefined;
}

/** The app's description as the Projects API takes it (`summary`: no &<>"'/=@:()[]{}+!#$%^*|~`,;?\, at most 400). */
export function portalSummary(text: string): string {
  return text.replace(/[&<>"'/=@:()[\]{}+!#$%^*|~`,;?\\]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 400).trim();
}

/** Why each choice can't be picked now (none: it can). */
export interface RepoHomeAvailability {
  mendixToken: boolean;
  githubToken: boolean;
  offline: boolean;
}

export function repoHomeBlocked(home: RepoHome, a: RepoHomeAvailability): string | undefined {
  const ts = home === 'teamserver' || home === 'teamserver-github';
  if (ts && !a.mendixToken) return 'No Mendix token in 🔌 Connections: add one with the mx:app:create and Team Server (mx:modelrepository:repo:read / :write) scopes';
  if (ts && a.offline) return 'An offline test office never calls the Mendix Portal';
  if (home === 'teamserver-github' && !a.githubToken && !a.offline) return 'No GitHub admin token in 🔌 Connections, so the office can’t create the GitHub mirror';
  return undefined;
}

/** The default: Team Server when the office has a Mendix token, else GitHub as before. */
export const defaultRepoHome = (a: RepoHomeAvailability): RepoHome => (repoHomeBlocked('teamserver', a) ? 'github' : 'teamserver');

export const REPO_HOME_INFO: Record<RepoHome, { label: string; text: string }> = {
  teamserver: {
    label: 'Mendix Team Server',
    text: 'Creates the app in the Mendix Portal and keeps its code on Team Server, where Studio Pro and deployments read it. Nothing goes to GitHub: no pull requests or PR checks; the Project Manager merges in the office, and the office pushes main to Team Server.',
  },
  'teamserver-github': {
    label: 'Mendix Team Server + GitHub mirror',
    text: 'Creates the app in the Mendix Portal (Team Server is the source of truth) and a GitHub repository for pull requests and checks. The office keeps the two mains equal and never force-pushes either.',
  },
  github: {
    label: 'GitHub only',
    text: 'A GitHub repository, as before. No app in the Mendix Portal: connect it to Team Server yourself later.',
  },
  local: {
    label: 'Local only',
    text: 'Only when the client allows neither: a git repository on this machine, nothing pushed anywhere. You can connect it to Team Server later in Project settings.',
  },
};

/** The plan's fields for a choice (ProjectPlan.localOnly and .teamServer). */
export function planFor(home: RepoHome): { localOnly?: true; teamServer?: { mirror: boolean } } {
  if (home === 'teamserver') return { localOnly: true, teamServer: { mirror: false } };
  if (home === 'teamserver-github') return { teamServer: { mirror: true } };
  if (home === 'local') return { localOnly: true };
  return {};
}

/** The choice a plan stands for. */
export function homeOf(plan: { localOnly?: boolean; teamServer?: { mirror: boolean } }): RepoHome {
  if (plan.teamServer) return plan.teamServer.mirror ? 'teamserver-github' : 'teamserver';
  return plan.localOnly ? 'local' : 'github';
}

/** One line about a sync, for the project screen. */
export function syncWords(s: TeamServerSync | undefined): string {
  if (!s) return 'Not synced yet since the office started.';
  return s.message;
}
