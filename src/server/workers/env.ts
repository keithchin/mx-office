// The environment the workers start with: the office's own, minus a parent agent session's.
import { PROVIDERS } from '../providers/index.js';
import { withFloorToolkitEnv } from '../toolkit-env.js';
import { withConnections } from '../connections/env.js';

// Env vars from a parent agent session (e.g. starting the office from inside Claude Code) that
// would make a worker think it is a child session — that silently turns off transcript saving,
// which breaks resume. Each provider names its own (see ProviderAdapter.scrubEnv).
const SCRUB_ENV = new Set([
  ...Object.values(PROVIDERS).flatMap((p) => p.scrubEnv ?? []),
  'NO_COLOR', 'FORCE_COLOR', 'VSCODE_INJECTION', 'TERM_PROGRAM', 'TERM_PROGRAM_VERSION',
  // Jeff's Jev key is the office's, never a worker's (AGENT_OFFICE_JEV_KEY_FILE goes with the prefix below).
  'TYPESAFE_API_KEY',
]);
const SCRUB_PREFIXES = [...Object.values(PROVIDERS).flatMap((p) => p.scrubPrefixes ?? []), 'NEBULA_', 'AGENT_OFFICE_'];
const scrubbed = (k: string) => SCRUB_ENV.has(k) || SCRUB_PREFIXES.some((p) => k.startsWith(p));

/**
 * The office's environment, minus anything that would make a child think it's a nested session. For
 * something that runs for a floor (`floorDir`), with that floor's .claude/toolkit.env laid over it, so
 * the toolkit's scripts build with the project's own mxbuild rather than one the office inherited.
 */
export function childEnv(floorDir?: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && !scrubbed(k)) env[k] = v;
  // 🔌 Connections: the agents' token, the Mendix token where it's switched on, the office's commit identity.
  withConnections(env, floorDir);
  return floorDir ? withFloorToolkitEnv(floorDir, env) : env;
}
