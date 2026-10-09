// The office's one Connections vault and its office settings, opened once at start (office/core.ts)
// and read from anywhere in the server: the workers' environment (workers/env.ts), the wizard's admin
// token (wizard/admin-token.ts), Jeff's key (judge/key.ts), the toolkit folder. Before it's opened
// (tests, `agent-office prune`…) nothing is stored, so every credential falls back to its environment
// variable and dot-file as it always has.

import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { CredentialId } from '../../shared/connections.js';
import type { SetupRecord } from '../../shared/first-run.js';
import { Vault, defaultCipher, type Cipher } from './vault.js';

/** What 🔌 Connections keeps in <office data>/office-settings.json: none of it secret. */
export interface OfficeSettings {
  /** The mxcli-project-toolkit clone, picked in Settings (beats AGENT_OFFICE_TOOLKIT_DIR). */
  toolkitDir?: string;
  /** The hourly worktree cleanup; on unless switched off. */
  sweep?: boolean;
  /** Floor folders whose agents get the Mendix token (MENDIX_TOKEN / MX_PAT). */
  mendixFloors?: string[];
  /** The identity the workers' commits get when git has none (GIT_AUTHOR_* / GIT_COMMITTER_*). */
  gitIdentity?: { name: string; email: string };
  /** 📱 Phone access (phone-access/): on or off, the provider, the Dev Tunnel id, the Cloudflare tunnel and hostname. */
  phoneAccess?: unknown;
  /** The tunnel address phone access last put in the Teams cards' Open buttons (so it only replaces its own). */
  phoneAccessTeamsUrl?: string;
  /** Web Push's VAPID public key (webpush/keys.ts); its private half is in the vault. */
  vapidPublicKey?: string;
  /** 🚀 First-run setup's progress (first-run/): the step it's on, and when it was finished. */
  setup?: SetupRecord;
  /** The GitHub organization (or user) new projects are created in (beats AGENT_OFFICE_PROJECT_ORG). */
  projectOrg?: string;
  /** The Studio Pro version new projects start on, when it's installed (else the wizard's own pick). */
  defaultMendix?: string;
  /** Where the toolkit is cloned from (first-run setup's Toolkit step). */
  toolkitRepo?: string;
  /** mxcli, picked in first-run setup (beats AGENT_OFFICE_MXCLI); its folder goes first on the agents' PATH. */
  mxcliPath?: string;
}

/** The GitHub variables as the office was started with them, before Connections laid its token over them. */
export const STARTED_ENV: Readonly<Record<string, string | undefined>> = { GH_TOKEN: process.env.GH_TOKEN, GITHUB_TOKEN: process.env.GITHUB_TOKEN, AGENT_OFFICE_PASSWORD: process.env.AGENT_OFFICE_PASSWORD };

let vault: Vault | undefined;
let settingsFile: string | undefined;
let settings: OfficeSettings = {};

/** Opens <dataDir>/credentials.json and office-settings.json (again, in tests). */
export function openConnections(dataDir: string, cipher: Cipher = defaultCipher()): Vault {
  vault = new Vault(path.join(dataDir, 'credentials.json'), cipher).load();
  settingsFile = path.join(dataDir, 'office-settings.json');
  try {
    settings = JSON.parse(readFileSync(settingsFile, 'utf8')) as OfficeSettings;
  } catch {
    settings = {};
  }
  return vault;
}

/** Forgets the vault (tests). */
export function closeConnections() {
  vault = undefined;
  settingsFile = undefined;
  settings = {};
}

export const connectionsVault = (): Vault | undefined => vault;

/** Whether the office opened Connections (only a running office reads the dot-files in the home folder). */
export const connectionsOpen = (): boolean => !!vault;

/** A value saved in Connections, if there is one. */
export const storedSecret = (id: CredentialId): string | undefined => vault?.get(id);

export const officeSettings = (): Readonly<OfficeSettings> => settings;

export function updateOfficeSettings(patch: Partial<OfficeSettings>): OfficeSettings {
  settings = { ...settings, ...patch };
  for (const k of Object.keys(settings) as (keyof OfficeSettings)[]) if (settings[k] === undefined) delete settings[k];
  if (settingsFile) {
    const tmp = `${settingsFile}.tmp`;
    writeFileSync(tmp, JSON.stringify(settings, null, 2), { mode: 0o600 });
    renameSync(tmp, settingsFile);
  }
  return settings;
}

/**
 * The folder the office's dot-files are looked for in: the home folder, or AGENT_OFFICE_SECRETS_HOME
 * (a test office points it somewhere harmless, so it never picks up the real ones).
 */
export const secretsHome = (env: NodeJS.ProcessEnv = process.env): string => (env.AGENT_OFFICE_SECRETS_HOME ? path.resolve(env.AGENT_OFFICE_SECRETS_HOME) : os.homedir());

/**
 * Where the toolkit clone usually is, in the home folder: mendix-toolkit (where first-run setup clones
 * it), or an older workspace's agent-spike/mendix-toolkit (agent-spike/mxcli-project-toolkit before that).
 */
export const TOOLKIT_DEFAULTS = [['mendix-toolkit'], ['agent-spike', 'mendix-toolkit'], ['agent-spike', 'mxcli-project-toolkit']];

/** The toolkit clone: picked in Settings, else AGENT_OFFICE_TOOLKIT_DIR, else where it usually is. */
export function toolkitDirState(env: NodeJS.ProcessEnv = process.env): { dir: string; source: 'settings' | 'env' | 'default' } {
  if (settings.toolkitDir) return { dir: settings.toolkitDir, source: 'settings' };
  if (env.AGENT_OFFICE_TOOLKIT_DIR) return { dir: path.resolve(env.AGENT_OFFICE_TOOLKIT_DIR), source: 'env' };
  return { dir: firstExisting(TOOLKIT_DEFAULTS.map((p) => path.join(os.homedir(), ...p))), source: 'default' };
}

/** The first of `dirs` that exists, else the first: the default to suggest when none is there yet. */
export const firstExisting = (dirs: string[]): string => dirs.find((d) => existsSync(d)) ?? dirs[0];

export const toolkitDir = (env: NodeJS.ProcessEnv = process.env): string => toolkitDirState(env).dir;
