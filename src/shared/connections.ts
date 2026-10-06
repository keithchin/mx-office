// 🔌 Connections: the credentials the office keeps for itself and its agents (server/connections/),
// what the page shows of each (never the value: a masked tail and a status), what each is for and how
// to make one, and the office's paths and worktree cleanup that sit on the same admin page.
// Pure, no Node imports: the page and the server both use it.

export const CREDENTIAL_IDS = ['github-agents', 'github-admin', 'mendix', 'jev', 'password'] as const;
export type CredentialId = (typeof CREDENTIAL_IDS)[number];
export const isCredentialId = (v: unknown): v is CredentialId => CREDENTIAL_IDS.includes(v as CredentialId);

/** connected: there and (when tested) accepted. invalid: refused, expired or unreadable. expiring: within EXPIRING_DAYS. */
export type CredentialStatus = 'connected' | 'missing' | 'invalid' | 'expiring';
/** Where the value the office uses comes from, first that has one: Connections, an environment variable, a dot-file. */
export type CredentialSource = 'connections' | 'env' | 'file' | 'generated';

/** A token this close to its expiry date is shown as expiring. */
export const EXPIRING_DAYS = 14;

/** The last Test of a credential, kept with it (no value in it, ever). */
export interface CredentialCheck {
  at: number;
  /** The status the test came to (expiry is looked at again whenever it's shown). */
  status: CredentialStatus;
  summary: string;
  /** More lines: what it can reach, what it's missing. */
  details?: string[];
  /** When the token stops working (GitHub says, for tokens with an expiry). */
  expiresAt?: number;
  login?: string;
  /** Repositories it can see (owner/name), the first ones. */
  repos?: string[];
  /** How many it can see in all. */
  repoCount?: number;
  /** The accounts and organizations those belong to. */
  owners?: string[];
  /** Scopes the service reported (classic GitHub tokens report theirs; fine-grained ones don't). */
  scopes?: string[];
}

export interface CredentialView {
  id: CredentialId;
  status: CredentialStatus;
  source?: CredentialSource;
  /** Which variable or file, for env and file. */
  where?: string;
  /** "••••ab12": the last characters only. */
  tail?: string;
  savedAt?: number;
  savedBy?: string;
  /** The last Test of the value in use; absent when it hasn't been tested. */
  check?: CredentialCheck;
  /** Something to know: stored as plain text, couldn't be decrypted, a launcher file that overrides it… */
  warning?: string;
}

export interface ToolCheck {
  ok: boolean;
  /** "git version 2.47.1", "Logged in to github.com as office-bot". */
  text: string;
  /** What to do about it, when it isn't ok. */
  fix?: string;
}

/** The machine's git and gh, and whether gh signs in with the agents' token. */
export interface ToolsView {
  git: ToolCheck;
  gh: ToolCheck;
  ghAuth: ToolCheck;
  /** git's own user.name / user.email (global), read only. */
  identity: ToolCheck & { name?: string; email?: string };
  /** The identity the office gives its workers' commits (GIT_AUTHOR_* / GIT_COMMITTER_*), when set here. */
  officeIdentity?: { name: string; email: string };
}

export interface PathState {
  dir: string;
  /** settings: picked here; env: an environment variable; default: where it usually is. */
  source: 'settings' | 'env' | 'default' | 'command line';
  /** What's wrong with it, when something is. */
  problem?: string;
}

export interface PathsView {
  projectsDir: PathState;
  toolkitDir: PathState;
}

export interface SweepItem {
  floor?: string;
  path: string;
  branch?: string;
  action: 'removed' | 'kept' | 'outside' | 'failed';
  why: string;
}

export interface SweepView {
  on: boolean;
  running: boolean;
  lastRun?: { at: number; items: SweepItem[] };
}

export interface ConnectionsView {
  /** How saved values are kept: Windows DPAPI for this user, or a 0600 file elsewhere. */
  storage: { scheme: 'dpapi' | 'file'; file: string; warning?: string };
  credentials: CredentialView[];
  /** Dot-files there are, with a value not in Connections yet: what Import from files would take. */
  importable: { id: CredentialId; file: string }[];
  /** Floors, and whether each one's agents get the Mendix token. */
  mendixFloors: { id: string; name: string; dir: string; on: boolean }[];
  paths: PathsView;
  sweep: SweepView;
  /** The organization new projects go in (for the token links). */
  org: string;
}

/** What the page shows about each credential: what it's for, how to make one, the scopes it needs, where. */
export interface CredentialMeta {
  icon: string;
  label: string;
  purpose: string;
  /** The exact permissions or scopes to give it. */
  scopes: string[];
  how: string[];
  /** Where to create one (a link with the details filled in, where the site takes them). */
  createUrl?: (org: string) => string;
  createLabel?: string;
  /** It has a Test button. */
  testable: boolean;
  /** Pasted values look like this; a value that doesn't is refused with `shapeHint`. */
  shape?: RegExp;
  shapeHint?: string;
}

/**
 * GitHub's new fine-grained token page with its form filled in (name, description, owner, expiry and
 * permissions); the repository selection is still picked by hand.
 */
