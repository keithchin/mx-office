// Which value of each credential the office uses, first that has one: what's saved in 🔌 Connections,
// then the environment variable the office was started with, then the dot-file in the home folder that
// start-office.ps1 (and the docs) have always used. So an office started the old way keeps working,
// and one with everything in Connections needs no files and no launcher at all.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { CredentialId, CredentialSource } from '../../shared/connections.js';
import { ADMIN_TOKEN_ENV, DEFAULT_ADMIN_TOKEN_FILE } from '../wizard/admin-token.js';
import { STARTED_ENV, connectionsOpen, secretsHome, storedSecret } from './store.js';

export interface Resolved {
  value?: string;
  source?: CredentialSource;
  /** The variable or file it came from. */
  where?: string;
}

export interface ResolveDeps {
  env: NodeJS.ProcessEnv;
  /** GH_TOKEN / GITHUB_TOKEN as the office was started (process.env has Connections' laid over them). */
  started: Readonly<Record<string, string | undefined>>;
  /** Where the dot-files are; none (tests, a CLI command) reads no dot-files. */
  home?: string;
  stored: (id: CredentialId) => string | undefined;
  /** A file's whole text, undefined when it can't be read. */
  read: (file: string) => string | undefined;
}

/** A text's first line, trimmed; undefined for none or an empty one. */
const firstOf = (text: string | undefined) => text?.split(/\r?\n/)[0]?.trim() || undefined;

export const readAll = (file: string): string | undefined => {
  try {
    return readFileSync(file, 'utf8');
  } catch {
    return undefined;
  }
};

const defaults = (): ResolveDeps => ({ env: process.env, started: STARTED_ENV, home: connectionsOpen() ? secretsHome() : undefined, stored: storedSecret, read: readAll });

/** KEY=value from a dotenv-style file (~/Mendix/.env), quotes and `export` taken off. */
export function dotenvValue(text: string | undefined, key: string): string | undefined {
  for (const line of (text ?? '').split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && m[1] === key) return m[2].replace(/^(['"])(.*)\1$/, '$2').trim() || undefined;
  }
  return undefined;
}

const tilde = (home: string, file: string) => (file.startsWith(home) ? `~${file.slice(home.length).replace(/\\/g, '/')}` : file);

/** A dot-file that holds one of the credentials: where it is, and how to read it. */
export interface DotFile {
  file: string;
  /** Read it (its first line, or MX_PAT= out of ~/Mendix/.env). */
  read(deps: Pick<ResolveDeps, 'read'>): string | undefined;
}

/** The dot-files each credential has always been read from (password: the launcher's). */
export function dotFiles(home: string, env: NodeJS.ProcessEnv = process.env): Record<CredentialId, DotFile[]> {
  const line = (file: string): DotFile => ({ file, read: (d) => firstOf(d.read(file)) });
  const adminSet = env[ADMIN_TOKEN_ENV]?.trim();
  const jevSet = env.AGENT_OFFICE_JEV_KEY_FILE?.trim();
  const mendix = path.join(home, 'Mendix', '.env');
  return {
    'github-agents': [line(path.join(home, '.agent-office-gh-token'))],
    'github-admin': [line(adminSet ? path.resolve(adminSet.replace(/^~(?=$|[\\/])/, home)) : path.join(home, DEFAULT_ADMIN_TOKEN_FILE))],
    mendix: [{ file: mendix, read: (d) => dotenvValue(d.read(mendix), 'MX_PAT') }],
    jev: [line(jevSet ? path.resolve(jevSet) : path.join(home, '.agent-office-jev-key'))],
    // Only ever in Connections (the webhook used to be in notify-teams.json, moved here once).
    'teams-webhook': [],
    'web-push-key': [],
    password: [line(path.join(home, '.agent-office-password'))],
  };
}

/** The value of a credential the office uses now, and where it's from. The password has no value here (only its hash is kept). */
export function resolveCredential(id: CredentialId, deps: ResolveDeps = defaults()): Resolved {
  const { env, home } = deps;
  const stored = deps.stored(id);
  if (stored) return { value: stored, source: 'connections' };
  const files = home ? dotFiles(home, env)[id] : [];
  const fromFile = (): Resolved => {
    for (const f of files) {
      const value = f.read(deps);
      if (value) return { value, source: 'file', where: tilde(home!, f.file) };
    }
    return {};
  };
  const fromEnv = (name: string, value: string | undefined): Resolved | undefined => {
    const v = value?.trim();
    if (!v) return undefined;
    // The launcher copies a dot-file into the variable: say so, so it's clear where to change it.
    const file = fromFile();
    return { value: v, source: 'env', where: file.value === v ? `${name} (from ${file.where})` : name };
  };
  switch (id) {
    case 'github-agents':
      return fromEnv('GH_TOKEN', deps.started.GH_TOKEN) ?? fromEnv('GITHUB_TOKEN', deps.started.GITHUB_TOKEN) ?? fromFile();
    case 'github-admin': {
      const r = fromFile();
      return r.value && env[ADMIN_TOKEN_ENV]?.trim() ? { ...r, source: 'env', where: `${ADMIN_TOKEN_ENV} → ${r.where}` } : r;
    }
    case 'mendix':
      return fromEnv('MENDIX_TOKEN', env.MENDIX_TOKEN) ?? fromEnv('MX_PAT', env.MX_PAT) ?? fromFile();
    case 'jev': {
      const r = fromFile();
      if (r.value && env.AGENT_OFFICE_JEV_KEY_FILE?.trim()) return { ...r, source: 'env', where: `AGENT_OFFICE_JEV_KEY_FILE → ${r.where}` };
      return fromEnv('TYPESAFE_API_KEY', env.TYPESAFE_API_KEY) ?? r;
    }
    case 'teams-webhook':
    case 'web-push-key':
    case 'password':
      return {};
  }
}

/** The value only (the workers' environment, Jeff, the wizard). */
export const credential = (id: CredentialId): string | undefined => resolveCredential(id).value;

/**
 * Puts the agents' token into the office's own environment as GH_TOKEN / GITHUB_TOKEN, where the
 * office's gh and git calls and every worker (workers/env.ts copies it) pick it up, as the launcher's
 * variables always were. With none anywhere, the variables are as the office was started.
 */
export function applyAgentToken(env: NodeJS.ProcessEnv = process.env) {
  const token = credential('github-agents');
  for (const k of ['GH_TOKEN', 'GITHUB_TOKEN'] as const) {
    const v = token ?? STARTED_ENV[k];
    if (v) env[k] = v;
    else delete env[k];
  }
}
