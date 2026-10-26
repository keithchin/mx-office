// The office's own calls to mxcli for the Marketplace, each a child process with stdin closed and a time limit
// (wizard/run.ts): `marketplace info` (the item's title, publisher and licence for the card) and `marketplace
// download` (the .mpk), both with the office's Mendix token as MENDIX_PAT in THAT child's environment only, and
// `marketplace install --file` for a module (no token at all). Every child gets a home folder of its own, so
// mxcli can't fall back on a login stored in the machine user's ~/.mxcli, and the office's environment with
// every GitHub, Mendix and Claude token taken out. What a child says is redacted before anyone sees it.

import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runCommand, type RunOptions, type RunResult } from '../wizard/run.js';
import { redactor } from '../wizard/admin-token.js';
import type { MarketplaceInfo } from '../../shared/marketplace.js';

export type Run = (cmd: string, args: string[], opts: RunOptions) => Promise<RunResult>;

/** Variables never passed to these children (the token goes in by name, only where it's needed). */
export const SCRUBBED_VARS = ['MENDIX_PAT', 'MENDIX_TOKEN', 'MX_PAT', 'MXCLI_PROFILE', 'GH_TOKEN', 'GITHUB_TOKEN', 'GH_ENTERPRISE_TOKEN', 'GITHUB_ENTERPRISE_TOKEN', 'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'TYPESAFE_API_KEY'];

/** A child's environment: the office's, scrubbed, with `home` as its home folder and `extra` on top. */
export function childEnv(home: string, extra: Record<string, string> = {}, base: NodeJS.ProcessEnv = process.env): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(base)) if (!SCRUBBED_VARS.includes(k.toUpperCase())) env[k] = v;
  env.HOME = home;
  env.USERPROFILE = home;
  env.GH_PROMPT_DISABLED = '1';
  env.GIT_TERMINAL_PROMPT = '0';
  return { ...env, ...extra };
}

/** Runs `fn` with a fresh, empty home folder, removed afterwards. */
export async function withHome<T>(fn: (home: string) => Promise<T>): Promise<T> {
  const home = await mkdtemp(path.join(os.tmpdir(), 'mx-office-mkt-'));
  try {
    return await fn(home);
  } finally {
    await rm(home, { recursive: true, force: true }).catch(() => undefined);
  }
}

export interface MxcliCall {
  mxcli: string;
  token?: string;
  run?: Run;
  cwd: string;
}

/** What a failed child said, redacted, in a line. */
export const said = (r: RunResult, token?: string) => {
  const hide = redactor([token]);
  return hide(r.tail.filter((l) => !/vibe-coded PoC/i.test(l)).slice(-3).join(' ').slice(0, 400)) || `mxcli exited with ${r.code}`;
};

/** Downloads item `id` at `version` (the latest without one) to `out`; the error in words, or undefined. */
export async function download(c: MxcliCall, id: string, version: string | undefined, out: string): Promise<string | undefined> {
  if (!c.token) return 'no Mendix token';
  const run = c.run ?? runCommand;
  return withHome(async (home) => {
    const args = ['marketplace', 'download', id, ...(version ? ['--version', version] : []), '-o', out];
    const r = await run(c.mxcli, args, { cwd: c.cwd, env: childEnv(home, { MENDIX_PAT: c.token! }), timeoutMs: 180_000, allowFail: true });
    return r.code === 0 ? undefined : `mxcli couldn’t download it: ${said(r, c.token)}`;
  });
}

const pick = (o: Record<string, unknown>, keys: string[]): string | undefined => {
  for (const k of keys) {
    const v = o[k];
    if (typeof v === 'string' && v.trim()) return v.trim().slice(0, 160);
    if (v && typeof v === 'object' && typeof (v as { name?: unknown }).name === 'string') return String((v as { name: string }).name).slice(0, 160);
  }
  return undefined;
};

/** The item's title, publisher and licence (`mxcli marketplace info <id> --json`), or nothing when it can't be read. */
export async function lookUp(c: MxcliCall, id: string): Promise<MarketplaceInfo | undefined> {
  if (!c.token) return undefined;
  const run = c.run ?? runCommand;
  try {
    return await withHome(async (home) => {
      const r = await run(c.mxcli, ['marketplace', 'info', id, '--json'], { cwd: c.cwd, env: childEnv(home, { MENDIX_PAT: c.token! }), timeoutMs: 30_000, allowFail: true });
      if (r.code !== 0) return undefined;
      const json = r.stdout.slice(r.stdout.indexOf('{'));
      const o = JSON.parse(json) as Record<string, unknown>;
      const info: MarketplaceInfo = {
        title: pick(o, ['name', 'title', 'displayName']),
        publisher: pick(o, ['publisher', 'vendor', 'author', 'company', 'supplier']),
        licence: pick(o, ['license', 'licence', 'licenseType', 'licenseName']),
        latest: pick(o, ['latestVersion', 'version', 'latest']),
      };
      return Object.values(info).some(Boolean) ? info : undefined;
    });
  } catch {
    return undefined;
  }
}

/** Installs module package `file` into the app at `mpr` (`mxcli marketplace install --file`, no token); the error in words, or undefined. */
export async function installModule(c: MxcliCall, file: string, mpr: string): Promise<string | undefined> {
  const run = c.run ?? runCommand;
  return withHome(async (home) => {
    const r = await run(c.mxcli, ['marketplace', 'install', '--file', file, '-p', mpr], { cwd: c.cwd, env: childEnv(home), timeoutMs: 300_000, allowFail: true });
    return r.code === 0 ? undefined : `mxcli couldn’t install the module: ${said(r)}`;
  });
}