export function githubTokenUrl(o: { name: string; description: string; owner: string; perms: Record<string, 'read' | 'write'>; expiresDays?: number }): string {
  const q = new URLSearchParams({ name: o.name, description: o.description, target_name: o.owner, expires_in: String(o.expiresDays ?? 90) });
  for (const [k, v] of Object.entries(o.perms)) q.set(k, v);
  return `https://github.com/settings/personal-access-tokens/new?${q.toString()}`;
}

const GITHUB_SHAPE = /^(github_pat_[A-Za-z0-9_]{20,}|gh[pousr]_[A-Za-z0-9]{20,})$/;

export const CREDENTIAL_META: Record<CredentialId, CredentialMeta> = {
  'github-agents': {
    icon: '🤖',
    label: 'GitHub token for agents',
    purpose: 'What the office and every worker use for git and gh: cloning, pushing branches, opening pull requests and issues. Given to workers as GH_TOKEN / GITHUB_TOKEN.',
    scopes: ['Fine-grained token', 'Resource owner: your organization', 'Repository access: All repositories (a new project then needs no token change)', 'Contents: Read and write', 'Issues: Read and write', 'Pull requests: Read and write', 'Metadata: Read (GitHub adds it)'],
    how: ['Open the link (GitHub fills in the name, owner, expiry and permissions).', 'Pick “All repositories” under Repository access.', 'Generate, copy the token, paste it here. It can’t create or delete repositories, by design.'],
    createUrl: (org) => githubTokenUrl({ name: 'Agent Office agents', description: 'Agent Office: git and gh for the office and its workers', owner: org, perms: { contents: 'write', issues: 'write', pull_requests: 'write', metadata: 'read' } }),
    createLabel: 'Create on GitHub',
    testable: true,
    shape: GITHUB_SHAPE,
    shapeHint: 'A GitHub token starts with github_pat_ (fine-grained) or ghp_ (classic)',
  },
  'github-admin': {
    icon: '🛡️',
    label: 'GitHub admin token',
    purpose: 'Creates new project repositories from the ✨ New project wizard. Only that one gh repo create sees it: never the workers, never the office’s environment.',
    scopes: ['Fine-grained token', 'Resource owner: your organization', 'Repository access: All repositories', 'Administration: Read and write', 'Contents: Read and write', 'Nothing else'],
    how: ['Open the link (name, owner, expiry and permissions filled in).', 'Pick “All repositories” (it has to reach the repositories it’s about to create).', 'Generate and paste it here.'],
    createUrl: (org) => githubTokenUrl({ name: 'Agent Office admin', description: 'Agent Office: creates project repositories (wizard only)', owner: org, perms: { administration: 'write', contents: 'write', metadata: 'read' } }),
    createLabel: 'Create on GitHub',
    testable: true,
    shape: GITHUB_SHAPE,
    shapeHint: 'A GitHub token starts with github_pat_ (fine-grained) or ghp_ (classic)',
  },
  mendix: {
    icon: '🧱',
    label: 'Mendix personal access token',
    purpose: 'For the Mendix platform: creating the app (Projects API) and, later, Team Server and deploys. The wizard gets it; a project’s agents only when you switch it on for that project below.',
    scopes: ['mx:app:create (creating the app)', 'mx:deployment:read (lets Test check it, optional)', 'Later: mx:modelrepository:repo:read / write, mx:pipelines:read / write'],
    how: ['Open Mendix user settings → Developer Settings → Personal Access Tokens → New Token.', 'Tick the scopes above, create it, copy the token and paste it here.', 'Mendix shows it once; it never expires unless you revoke it.'],
    createUrl: () => 'https://user-settings.mendix.com/link/developersettings',
    createLabel: 'Open Mendix user settings',
    testable: true,
  },
  jev: {
    icon: '⚖️',
    label: 'Jev key (Jeff · Router)',
    purpose: 'Lets Jeff, the office’s quick judge, ask Jev by TypeSafe AI. Without it he answers with Claude Haiku. Never given to workers.',
    scopes: ['A TypeSafe AI API key'],
    how: ['Get a key from TypeSafe AI (your account’s API keys).', 'Paste it here. Test makes one tiny Jev call.'],
    createUrl: () => 'https://typesafe.ai',
    createLabel: 'TypeSafe AI',
    testable: true,
  },
  password: {
    icon: '🔒',
    label: 'Office password',
    purpose: 'The shared password that signs people in (as admins). Only a hash of it is kept; changing it signs out everyone on the shared password (you stay signed in).',
    scopes: ['At least 8 characters'],
    how: ['Type the new password twice and save. Tell your team the new one.'],
    testable: false,
  },
};

/** The last few characters of a secret, the rest dots: what the page may show of it. */
export function maskTail(value: string): string {
  const v = value.trim();
  return v.length < 12 ? '••••' : `••••${v.slice(-4)}`;
}

/** A tested status, with the expiry date looked at again now. */
export function withExpiry(status: CredentialStatus, expiresAt: number | undefined, now = Date.now()): CredentialStatus {
  if (status !== 'connected' || !expiresAt) return status;
  if (expiresAt <= now) return 'invalid';
  return expiresAt - now < EXPIRING_DAYS * 86_400_000 ? 'expiring' : 'connected';
}
