// Where the agents' Claude Code gets its credentials (server/claude-auth/): their own Claude login (no
// key passed: the default), an API key saved in 🔌 Connections, a gateway saved there (its base URL with
// its key), or what the office's own environment had (ANTHROPIC_API_KEY / ANTHROPIC_AUTH_TOKEN with
// ANTHROPIC_BASE_URL, or a Bedrock / Vertex / Foundry flag). A key and the base URL it belongs to are one
// set: an inherited key without a base URL is never passed by default (it may be a gateway's, and sent to
// api.anthropic.com every agent fails with "Invalid API key"). Pure, no Node imports: the page, the server
// and the desktop app's launcher all use it. No value ever goes in a view, not even a key's last characters: names and sources only.

/** The variables that carry a Claude key. */
export const CLAUDE_KEY_VARS = ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN'] as const;
/** Where a key is sent (a gateway's address). */
export const CLAUDE_BASE_VAR = 'ANTHROPIC_BASE_URL';
/** Claude Code on a cloud provider: the provider's own credentials go with it. */
export const CLAUDE_CLOUD_VARS = ['CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX', 'CLAUDE_CODE_USE_FOUNDRY'] as const;
/** The whole set, taken out of an agent's environment unless the office's environment is what it uses. */
export const CLAUDE_SET_VARS: readonly string[] = [...CLAUDE_KEY_VARS, CLAUDE_BASE_VAR, ...CLAUDE_CLOUD_VARS];
/** The desktop app names here (names only) what it didn't pass on to the office it started. */
export const CLAUDE_WITHHELD_ENV = 'AGENT_OFFICE_CLAUDE_WITHHELD';

/** login: no key passed. key: the API key saved in Connections. gateway: the gateway saved there. env: the office's environment, as it was started. */
export type ClaudeAuthMode = 'login' | 'key' | 'gateway' | 'env';
export const CLAUDE_AUTH_MODES: readonly ClaudeAuthMode[] = ['login', 'key', 'gateway', 'env'];
export const isClaudeAuthMode = (v: unknown): v is ClaudeAuthMode => CLAUDE_AUTH_MODES.includes(v as ClaudeAuthMode);

/** What office-settings.json keeps (claudeAuth): the choice an admin made, and the gateway's address. Nothing secret. */
export interface ClaudeAuthSetting {
  mode?: ClaudeAuthMode;
  baseUrl?: string;
  at?: number;
  by?: string;
}

/** What the office's environment has of the set, without a value: names only, and whether the desktop app held them back. */
export interface ClaudeEnvSeen {
  keys: { name: string }[];
  baseUrl: boolean;
  cloud: string[];
  /** Variables the desktop app didn't pass to the office (they're in the Windows environment, not the office's). */
  withheld: string[];
}

/** The agents' Claude credential source, chosen or as it falls out. */
export function claudeAuthMode(setting: ClaudeAuthSetting | undefined, storedKey: boolean, env: ClaudeEnvSeen): { mode: ClaudeAuthMode; chosen: boolean } {
  if (setting?.mode) return { mode: setting.mode, chosen: true };
  // An API key saved in first-run setup or here is a choice already.
  if (storedKey) return { mode: 'key', chosen: false };
  // A complete set the office was started with keeps working as it did: a key with its base URL, or a cloud provider.
  if (env.cloud.length || (env.keys.length && env.baseUrl)) return { mode: 'env', chosen: false };
  // A key without its base URL isn't passed: agents use their Claude login.
  return { mode: 'login', chosen: false };
}

/** The one-time decision: the environment has a key and nobody chose yet (a saved API key wins anyway). */
export const decisionPending = (setting: ClaudeAuthSetting | undefined, storedKey: boolean, env: ClaudeEnvSeen): boolean =>
  !setting?.mode && !storedKey && (env.keys.length > 0 || env.withheld.some((n) => (CLAUDE_KEY_VARS as readonly string[]).includes(n)));

/** "ANTHROPIC_API_KEY": variable names only, never a character of a value. */
const keyNames = (env: ClaudeEnvSeen) => {
  const named = env.keys.map((k) => k.name);
  for (const n of env.withheld) if ((CLAUDE_KEY_VARS as readonly string[]).includes(n) && !env.keys.some((k) => k.name === n)) named.push(n);
  return named.join(' and ') || 'ANTHROPIC_API_KEY';
};

/** What the page shows about it. */
export interface ClaudeAuthView {
  mode: ClaudeAuthMode;
  chosen: boolean;
  /** One line: where the agents' Claude credentials come from. */
  source: string;
  warning?: string;
  env: ClaudeEnvSeen;
  /** What Connections has saved: whether there's a key (never any of it), and the gateway's address. */
  saved: { key?: boolean; gatewayKey?: boolean; baseUrl?: string };
  /** The one-time decision, while it's open: an admin's, shown only in Settings › Connections (and one note on Home), never on a project. */
  decision?: { text: string };
  /** Claude rejected the agents' credentials, office-wide (cleared by the next turn that works). */
  failure?: { at: number; text: string; workers: { id: string; name: string; floor?: string }[]; incident?: string };
  admin: boolean;
}

