// The Mendix token the office's OWN Marketplace download uses (./download.ts), and only that: never put in
// an agent's environment by this feature, never logged, never in an audit record or a view.
//   - a real office: the Mendix credential of 🔌 Connections (saved there, else MENDIX_TOKEN / MX_PAT the
//     office was started with, else ~/Mendix/.env), as connections/resolve.ts resolves it;
//   - a test office: none (testcreds.ts withholds every outside token), unless it was started with
//     AGENT_OFFICE_TEST_ALLOW_MENDIX_MARKETPLACE=1: then MENDIX_PAT / MENDIX_TOKEN / MX_PAT from the environment
//     it was started with, nothing stored and no dot-file.

import { credential } from '../connections/resolve.js';
import { mendixMarketplaceAllowed, tokensWithheld, ALLOW_MENDIX_MARKETPLACE_ENV } from '../testcreds.js';

/** The variables the test switch reads the token from, in this order. */
export const MARKETPLACE_TOKEN_VARS = ['MENDIX_PAT', 'MENDIX_TOKEN', 'MX_PAT'] as const;

export interface TokenDeps {
  env: NodeJS.ProcessEnv;
  withheld: () => boolean;
  allowed: (env: NodeJS.ProcessEnv) => boolean;
  connections: () => string | undefined;
}

const defaults = (): TokenDeps => ({ env: process.env, withheld: tokensWithheld, allowed: mendixMarketplaceAllowed, connections: () => credential('mendix') });

/** The token for the office's own download, or why there is none (words for the card, never the value). */
export function marketplaceToken(deps: TokenDeps = defaults()): { token: string; source: 'connections' | 'test-switch' } | { why: string } {
  if (deps.withheld()) {
    if (!deps.allowed(deps.env)) return { why: `This is a test office: it holds no Mendix token (start it with ${ALLOW_MENDIX_MARKETPLACE_ENV}=1 and MENDIX_PAT set to let its own download use one). Use a package file instead.` };
    for (const k of MARKETPLACE_TOKEN_VARS) {
      const v = deps.env[k]?.trim();
      if (v) return { token: v, source: 'test-switch' };
    }
    return { why: `${ALLOW_MENDIX_MARKETPLACE_ENV} is on, but the office was started without MENDIX_PAT. Use a package file instead.` };
  }
  const t = deps.connections()?.trim();
  return t ? { token: t, source: 'connections' } : { why: 'The office has no Mendix token (🔌 Connections › Mendix). Add one there, or use a package file.' };
}
