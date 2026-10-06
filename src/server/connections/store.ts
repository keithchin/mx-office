// The office's one Connections vault and its office settings, opened once at start (office/core.ts)
// and read from anywhere in the server: the workers' environment (workers/env.ts), the wizard's admin
// token (wizard/admin-token.ts), Jeff's key (judge/key.ts), the toolkit folder. Before it's opened
// (tests, `agent-office prune`…) nothing is stored, so every credential falls back to its environment
// variable and dot-file as it always has.

import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { CredentialId } from '../../shared/connections.js';
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

/** The toolkit clone: picked in Settings, else AGENT_OFFICE_TOOLKIT_DIR, else where it usually is. */
export function toolkitDirState(env: NodeJS.ProcessEnv = process.env): { dir: string; source: 'settings' | 'env' | 'default' } {
  if (settings.toolkitDir) return { dir: settings.toolkitDir, source: 'settings' };
  if (env.AGENT_OFFICE_TOOLKIT_DIR) return { dir: path.resolve(env.AGENT_OFFICE_TOOLKIT_DIR), source: 'env' };
  return { dir: path.join(os.homedir(), 'agent-spike', 'mxcli-project-toolkit'), source: 'default' };
}

export const toolkitDir = (env: NodeJS.ProcessEnv = process.env): string => toolkitDirState(env).dir;
