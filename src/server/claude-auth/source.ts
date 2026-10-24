// Where the agents' Claude Code gets its credentials (shared/claude-auth.ts has the rules): what the office's
// environment had of the set when it started (names and tails only), the admin's choice in 🔌 Connections, and
// the keys saved there. withClaudeAuth puts the result into every worker's environment (connections/env.ts):
// the office's own set only when that is the source, else none of it, with the saved key (and gateway address)
// in its place. A test office never passes the environment's set on.

import {
  CLAUDE_BASE_VAR,
  CLAUDE_CLOUD_VARS,
  CLAUDE_KEY_VARS,
  CLAUDE_SET_VARS,
  CLAUDE_WITHHELD_ENV,
  claudeAuthMode,
  type ClaudeAuthMode,
  type ClaudeAuthSetting,
  type ClaudeEnvSeen,
} from '../../shared/claude-auth.js';
import { maskTail, type CredentialId } from '../../shared/connections.js';
import { officeSettings, storedSecret } from '../connections/store.js';
import { claudeGatewayAllowed, tokensWithheld } from '../testcreds.js';

/** The set as the office was started (read once, never changed by the office). */
export const STARTED_CLAUDE: Readonly<Record<string, string | undefined>> = Object.fromEntries([...CLAUDE_SET_VARS, CLAUDE_WITHHELD_ENV].map((k) => [k, process.env[k]]));

export interface SourceDeps {
  started: Readonly<Record<string, string | undefined>>;
  setting(): ClaudeAuthSetting | undefined;
  stored(id: CredentialId): string | undefined;
  /** A test office: the environment's set is never passed on… */
  testMode(): boolean;
  /** …unless it was started with AGENT_OFFICE_TEST_ALLOW_CLAUDE_GATEWAY=1 (testcreds.ts): then that set, and only it, is. */
  claudeAllowed?(): boolean;
}

export const sourceDeps = (): SourceDeps => ({ started: STARTED_CLAUDE, setting: () => officeSettings().claudeAuth, stored: storedSecret, testMode: tokensWithheld, claudeAllowed: () => claudeGatewayAllowed() });

const on = (v: string | undefined) => !!v && v !== '0' && v.toLowerCase() !== 'false';

/** What the environment has of the set: names, a key's last 4, whether the desktop app held some back. */
export function envSeen(started: Readonly<Record<string, string | undefined>>): ClaudeEnvSeen {
  const val = (k: string) => started[k]?.trim() || undefined;
  return {
    keys: CLAUDE_KEY_VARS.filter((k) => val(k)).map((name) => ({ name, tail: maskTail(val(name)!) })),
    baseUrl: !!val(CLAUDE_BASE_VAR),
    cloud: CLAUDE_CLOUD_VARS.filter((k) => on(val(k))),
    withheld: (val(CLAUDE_WITHHELD_ENV) ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter((n) => CLAUDE_SET_VARS.includes(n)),
  };
}

export interface ClaudeAuthState {
  env: ClaudeEnvSeen;
  setting?: ClaudeAuthSetting;
  key?: string;
  gatewayKey?: string;
  mode: ClaudeAuthMode;
  chosen: boolean;
}

export function claudeAuthState(d: SourceDeps = sourceDeps()): ClaudeAuthState {
  const env = envSeen(d.started);
  const setting = d.setting();
  const key = d.stored('anthropic');
  const gatewayKey = d.stored('claude-gateway');
  return { env, setting, key, gatewayKey, ...claudeAuthMode(setting, !!key, env) };
}

/** A worker's environment with the agents' Claude credentials as they should be (changed in place, and returned). */
export function withClaudeAuth(env: Record<string, string>, d: SourceDeps = sourceDeps()): Record<string, string> {
  const s = claudeAuthState(d);
  for (const k of CLAUDE_SET_VARS) delete env[k];
  // The office's own set as it was started (so an environment built earlier, then changed, comes out right too).
  if (s.mode === 'env') {
    if (!d.testMode() || d.claudeAllowed?.()) for (const k of CLAUDE_SET_VARS) if (d.started[k] !== undefined) env[k] = d.started[k]!;
    return env;
  }
  if (s.mode === 'key' && s.key) env.ANTHROPIC_API_KEY = s.key;
  if (s.mode === 'gateway' && s.gatewayKey && s.setting?.baseUrl) {
    env[CLAUDE_BASE_VAR] = s.setting.baseUrl;
    env.ANTHROPIC_API_KEY = s.gatewayKey;
  }
  return env;
}

/**
 * The key withClaudeAuth put in `env` from Connections (the saved API key, or the gateway's), if that's what
 * it has. Claude Code's interactive screen ignores an ANTHROPIC_API_KEY nobody approved in its config (its
 * customApiKeyResponses: then it says "Not logged in · Run /login"), so the office approves its own
 * (claude-trust.ts approveApiKey) before a worker starts with it.
 */
export function officeClaudeKey(env: Record<string, string | undefined>, d: SourceDeps = sourceDeps()): string | undefined {
  const key = env.ANTHROPIC_API_KEY;
  if (!key || d.testMode()) return undefined;
  const s = claudeAuthState(d);
  if (s.mode === 'key' && key === s.key) return key;
  if (s.mode === 'gateway' && key === s.gatewayKey && env[CLAUDE_BASE_VAR] === s.setting?.baseUrl) return key;
  return undefined;
}

/** One line for the office's log at start: names only, never a value or a tail. */
export function sourceLogLine(s: ClaudeAuthState): string {
  const what: Record<ClaudeAuthMode, string> = {
    login: 'their Claude login (no key passed)',
    key: s.key ? 'the API key saved in Connections' : 'the API key saved in Connections (none saved: no key passed)',
    gateway: 'the gateway saved in Connections',
    env: 'the office’s environment',
  };
  const names = [...s.env.keys.map((k) => k.name), ...(s.env.baseUrl ? [CLAUDE_BASE_VAR] : []), ...s.env.cloud];
  const parts = [`Claude for agents: ${what[s.mode]}${s.chosen ? '' : ' (nobody chose yet)'}`];
  if (names.length) parts.push(`the office’s environment has ${names.join(', ')}${s.mode === 'env' ? '' : ', not passed to agents'}`);
  if (s.env.withheld.length) parts.push(`the desktop app held back ${s.env.withheld.join(', ')}`);
  return parts.join('; ');
}
