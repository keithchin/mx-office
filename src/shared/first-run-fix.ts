// 🚀 First-run setup's one-click fixes (server/first-run/fixes.ts runs them, client/first-run/fix.ts
// shows them): what each missing row's Fix does, in what order Set up everything runs them, where each
// program comes from, and the progress lines the office streams while they run. Nothing here runs
// anything: the office plans a fix, the page shows the plan and asks, and only a confirmed plan runs.
// Pure, no Node imports: the page and the server both use it.

import type { PrereqId } from './first-run.js';

/** Every fix, in the order Set up everything runs them (signing in to Claude last: it waits for you). */
export const FIX_IDS = ['node', 'git', 'longpaths', 'gh', 'gh-auth', 'gh-token', 'jq', 'claude', 'mxcli', 'toolkit', 'claude-auth'] as const;
export type FixId = (typeof FIX_IDS)[number];
export const isFixId = (v: unknown): v is FixId => FIX_IDS.includes(v as FixId);

/** The fix a prerequisite row's Fix button runs (Studio Pro and PostgreSQL have links only). */
export const FIX_FOR: Partial<Record<PrereqId, FixId>> = {
  node: 'node',
  git: 'git',
  gitbash: 'git',
  longpaths: 'longpaths',
  gh: 'gh',
  'gh-auth': 'gh-auth',
  jq: 'jq',
  claude: 'claude',
  'claude-auth': 'claude-auth',
  mxcli: 'mxcli',
  toolkit: 'toolkit',
};

/** The winget packages the office installs (Windows), with what each brings. */
export const WINGET_PACKAGES = {
  node: { id: 'OpenJS.NodeJS.LTS', name: 'Node.js LTS' },
  git: { id: 'Git.Git', name: 'Git for Windows (with Git Bash)' },
  gh: { id: 'GitHub.cli', name: 'GitHub CLI' },
  jq: { id: 'jqlang.jq', name: 'jq' },
} as const;
export type WingetFix = keyof typeof WINGET_PACKAGES;
export const isWingetFix = (id: FixId): id is WingetFix => id in WINGET_PACKAGES;

/** winget's own page, for a Windows machine without it (App Installer). */
export const WINGET_LINK = 'https://learn.microsoft.com/windows/package-manager/winget/';

/** Off Windows, or without winget: what to type, and where to download it. */
export const MANUAL_INSTALL: Record<WingetFix, { link: string; brew: string; apt: string }> = {
  node: { link: 'https://nodejs.org/en/download', brew: 'brew install node@22', apt: 'See nodejs.org (NodeSource) for Node 22 on apt' },
  git: { link: 'https://git-scm.com/downloads', brew: 'brew install git', apt: 'sudo apt install git' },
  gh: { link: 'https://cli.github.com', brew: 'brew install gh', apt: 'sudo apt install gh' },
  jq: { link: 'https://jqlang.org/download/', brew: 'brew install jq', apt: 'sudo apt install jq' },
};

/** Claude Code's official installer (code.claude.com/docs/en/setup: the native install, recommended). */
export const CLAUDE_INSTALL = {
  ps1: 'https://claude.ai/install.ps1',
  sh: 'https://claude.ai/install.sh',
  npm: '@anthropic-ai/claude-code',
  docs: 'https://code.claude.com/docs/en/setup',
} as const;

/** GitHub's page where gh's one-time code is typed. */
export const GITHUB_DEVICE_URL = 'https://github.com/login/device';

/** mxcli's official releases (github.com/mendixlabs/mxcli): the newest release's binary for this machine. */
export const MXCLI_REPO = 'https://github.com/mendixlabs/mxcli';
export function mxcliAsset(platform: string, arch: string): string | undefined {
  const os = platform === 'win32' ? 'windows' : platform === 'darwin' ? 'darwin' : platform === 'linux' ? 'linux' : undefined;
  const cpu = arch === 'x64' ? 'amd64' : arch === 'arm64' ? 'arm64' : undefined;
  return os && cpu ? `mxcli-${os}-${cpu}${os === 'windows' ? '.exe' : ''}` : undefined;
}
export const mxcliUrl = (asset: string) => `${MXCLI_REPO}/releases/latest/download/${asset}`;

/** One step of a plan, as the confirm shows it: what it does, the exact commands, and where things come from. */
export interface FixStep {
  id: FixId;
  title: string;
  /** The commands it runs, as a person would type them. */
  commands: string[];
  /** Where what it installs comes from. */
  sources: string[];
  /** Something to know before saying yes (a restart, a terminal window, agents acting as you). */
  note?: string;
  /** May be left out at the confirm (saving the token from gh's sign-in). */
  optional?: boolean;
}

/** What the office can't do itself on this machine: links and commands to type. */
export interface FixManual {
  id: FixId;
  title: string;
  why: string;
  links: string[];
  commands: string[];
}

/** A plan the page shows before anything runs. `confirm` is what the run must carry (single use, minutes). */
export interface FixPlan {
  steps: FixStep[];
  manual: FixManual[];
  /** Absent when there's nothing to run. */
  confirm?: string;
  expiresAt?: number;
}

/** One line of a run's progress (NDJSON, as the toolkit clone streams). Never a secret. */
export type FixEvent =
  | { t: 'step'; id: FixId; title: string }
  | { t: 'line'; text: string }
  /** gh's one-time code: shown big, with Copy and GitHub's page. */
  | { t: 'code'; code: string; url: string }
  | { t: 'step-done'; id: FixId; ok: boolean; error?: string }
  /** The office's PATH was read again from Windows (or it needs a restart to see new programs). */
  | { t: 'path'; refreshed: boolean; added: string[] }
  | { t: 'done'; ok: true; restart?: string }
  | { t: 'done'; ok: false; id?: FixId; error: string };

/** A GitHub device code as gh prints it: "XXXX-XXXX". */
export const DEVICE_CODE = /\b([A-Z0-9]{4}-[A-Z0-9]{4})\b/;

/** The one-time code and the page from what `gh auth login --web` prints (undefined until it has). */
export function parseDeviceCode(out: string): { code: string; url: string } | undefined {
  const m = /one-time code:\s*([A-Z0-9]{4}-[A-Z0-9]{4})/i.exec(out);
  if (!m) return undefined;
  const url = /https:\/\/github\.com\/login\/device\S*/.exec(out)?.[0] ?? GITHUB_DEVICE_URL;
  return { code: m[1].toUpperCase(), url };
}

/** Shapes an Anthropic API key has (sk-ant-api03-…); an OAuth token from `claude setup-token` is sk-ant-oat…. */
export const ANTHROPIC_KEY = /^sk-ant-[a-z]+\d*-[A-Za-z0-9_-]{20,}$/;
