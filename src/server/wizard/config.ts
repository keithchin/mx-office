// Where the wizard finds what it needs on the office's machine: the toolkit clone, Git Bash, mxcli,
// jq, Python, the Studio Pro installs, the GitHub organization new projects go in, and the admin
// token's file. Each comes from an environment variable when set, or else from where it usually is,
// so a machine set up the usual way needs no configuration at all.

import { existsSync, readdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { adminTokenFile } from './admin-token.js';
import { withGitLongPaths } from '../gitenv.js';
import { firstExisting, officeSettings, toolkitDir } from '../connections/store.js';
import { macBundleOf, macBundles } from '../studio/mac.js';
import type { OrgSource } from '../../shared/first-run.js';

export interface WizardConfig {
  /** The mxcli-project-toolkit clone (picked in 🔌 Connections › Paths, else AGENT_OFFICE_TOOLKIT_DIR). */
  toolkitDir: string;
  /** Git Bash, which runs the toolkit's scripts (AGENT_OFFICE_BASH); on macOS Homebrew's bash (the system's is 3.2). */
  bash: string;
  /** The mxcli the toolkit's `mxcli init` should use (first-run setup's, else AGENT_OFFICE_MXCLI). */
  mxcli?: string;
  /** The folder jq is in (AGENT_OFFICE_JQ_DIR). */
  jqDir?: string;
  /** Python for the toolkit's helpers, written into toolkit.env (AGENT_OFFICE_PYTHON). */
  python?: string;
  /** Where Studio Pro versions are installed, one folder each (AGENT_OFFICE_MENDIX_DIR); on macOS /Applications, one app bundle each. */
  mendixDir: string;
  /** The organization new repositories go in by default (first-run setup's, else AGENT_OFFICE_PROJECT_ORG). */
  org: string;
  adminTokenFile: string;
  /**
   * AGENT_OFFICE_WIZARD_OFFLINE: a folder. When set, "GitHub" is local bare repositories in it, and
   * issues are files: for a test office, so the whole setup runs for real without touching GitHub.
   */
  offlineDir?: string;
}

const isWin = process.platform === 'win32';
const isMac = process.platform === 'darwin';

/** Homebrew's bash on macOS (Apple silicon, then Intel): the toolkit's scripts need bash 4 or newer, and macOS's own is 3.2. */
export const MAC_BASHES = ['/opt/homebrew/bin/bash', '/usr/local/bin/bash'];

function firstDir(parent: string, match: RegExp): string | undefined {
  try {
    const hit = readdirSync(parent)
      .filter((d) => match.test(d))
      .sort()
      .reverse()[0];
    return hit ? path.join(parent, hit) : undefined;
  } catch {
    return undefined;
  }
}

export type MxcliSource = 'settings' | 'env' | 'workspace';

/**
 * The office's own mxcli, however the office was started: the one picked in first-run setup, else
 * AGENT_OFFICE_MXCLI, else the workspace's (<home>/agent-spike/tools/mxcli, or bin/ before the layout
 * change), the one scripts/start-office.ps1 puts first on PATH. So an office the desktop app starts (no
 * launcher, none of its variables) runs the same mxcli as one the launcher starts, and never an older
 * `mxcli` that happens to be on PATH while the workspace has its own.
 */
export function officeMxcli(env: NodeJS.ProcessEnv = process.env, home = os.homedir()): { path: string; source: MxcliSource } | undefined {
  const saved = officeSettings().mxcliPath;
  if (saved) return { path: saved, source: 'settings' };
  if (env.AGENT_OFFICE_MXCLI) return { path: env.AGENT_OFFICE_MXCLI, source: 'env' };
  const exe = isWin ? 'mxcli.exe' : 'mxcli';
  const ours = firstExisting([path.join(home, 'agent-spike', 'tools', 'mxcli', exe), path.join(home, 'agent-spike', 'bin', exe)]);
  return existsSync(ours) ? { path: ours, source: 'workspace' } : undefined;
}

export function wizardConfig(env: NodeJS.ProcessEnv = process.env): WizardConfig {
  const home = os.homedir();
  const local = env.LOCALAPPDATA ?? path.join(home, 'AppData', 'Local');
  const gitBash = 'C:\\Program Files\\Git\\bin\\bash.exe';
  const pyDir = firstDir(path.join(local, 'Python'), /^pythoncore-/);
  return {
    toolkitDir: toolkitDir(env),
    bash: env.AGENT_OFFICE_BASH || (isWin && existsSync(gitBash) ? gitBash : isMac ? (MAC_BASHES.find((b) => existsSync(b)) ?? 'bash') : 'bash'),
    mxcli: officeMxcli(env, home)?.path,
    jqDir: env.AGENT_OFFICE_JQ_DIR || (isWin ? firstDir(path.join(local, 'Microsoft', 'WinGet', 'Packages'), /^jqlang\.jq/) : undefined),
    python: env.AGENT_OFFICE_PYTHON || (pyDir && existsSync(path.join(pyDir, 'python.exe')) ? path.join(pyDir, 'python.exe') : undefined),
    mendixDir: env.AGENT_OFFICE_MENDIX_DIR || (isWin ? 'C:\\Program Files\\Mendix' : isMac ? '/Applications' : '/opt/mendix'),
    org: projectOrg(env).value,
    adminTokenFile: adminTokenFile(env),
    offlineDir: env.AGENT_OFFICE_WIZARD_OFFLINE ? path.resolve(env.AGENT_OFFICE_WIZARD_OFFLINE) : undefined,
  };
}

/**
 * The organization new projects go in: the one picked in first-run setup, else AGENT_OFFICE_PROJECT_ORG,
 * else the organization offices used before there was a setting (so an existing office carries on as it was).
 */
export const LEGACY_PROJECT_ORG = 'AI-Taskforce-Labs';
export function projectOrg(env: NodeJS.ProcessEnv = process.env): { value: string; source: OrgSource } {
  const saved = officeSettings().projectOrg;
  if (saved) return { value: saved, source: 'settings' };
  if (env.AGENT_OFFICE_PROJECT_ORG) return { value: env.AGENT_OFFICE_PROJECT_ORG, source: 'env' };
  return { value: LEGACY_PROJECT_ORG, source: 'default' };
}

const ver = (v: string) => v.split('.').map((n) => Number.parseInt(n, 10) || 0);
const newerFirst = (a: string, b: string) => {
  const [x, y] = [ver(a), ver(b)];
  for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (y[i] ?? 0) - (x[i] ?? 0);
  return 0;
};

const fsDeps = { exists: existsSync, readdir: (p: string) => readdirSync(p) };

/** The Studio Pro versions installed (each a folder with modeler/mxbuild; on macOS also each "Mendix Studio Pro <version>.app" bundle), newest first. */
export function mendixVersions(dir: string, platform: NodeJS.Platform = process.platform): string[] {
  let found: string[] = [];
  try {
    found = readdirSync(dir).filter((d) => /^\d+\.\d+\.\d+/.test(d) && existsSync(path.join(dir, d, 'modeler', platform === 'win32' ? 'mxbuild.exe' : 'mxbuild')));
  } catch {
    found = [];
  }
  if (platform === 'darwin') for (const b of macBundles(dir, fsDeps, 'mxbuild')) if (!found.includes(b.version)) found.push(b.version);
  return found.sort(newerFirst);
}

/** A version's modeler folder (where mxbuild and mx are): <dir>/<version>/modeler, or on macOS that version's app bundle's. */
function modelerDir(cfg: WizardConfig, version: string, platform: NodeJS.Platform = process.platform): string {
  const plain = path.join(cfg.mendixDir, version, 'modeler');
  if (platform !== 'darwin' || existsSync(plain)) return plain;
  return macBundleOf(macBundles(cfg.mendixDir, fsDeps), version)?.modeler ?? plain;
}

/** The line new projects start on: the newest 11.12 patch installed is the default. */
export const PREFERRED_LINE = '11.12.';
/** mxcli's validated line: the default when no 11.12 is installed but it is. */
export const PREFERRED_MENDIX = '11.6.4';

/** The version the wizard preselects: the newest 11.12.x, else mxcli's validated 11.6.4, else the newest installed. */
export function defaultMendix(versions: string[]): string {
  return [...versions].sort(newerFirst).find((v) => v.startsWith(PREFERRED_LINE)) ?? (versions.includes(PREFERRED_MENDIX) ? PREFERRED_MENDIX : (versions[0] ?? ''));
}

/** The version new projects start on: the one picked in first-run setup when it's installed, else defaultMendix's pick. */
export function preferredMendix(versions: string[]): string {
  const saved = officeSettings().defaultMendix;
  return saved && versions.includes(saved) ? saved : defaultMendix(versions);
}

export function mxbuildPath(cfg: WizardConfig, version: string): string {
  return path.join(modelerDir(cfg, version), isWin ? 'mxbuild.exe' : 'mxbuild');
}

/** Studio Pro's command-line tool (mx create-project, mx show-version), next to mxbuild. */
export function mxPath(cfg: WizardConfig, version: string): string {
  return path.join(modelerDir(cfg, version), isWin ? 'mx.exe' : 'mx');
}

/** What's missing for the toolkit to run, in words for the wizard's first page. */
export function configProblems(cfg: WizardConfig, versions: string[]): string[] {
  const out: string[] = [];
  if (!existsSync(path.join(cfg.toolkitDir, 'bin', 'init-project.sh'))) out.push(`The mxcli-project-toolkit isn't at ${cfg.toolkitDir} (pick its clone in ☰ → 🔌 Connections › Paths, or set AGENT_OFFICE_TOOLKIT_DIR)`);
  if (isWin && !existsSync(cfg.bash)) out.push(`Git Bash isn't at ${cfg.bash} (set AGENT_OFFICE_BASH)`);
  if (isMac && cfg.bash === 'bash') out.push('The toolkit needs bash 4 or newer and macOS’s own is 3.2: install it with brew install bash (or set AGENT_OFFICE_BASH)');
  if (!cfg.mxcli) out.push('No mxcli found (set AGENT_OFFICE_MXCLI to mxcli.exe)');
  if (isWin && !cfg.jqDir) out.push('No jq found (install it with winget install jqlang.jq, or set AGENT_OFFICE_JQ_DIR)');
  if (!versions.length) out.push(isMac ? `No Studio Pro for Mac in ${cfg.mendixDir} (a "Mendix Studio Pro <version>.app"; set AGENT_OFFICE_MENDIX_DIR)` : `No Studio Pro under ${cfg.mendixDir} (set AGENT_OFFICE_MENDIX_DIR)`);
  return out;
}

/** The environment the toolkit's scripts run in: the office's, with our mxcli and jq first on PATH and the toolkit's first-run guide off. */
export function toolkitEnv(cfg: WizardConfig, base: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(base)) if (v !== undefined) env[k] = v;
  const pathKey = Object.keys(env).find((k) => k.toUpperCase() === 'PATH') ?? 'PATH';
  const extra = [cfg.mxcli && path.dirname(cfg.mxcli), cfg.jqDir].filter((d): d is string => !!d);
  env[pathKey] = [...extra, env[pathKey] ?? ''].join(path.delimiter);
  env.MXTK_NO_GUIDE = '1';
  env.GIT_TERMINAL_PROMPT = '0';
  // The setup's git, gh and toolkit scripts have long paths on Windows even with a test's own base env (gitenv.ts).
  return withGitLongPaths(env);
}
