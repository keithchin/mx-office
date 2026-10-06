// The Mendix app itself. A brand-new project gets one from Studio Pro's own `mx create-project` (the
// Blank template), made at the repository's root: that's where the toolkit looks for it (init-project.sh
// names it in CLAUDE.local.md's "Project MPR" row, project-bin's find_mpr tries the root and then app/,
// and the live app's findMpr the top and then one folder down). A Studio Pro without mx falls back to
// `mxcli new`. Also here: the .gitignore lines that keep Mendix's generated files out of the scaffold's
// commit, and reading which Studio Pro an existing app was last saved with.

import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ProjectPlan } from '../../shared/wizard.js';
import { findMpr } from '../liveapp/checkout.js';
import { mxPath, type WizardConfig } from './config.js';
import type { runCommand } from './run.js';

const MIN = 60_000;
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A Mendix Portal app id, cleaned: a GUID, or nothing. */
export const cleanAppId = (v: unknown): string | undefined => (typeof v === 'string' && GUID.test(v.trim()) ? v.trim().toLowerCase() : undefined);

/** The app's name from the repository's: "travel-approval" → "TravelApproval" (an .mpr name Studio Pro shows as is). */
export function appNameOf(slug: string): string {
  const name = slug
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join('');
  return /^[A-Za-z]/.test(name) ? name : `App${name}`;
}

/**
 * What a Mendix project makes that is never committed: the build output and its caches, the per-user
 * settings, the lock and backup files, MPR v2's journal, and mxcli's local copy. The list Studio Pro's
 * own Git support writes, plus theme-cache (mxbuild regenerates it, so tracking it dirties every clone).
 */
export const MENDIX_IGNORES = [
  '/**/node_modules/',
  '!/javascriptsource/**/node_modules/',
  '/*.launch',
  '/.classpath',
  '/.project',
  '/.mendix-cache/',
  '/deployment/',
  '/releases/',
  '/packages/',
  '/theme-cache/',
  '/javasource/*/proxies/',
  '/javasource/system/',
  '/modeler-merge-marker',
  '/nativemobile/builds/',
  '/project-settings.user.json',
  '/vendorlib/temp/',
  '/mprcontents/mprjournal*',
  '*.mpr.lock',
  '*.mpr.bak',
  '/mxcli',
  '/mxcli.exe',
  '/.mxcli/',
];
const HEADER = '# Mendix project (written by the agent-office new-project wizard)';

/** A .gitignore's text with every Mendix line in it: the missing ones added under one header, nothing added twice. */
export function withMendixIgnores(text: string): string {
  const have = new Set(text.replace(/\r/g, '').split('\n').map((l) => l.trim()));
  const missing = MENDIX_IGNORES.filter((l) => !have.has(l));
  if (!missing.length) return text;
  const sep = !text ? '' : text.endsWith('\n') ? '\n' : '\n\n';
  return `${text}${sep}${have.has(HEADER) ? '' : `${HEADER}\n`}${missing.join('\n')}\n`;
}

/** Puts the Mendix lines in the project's .gitignore; true when it changed. */
export function ignoreMendixOutput(dir: string): boolean {
  const f = path.join(dir, '.gitignore');
  const before = existsSync(f) ? readFileSync(f, 'utf8') : '';
  const after = withMendixIgnores(before);
  if (after === before) return false;
  writeFileSync(f, after);
  return true;
}

export interface AppRun {
  run: typeof runCommand;
  env: Record<string, string>;
  onLine(line: string): void;
}

/**
 * Makes the Mendix app in `dir` (a clone with a README already in it): Studio Pro's mx when the picked
 * version has one, else `mxcli new` into a scratch folder whose files are then moved in (it wants a
 * folder of its own). Says how it was made; throws when there was no way to, or no .mpr came of it.
 */
export async function createApp(cfg: WizardConfig, plan: ProjectPlan, dir: string, r: AppRun): Promise<string> {
  const name = appNameOf(plan.name);
  const mx = mxPath(cfg, plan.mendix);
  let how: string;
  if (existsSync(mx)) {
    const args = ['create-project', '--app-name', name, '--output-dir', dir];
    if (plan.sprintrAppId) args.push('--sprintr-app-id', plan.sprintrAppId);
    await r.run(mx, args, { cwd: dir, env: r.env, timeoutMs: 10 * MIN, onLine: r.onLine });
    how = `Studio Pro ${plan.mendix}'s mx create-project`;
  } else if (cfg.mxcli) {
    // mxcli new downloads MxBuild for the version first: slower, and it wants a folder of its own.
    const scratch = mkdtempSync(path.join(os.tmpdir(), 'wizard-app-'));
    try {
      const out = path.join(scratch, name);
      await r.run(cfg.mxcli, ['new', name, '--version', plan.mendix, '--output-dir', out, '--skip-init', '--skip-build'], { cwd: scratch, env: r.env, timeoutMs: 30 * MIN, onLine: r.onLine });
      // The project's own README, .gitignore and agent files stay; everything else of the app moves in.
      for (const entry of readdirSync(out)) if (!existsSync(path.join(dir, entry))) cpSync(path.join(out, entry), path.join(dir, entry), { recursive: true });
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
    how = `mxcli new (no mx in Studio Pro ${plan.mendix})`;
  } else {
    throw new Error(`Neither Studio Pro's mx (${mx}) nor mxcli is on the office's machine, so there's nothing to create the app with`);
  }
  const mpr = findMpr(dir);
  if (!mpr) throw new Error(`${how} finished but no .mpr turned up in ${dir}`);
  return `${path.relative(dir, mpr)} with ${how}`;
}

/** The Studio Pro version an app was last saved with (`mx show-version`, with the newest mx installed), or undefined. */
export async function mprVersion(cfg: WizardConfig, mpr: string, versions: string[], run: typeof runCommand): Promise<string | undefined> {
  const mx = versions.map((v) => mxPath(cfg, v)).find((p) => existsSync(p));
  if (!mx) return undefined;
  const out = await run(mx, ['show-version', mpr], { cwd: path.dirname(mpr), timeoutMs: MIN, allowFail: true }).catch(() => undefined);
  return out?.code === 0 ? /\b(\d+\.\d+\.\d+(?:\.\d+)?)\b/.exec(out.stdout)?.[1] : undefined;
}
