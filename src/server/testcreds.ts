// A test office never reaches GitHub (or any other service) with real credentials. On 2026-10-11 a
// test office's Cancel & undo ran the machine's real gh with the GH_TOKEN it inherited from the shell
// that started it, and deleted a real repository. So when the office is in test mode (testmode.ts:
// --test-mode, AGENT_OFFICE_TEST_MODE, or its folder under scratch/test-offices / test-office…), it
// drops the GitHub variables from its own environment as it starts (cli.ts, before anything spawns
// gh or git or reads a token), points GH_CONFIG_DIR at an empty folder of its own (so a real gh has no
// stored login), clears git's credential helpers (so git's credential manager can't push either), and
// 🔌 Connections hands out no stored or launcher token (connections/resolve.ts). Every child, agents
// included, inherits the scrubbed environment. A test that drives a fake gh and needs "a token is
// there" sets AGENT_OFFICE_TEST_ALLOW_GH_TOKEN=1.

import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { CredentialId } from '../shared/connections.js';
import { isTestPath, testModeOf } from './testmode.js';

/** The GitHub variables a test office drops. */
export const GITHUB_TOKEN_VARS = ['GH_TOKEN', 'GITHUB_TOKEN', 'GH_ENTERPRISE_TOKEN', 'GITHUB_ENTERPRISE_TOKEN'] as const;

/** The explicit, test-only way to let tokens through (a test with a fake gh that needs one present). */
export const ALLOW_TOKEN_ENV = 'AGENT_OFFICE_TEST_ALLOW_GH_TOKEN';

let dropped = false;

const on = (v: string | undefined) => !!v && v !== '0';

/** Tokens were let through on purpose (tests with a fake gh only). */
export const tokensAllowed = (env: NodeJS.ProcessEnv = process.env): boolean => on(env[ALLOW_TOKEN_ENV]);

/** Whether this office dropped its credentials as it started (test mode). */
export const credentialsDropped = (): boolean => dropped;

/** What a test office never hands out: every token for an outside service (its password and web-push key are its own). */
export const OUTSIDE_CREDENTIALS: ReadonlySet<CredentialId> = new Set<CredentialId>(['github-agents', 'github-admin', 'mendix', 'anthropic', 'jev', 'teams-webhook']);

/** Test mode: no outside tokens, from Connections, the environment or a dot-file, unless a test with a fake gh lets them through. */
export const tokensWithheld = (): boolean => (dropped || testModeOf().on) && !tokensAllowed();

/** Whether a test office withholds credential `id` now. */
export const withheld = (id: CredentialId): boolean => OUTSIDE_CREDENTIALS.has(id) && tokensWithheld();

/** Whether an office started with `o` is in test mode, before testmode.ts has been told (cli.ts runs this first). */
export const startsInTestMode = (o: { testMode?: boolean; dir?: string }, env: NodeJS.ProcessEnv = process.env): boolean => !!o.testMode || on(env.AGENT_OFFICE_TEST_MODE) || isTestPath(o.dir);

/** The empty gh config folder of the test office in `dir`: its own, emptied each start. */
export function emptyGhConfigDir(dir: string): string {
  const key = createHash('sha256').update(path.resolve(dir).toLowerCase()).digest('hex').slice(0, 12);
  const p = path.join(os.tmpdir(), `agent-office-test-gh-${key}`);
  try {
    for (const f of readdirSync(p)) rmSync(path.join(p, f), { recursive: true, force: true });
  } catch {
    // not there yet
  }
  mkdirSync(p, { recursive: true });
  return p;
}

/**
 * In test mode: the GitHub variables out of `env`, GH_CONFIG_DIR an empty folder, git's credential
 * helpers cleared. Says so once. Returns whether it did anything (never outside test mode, nor with the
 * test-only override set).
 */
export function dropTestCredentials(o: { testMode?: boolean; dir?: string }, env: NodeJS.ProcessEnv = process.env, log: (line: string) => void = console.log): boolean {
  if (!startsInTestMode(o, env) || tokensAllowed(env)) return false;
  const had = GITHUB_TOKEN_VARS.filter((k) => env[k]);
  for (const k of GITHUB_TOKEN_VARS) delete env[k];
  env.GH_CONFIG_DIR = emptyGhConfigDir(o.dir ?? process.cwd());
  env.GH_PROMPT_DISABLED = '1';
  env.GIT_TERMINAL_PROMPT = '0';
  env.GCM_INTERACTIVE = 'never';
  // An empty credential.helper resets git's list: no credential manager answers for github.com.
  const n = Number.parseInt(env.GIT_CONFIG_COUNT ?? '', 10) || 0;
  env[`GIT_CONFIG_KEY_${n}`] = 'credential.helper';
  env[`GIT_CONFIG_VALUE_${n}`] = '';
  env.GIT_CONFIG_COUNT = String(n + 1);
  if (env === process.env) dropped = true;
  log(`  test mode: GitHub credentials dropped${had.length ? ` (${had.join(', ')})` : ''}; gh has an empty config (${env.GH_CONFIG_DIR}) and git no credential helper, and 🔌 Connections hands out no tokens`);
  return true;
}

/** Forgets that credentials were dropped (tests). */
export function forgetDroppedCredentials() {
  dropped = false;
}