export interface SourceWords {
  source: string;
  warning?: string;
}

/** The source line and its warning, for the mode in use. */
export function sourceWords(mode: ClaudeAuthMode, chosen: boolean, env: ClaudeEnvSeen, saved: ClaudeAuthView['saved']): SourceWords {
  const hasKey = env.keys.length > 0;
  const held = env.withheld.length > 0;
  switch (mode) {
    case 'login': {
      const source = 'Claude login (no key passed): each agent’s Claude Code uses the Claude account it’s signed in with.';
      if (hasKey && !env.baseUrl && !chosen) return { source, warning: `${keyNames(env)} found in the office’s environment without ${CLAUDE_BASE_VAR} — not passed to agents; it may belong to a gateway. Set the gateway up here if agents should use it.` };
      if (hasKey || held) return { source, warning: chosen ? `${keyNames(env)} in the office’s environment is not passed to agents (you chose their Claude login).` : `${keyNames(env)} was not passed to the office by the desktop app: agents use their Claude login until you choose otherwise.` };
      return { source };
    }
    case 'key':
      return saved.key ? { source: 'API key saved in Connections, sent to Anthropic’s API.' } : { source: 'API key saved in Connections — but none is saved, so agents get no key.', warning: 'Save the API key below, or switch to the agents’ Claude login.' };
    case 'gateway':
      return saved.baseUrl && saved.gatewayKey ? { source: `Gateway saved in Connections: ${saved.baseUrl} with its key.` } : { source: 'Gateway saved in Connections — but its address or key is missing, so agents get neither.', warning: 'Fill in the gateway’s base URL and key below, or switch to the agents’ Claude login.' };
    case 'env': {
      if (!hasKey && env.cloud.length) return { source: `${env.cloud.join(', ')} from the office’s environment: Claude Code on that cloud provider, with its own credentials.` };
      if (!hasKey && held) return { source: `${keyNames(env)} from the office’s environment — held back by the desktop app until the office restarts.`, warning: 'Restart the office (🔁 Restart safely) so the desktop app passes it on.' };
      const base = env.baseUrl ? ` with ${CLAUDE_BASE_VAR}` : ' without a base URL';
      const source = `The Claude access this office was started with: ${keyNames(env)}${base} from the office’s environment (e.g. a Windows user variable).`;
      if (!env.baseUrl) return { source, warning: `The office’s environment has ${keyNames(env)} but no ${CLAUDE_BASE_VAR}: agents will send this key to Anthropic directly (api.anthropic.com). If it’s a gateway’s key, every agent fails with “Invalid API key” — choose A gateway instead and save its base URL with the key.` };
      return { source, warning: `Agents use a key the office inherited from its environment${env.baseUrl ? '' : ', sent to api.anthropic.com'}. If it’s wrong, or belongs to a gateway whose address isn’t set, every agent fails with “Invalid API key”.` };
    }
  }
}

/** The decision's words. */
export function decisionText(env: ClaudeEnvSeen): string {
  const names = keyNames(env);
  if (env.keys.length && env.baseUrl) return `Agents use the Claude access this office was started with (${names} with ${CLAUDE_BASE_VAR}). Keep it, or use the agents’ Claude login instead?`;
  if (env.keys.length) return `${names} is in the office’s environment without ${CLAUDE_BASE_VAR}, so it isn’t passed to agents (it may belong to a gateway). Keep using it anyway, or use the agents’ Claude login?`;
  return `${names} is in the Windows environment; the desktop app didn’t pass it to the office. Keep using it (after a restart), or use the agents’ Claude login?`;
}

/** The auth-failure alert, with the likely cause. */
export function failureText(mode: ClaudeAuthMode, env: ClaudeEnvSeen): string {
  switch (mode) {
    case 'env':
      return `Claude rejected the API key agents use (source: ${keyNames(env)} from the office’s environment${env.baseUrl ? `, with ${CLAUDE_BASE_VAR}` : ''}). ${env.baseUrl ? '' : 'A key from the office’s environment was passed without a base URL; it may be a gateway key. '}Agents can’t work until it’s fixed.`;
    case 'key':
      return 'Claude rejected the API key agents use (source: the API key saved in Connections). Agents can’t work until it’s fixed.';
    case 'gateway':
      return 'Claude rejected the key agents use (source: the gateway saved in Connections). Agents can’t work until it’s fixed.';
    case 'login':
      return 'Claude rejected the agents’ sign-in (source: their Claude login — signed out, or the login expired). Agents can’t work until someone signs Claude Code in again.';
  }
}

/** A gateway address the office accepts: http(s), no credentials in it. */
export function cleanBaseUrl(raw: string): string | undefined {
  const v = raw.trim();
  if (!v || v.length > 500) return undefined;
  try {
    const u = new URL(v);
    if ((u.protocol !== 'https:' && u.protocol !== 'http:') || u.username || u.password) return undefined;
    return v.replace(/\/+$/, '');
  } catch {
    return undefined;
  }
}
