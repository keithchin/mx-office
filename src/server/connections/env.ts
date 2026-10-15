// What 🔌 Connections adds to a worker's environment (workers/env.ts): the agents' GitHub token as
// GH_TOKEN / GITHUB_TOKEN, the Mendix token on every project unless an admin switched it off there (as
// MENDIX_TOKEN / MX_PAT, and MENDIX_PAT, the name mxcli reads for Marketplace installs), and the office's
// commit identity when one is set. Where it's off, the Mendix token is taken out, even when the office
// itself was started with it.

import path from 'node:path';
import { credential, resolveCredential } from './resolve.js';

/** A credential saved in Connections itself (not one the office was started with: that's in the environment already). */
const stored = (id: 'anthropic') => (resolveCredential(id).source === 'connections' ? credential(id) : undefined);
import { officeSettings } from './store.js';

export const MENDIX_VARS = ['MENDIX_TOKEN', 'MX_PAT', 'MENDIX_PAT'] as const;

const same = (a: string, b: string) => (process.platform === 'win32' ? path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase() : path.resolve(a) === path.resolve(b));

/** Whether agents on the project in `floorDir` get the Mendix token: on everywhere unless switched off there. */
export const mendixOn = (floorDir: string | undefined): boolean => !!floorDir && !(officeSettings().mendixOffFloors ?? []).some((d) => same(d, floorDir));

export function withConnections(env: Record<string, string>, floorDir?: string): Record<string, string> {
  const gh = credential('github-agents');
  if (gh) {
    env.GH_TOKEN = gh;
    env.GITHUB_TOKEN = gh;
  }
  // An Anthropic API key saved in Connections (first-run setup's other way to sign Claude Code in).
  const key = stored('anthropic');
  if (key) env.ANTHROPIC_API_KEY = key;
  for (const k of MENDIX_VARS) delete env[k];
  if (mendixOn(floorDir)) {
    const mx = credential('mendix');
    if (mx) for (const k of MENDIX_VARS) env[k] = mx;
  }
  // The mxcli picked in first-run setup: its folder first on PATH, so agents' `mxcli` is that one.
  const mxcli = officeSettings().mxcliPath;
  if (mxcli) {
    const key = Object.keys(env).find((k) => k.toUpperCase() === 'PATH') ?? 'PATH';
    const dir = path.dirname(mxcli);
    if (!(env[key] ?? '').split(path.delimiter).some((d) => same(d || '.', dir))) env[key] = [dir, env[key]].filter(Boolean).join(path.delimiter);
  }
  const who = officeSettings().gitIdentity;
  if (who) {
    env.GIT_AUTHOR_NAME ??= who.name;
    env.GIT_AUTHOR_EMAIL ??= who.email;
    env.GIT_COMMITTER_NAME ??= who.name;
    env.GIT_COMMITTER_EMAIL ??= who.email;
  }
  return env;
}
