// The admin GitHub credential that creates new project repositories. The agents' token deliberately
// can't make repositories (it has Contents, Issues and Pull requests only), so making one takes a
// second, stronger token that only office admins can use, through the wizard. It lives in a file of
// its own, is read just before `gh repo create` runs, goes into that one child process's environment
// as GH_TOKEN and nowhere else: never into process.env (which every worker inherits), never into a
// log line, never back to a browser.

import { readFileSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** Points at the file holding the admin token (one line). */
export const ADMIN_TOKEN_ENV = 'AGENT_OFFICE_ADMIN_GH_TOKEN_FILE';
export const DEFAULT_ADMIN_TOKEN_FILE = '.agent-office-admin-gh-token';

/** Every variable that picks a GitHub identity for gh or git: the office's own are dropped so only the admin token speaks. */
const GITHUB_VARS = ['GH_TOKEN', 'GITHUB_TOKEN', 'GH_ENTERPRISE_TOKEN', 'GITHUB_ENTERPRISE_TOKEN', 'GH_CONFIG_DIR'];

export function adminTokenFile(env: NodeJS.ProcessEnv = process.env): string {
  const set = env[ADMIN_TOKEN_ENV]?.trim();
  return set ? path.resolve(set.replace(/^~(?=$|[\\/])/, os.homedir())) : path.join(os.homedir(), DEFAULT_ADMIN_TOKEN_FILE);
}

/** Whether there's a token to use, from the file's size alone: the info the wizard shows never needs the token itself. */
export function adminTokenConfigured(file: string): boolean {
  try {
    const s = statSync(file);
    return s.isFile() && s.size > 0;
  } catch {
    return false;
  }
}

/** The token, read when it's about to be used and not kept. */
export function readAdminToken(file: string): string | undefined {
  try {
    const token = readFileSync(file, 'utf8').split(/\r?\n/)[0].trim();
    return token || undefined;
  } catch {
    return undefined;
  }
}

/**
 * The environment for the one `gh` call that uses the admin token: a copy of the office's, without
 * its GitHub identity, with GH_TOKEN set. `base` is never changed.
 */
export function adminGhEnv(base: NodeJS.ProcessEnv, token: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(base)) if (v !== undefined && !GITHUB_VARS.includes(k.toUpperCase())) env[k] = v;
  env.GH_TOKEN = token;
  env.GH_PROMPT_DISABLED = '1';
  return env;
}

/** Blanks out every secret in a line before it goes into a log, and anything shaped like a GitHub token besides. */
export function redactor(secrets: (string | undefined)[]): (line: string) => string {
  const known = secrets.filter((s): s is string => !!s && s.length >= 8);
  return (line) => {
    let out = line;
    for (const s of known) out = out.split(s).join('[redacted]');
    return out.replace(/\b(gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g, '[redacted]');
  };
}

/** What to tell an admin who has no admin token yet: how to make one and where it goes. */
export function adminTokenHelp(file: string, org: string): string[] {
  return [
    `Create a fine-grained personal access token on GitHub (Settings → Developer settings → Fine-grained tokens) with resource owner ${org}.`,
    'Repository access: All repositories (it has to reach the ones it is about to create).',
    'Permissions: Administration: Read and write, and Contents: Read and write. Nothing else.',
    `Save it as the only line of ${file} on the office's machine (or point ${ADMIN_TOKEN_ENV} at another file). The office reads it only to create repositories; agents never see it.`,
  ];
}
