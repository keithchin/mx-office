// Opening a floor's Mendix project in Studio Pro on the office's machine: the .mpr in the floor's own
// checkout (never the live app's clone), handed to Mendix's Version Selector, which reads the
// project's version and starts the matching Studio Pro. Without the Version Selector, the
// studiopro.exe of that version (or the newest, when the version can't be read). Windows only, and
// only where there's a desktop to open it on. Nothing a browser sends picks what runs: the program
// is found here, and the project is the floor's.

import { spawn as nodeSpawn } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { onDesktop } from '../browser.js';
import { findMpr as findMprIn } from '../liveapp/checkout.js';
import type { StudioProblem } from '../../shared/studio.js';

/** What it takes from the machine, so the tests can stand in for it (and never start Studio Pro). */
export interface StudioDeps {
  platform: NodeJS.Platform;
  env: NodeJS.ProcessEnv;
  exists(p: string): boolean;
  readdir(p: string): string[];
  findMpr(dir: string): string | undefined;
  /** The Mendix version the project was saved in ("11.6.4"), when it can be read. */
  readVersion(mpr: string): string | undefined;
  spawn(cmd: string, args: string[], opts: { detached: true; stdio: 'ignore'; windowsHide: false }): { on(ev: 'error', fn: (err: Error) => void): unknown; unref(): void };
}

/** The program that opens the project, and its arguments. */
export interface StudioLauncher {
  via: 'version-selector' | 'studiopro';
  cmd: string;
  args: string[];
}

export type StudioOpened = { ok: true; mpr: string; version?: string; via: StudioLauncher['via'] } | { ok: false; problem: StudioProblem; error: string };

/** What the floor's project looks like to Studio Pro, before anyone opens it. */
export interface StudioCheck {
  mpr?: string;
  version?: string;
  launcher?: StudioLauncher;
  problem?: StudioProblem;
  error?: string;
}

/** Where Mendix installs itself: C:\Program Files\Mendix. */
export const mendixDir = (env: NodeJS.ProcessEnv) => path.win32.join(env.ProgramFiles || 'C:\\Program Files', 'Mendix');

const parts = (v: string) => v.split('.').map(Number);
/** Newest first, by each number in turn ("11.12.0" before "11.9.1"). */
const newestFirst = (a: string, b: string) => {
  const x = parts(a);
  const y = parts(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) if ((y[i] ?? 0) !== (x[i] ?? 0)) return (y[i] ?? 0) - (x[i] ?? 0);
  return 0;
};

/**
 * How to open `mpr`: the Version Selector (`/file:<mpr>`, one argument however many spaces the path
 * has), else the installed studiopro.exe of `version` (an older or newer one would offer to convert
 * the project, so none is picked then), else the newest when the version isn't known.
 */
export function launcherFor(mpr: string, version: string | undefined, d: Pick<StudioDeps, 'env' | 'exists' | 'readdir'>): StudioLauncher | { problem: 'not-installed'; error: string } {
  const root = mendixDir(d.env);
  const selector = path.win32.join(root, 'Version Selector', 'VersionSelector.exe');
  if (d.exists(selector)) return { via: 'version-selector', cmd: selector, args: [`/file:${mpr}`] };
  let installed: string[] = [];
  try {
    installed = d.readdir(root).filter((v) => /^\d+(\.\d+)+$/.test(v) && d.exists(path.win32.join(root, v, 'modeler', 'studiopro.exe')));
  } catch {
    // No Mendix folder at all.
  }
  installed.sort(newestFirst);
  const pick = version ? installed.find((v) => v === version || v.startsWith(`${version}.`)) : installed[0];
  if (pick) return { via: 'studiopro', cmd: path.win32.join(root, pick, 'modeler', 'studiopro.exe'), args: [mpr] };
  if (version && installed.length) return { problem: 'not-installed', error: `Studio Pro ${version} isn't installed on the office's computer (it has ${installed.join(', ')}), and there's no Version Selector to fetch it` };
  return { problem: 'not-installed', error: `Studio Pro isn't installed on the office's computer (nothing in ${root})` };
}

/** Everything short of opening it: the project, its version, and what would open it (or why nothing can). */
export function checkStudio(dir: string, d: StudioDeps): StudioCheck {
  let mpr: string | undefined;
  try {
    mpr = d.findMpr(dir);
  } catch {
    mpr = undefined;
  }
  if (!mpr) return { problem: 'no-mpr', error: `No Mendix project (.mpr) in ${dir}` };
  const version = d.readVersion(mpr);
  if (!onDesktop(d.env, d.platform)) return { mpr, version, problem: 'no-desktop', error: "The office isn't running on a desktop (it's over SSH, in CI or headless), so there's nowhere to open Studio Pro" };
  if (d.platform !== 'win32') return { mpr, version, problem: 'not-windows', error: "Studio Pro runs on Windows only, and the office isn't on Windows" };
  const l = launcherFor(mpr, version, d);
  return 'problem' in l ? { mpr, version, ...l } : { mpr, version, launcher: l };
}

/** Opens the floor's project (`dir`, the floor's checkout) in Studio Pro, detached from the office. */
export function openInStudio(dir: string, d: StudioDeps = machine()): StudioOpened {
  const c = checkStudio(dir, d);
  if (!c.launcher || !c.mpr) return { ok: false, problem: c.problem ?? 'not-installed', error: c.error ?? "Studio Pro can't be opened here" };
  // Detached and let go of: Studio Pro outlives the office, and closing it is nothing to the office.
  const { cmd, args } = c.launcher;
  const child = d.spawn(cmd, args, { detached: true, stdio: 'ignore', windowsHide: false });
  child.on('error', (err) => console.error(`agent-office: couldn't start ${cmd}: ${err.message}`));
  child.unref();
  return { ok: true, mpr: c.mpr, ...(c.version ? { version: c.version } : {}), via: c.launcher.via };
}

const require = createRequire(import.meta.url);

/**
 * The version in the .mpr's _MetaData table (it's SQLite), read-only. Needs node:sqlite (Node 22.5
 * and up); without it, or with a file it can't read, no version.
 */
export function mprVersion(mpr: string): string | undefined {
  try {
    const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite');
    const db = new DatabaseSync(mpr, { readOnly: true });
    try {
      const row = db.prepare('SELECT _ProductVersion AS v FROM _MetaData LIMIT 1').get() as { v?: unknown } | undefined;
      return typeof row?.v === 'string' && /^\d+(\.\d+)+$/.test(row.v) ? row.v : undefined;
    } finally {
      db.close();
    }
  } catch {
    return undefined;
  }
}

/** This machine. */
export function machine(): StudioDeps {
  return {
    platform: process.platform,
    env: process.env,
    exists: existsSync,
    readdir: (p) => readdirSync(p),
    findMpr: findMprIn,
    readVersion: mprVersion,
    spawn: (cmd, args, opts) => nodeSpawn(cmd, args, opts),
  };
}
