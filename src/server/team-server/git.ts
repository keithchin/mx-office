// git against Team Server with the Mendix token, without the token ever being written down. Team Server's git
// takes HTTP Basic only, user `pat` (lower case) and the token as the password (the toolkit's
// skills/platform-link.md, measured). The token reaches git for one command only, through that child's
// environment: GIT_CONFIG_* (command-scoped config, never a file) resets git's credential helpers (so Git
// Credential Manager neither answers nor stores it) and adds a helper, scoped to Team Server's host, that
// prints `username=pat` and the password from an environment variable. The helper's text holds no secret, the
// remote stays the plain URL in .git/config, nothing is in a process's arguments, and every line git says is
// passed through a redactor before anyone sees it. Prompts are off, so a refused token fails at once instead of
// opening a window on the office's desktop.

import { runCommand, type RunResult } from '../wizard/run.js';
import { redactor } from '../wizard/admin-token.js';
import { MENDIX_ENDPOINTS } from '../../shared/team-server.js';

/** The variable the helper reads the token from (in that git child's environment only). */
export const TOKEN_VAR = 'MX_OFFICE_TEAMSERVER_TOKEN';

/** The credential helper: answers `get` with user `pat` and the token from TOKEN_VAR; ignores store and erase. */
export const HELPER = `!f() { test "$1" = get || return 0; echo username=pat; echo "password=$${TOKEN_VAR}"; }; f`;

/** HTTP settings for big first pushes (platform-link.md trap 5): buffer the pack, HTTP/1.1, no low-speed abort. */
export const PUSH_TUNING = ['-c', 'http.postBuffer=524288000', '-c', 'http.version=HTTP/1.1', '-c', 'http.lowSpeedLimit=0', '-c', 'http.lowSpeedTime=999999'];

/** `env` with the Team Server credentials for one git command (see above). */
export function teamServerGitEnv(env: NodeJS.ProcessEnv, token: string, git = MENDIX_ENDPOINTS.git): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = { ...env };
  const n = Number.parseInt(out.GIT_CONFIG_COUNT ?? '', 10) || 0;
  const host = git.replace(/\/+$/, '');
  const pairs: [string, string][] = [
    // An empty helper resets the list: no credential manager answers or stores the token.
    ['credential.helper', ''],
    [`credential.${host}.helper`, HELPER],
    [`credential.${host}.username`, 'pat'],
  ];
  pairs.forEach(([k, v], i) => {
    out[`GIT_CONFIG_KEY_${n + i}`] = k;
    out[`GIT_CONFIG_VALUE_${n + i}`] = v;
  });
  out.GIT_CONFIG_COUNT = String(n + pairs.length);
  out[TOKEN_VAR] = token;
  out.GIT_TERMINAL_PROMPT = '0';
  out.GCM_INTERACTIVE = 'never';
  // An askpass (VS Code's, a desktop's) would be asked when the helper's answer is refused: never.
  delete out.GIT_ASKPASS;
  delete out.SSH_ASKPASS;
  return out;
}

export interface TsGit {
  /** git with the token (fetch, push, ls-remote, clone against Team Server). */
  auth(dir: string, args: string[], o?: { timeoutMs?: number; allowFail?: boolean }): Promise<RunResult>;
  /** git without it (everything local); `env` adds to its environment (a temporary index). */
  plain(dir: string, args: string[], o?: { timeoutMs?: number; allowFail?: boolean; env?: Record<string, string> }): Promise<RunResult>;
  /** Text with the token taken out, wherever it might appear. */
  hide(text: string): string;
}

export interface TsGitDeps {
  token: string;
  env: NodeJS.ProcessEnv;
  git?: string;
  onLine?: (line: string) => void;
  run?: typeof runCommand;
}

/** A git runner for Team Server work: both kinds, each line said through the redactor, errors redacted too. */
export function tsGit(d: TsGitDeps): TsGit {
  const hide = redactor([d.token]);
  const run = d.run ?? runCommand;
  const go = async (dir: string, args: string[], env: Record<string, string | undefined>, o: { timeoutMs?: number; allowFail?: boolean } = {}) => {
    try {
      const r = await run('git', args, { cwd: dir, env, timeoutMs: o.timeoutMs ?? 5 * 60_000, allowFail: o.allowFail, onLine: d.onLine ? (l) => d.onLine!(hide(l)) : undefined });
      return { ...r, stdout: hide(r.stdout), tail: r.tail.map(hide) };
    } catch (err) {
      throw new Error(hide((err as Error).message));
    }
  };
  return {
    auth: (dir, args, o) => go(dir, args, teamServerGitEnv(d.env, d.token, d.git), o),
    plain: (dir, args, o) => go(dir, args, { ...d.env, GIT_TERMINAL_PROMPT: '0', ...o?.env }, o),
    hide,
  };
}

/** Why git couldn't reach Team Server, in words (a 401 is the token or its scopes, never "wrong password"). */
export function gitRefusalWords(message: string): string {
  if (/\b401\b|Authentication failed|could not read Username|terminal prompts disabled/i.test(message)) return `Team Server refused the Mendix token: it needs the mx:modelrepository:repo:read and :write scopes (and must belong to someone on the app's team). ${message.slice(0, 200)}`;
  if (/\b403\b/.test(message)) return `Team Server refused access (403): the token's owner may not be on the app's team, or the token lacks mx:modelrepository:repo:write. ${message.slice(0, 200)}`;
  if (/\b404\b|not found|does not appear to be a git repository/i.test(message)) return `Team Server has no repository for that app (yet): check the App ID. ${message.slice(0, 200)}`;
  return message.slice(0, 300);
}
