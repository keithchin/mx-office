// Where the wizard finds what it needs on the office's machine: the toolkit clone, Git Bash, mxcli,
// jq, Python, the Studio Pro installs, the GitHub organization new projects go in, and the admin
// token's file. Each comes from an environment variable when set, or else from where it usually is,
// so a machine set up the usual way needs no configuration at all.

import { existsSync, readdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { adminTokenFile } from './admin-token.js';

export interface WizardConfig {
  /** The mxcli-project-toolkit clone (AGENT_OFFICE_TOOLKIT_DIR). */
  toolkitDir: string;
  /** Git Bash, which runs the toolkit's scripts (AGENT_OFFICE_BASH). */
  bash: string;
  /** The mxcli the toolkit's `mxcli init` should use (AGENT_OFFICE_MXCLI). */
  mxcli?: string;
  /** The folder jq is in (AGENT_OFFICE_JQ_DIR). */
  jqDir?: string;
  /** Python for the toolkit's helpers, written into toolkit.env (AGENT_OFFICE_PYTHON). */
  python?: string;
  /** Where Studio Pro versions are installed, one folder each (AGENT_OFFICE_MENDIX_DIR). */
  mendixDir: string;
  /** The organization new repositories go in by default (AGENT_OFFICE_PROJECT_ORG). */
  org: string;
  adminTokenFile: string;
  /**
   * AGENT_OFFICE_WIZARD_OFFLINE: a folder. When set, "GitHub" is local bare repositories in it, and
   * issues are files: for a test office, so the whole setup runs for real without touching GitHub.
   */
  offlineDir?: string;
}

const isWin = process.platform === 'win32';

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

export function wizardConfig(env: NodeJS.ProcessEnv = process.env): WizardConfig {
  const home = os.homedir();
  const local = env.LOCALAPPDATA ?? path.join(home, 'AppData', 'Local');
  const gitBash = 'C:\\Program Files\\Git\\bin\\bash.exe';
  const ourMxcli = path.join(home, 'agent-spike', 'bin', isWin ? 'mxcli.exe' : 'mxcli');
  const pyDir = firstDir(path.join(local, 'Python'), /^pythoncore-/);
  return {
    toolkitDir: env.AGENT_OFFICE_TOOLKIT_DIR || path.join(home, 'agent-spike', 'mxcli-project-toolkit'),
    bash: env.AGENT_OFFICE_BASH || (isWin && existsSync(gitBash) ? gitBash : 'bash'),
    mxcli: env.AGENT_OFFICE_MXCLI || (existsSync(ourMxcli) ? ourMxcli : undefined),
    jqDir: env.AGENT_OFFICE_JQ_DIR || (isWin ? firstDir(path.join(local, 'Microsoft', 'WinGet', 'Packages'), /^jqlang\.jq/) : undefined),
    python: env.AGENT_OFFICE_PYTHON || (pyDir && existsSync(path.join(pyDir, 'python.exe')) ? path.join(pyDir, 'python.exe') : undefined),
    mendixDir: env.AGENT_OFFICE_MENDIX_DIR || (isWin ? 'C:\\Program Files\\Mendix' : '/opt/mendix'),
    org: env.AGENT_OFFICE_PROJECT_ORG || 'AI-Taskforce-Labs',
    adminTokenFile: adminTokenFile(env),
    offlineDir: env.AGENT_OFFICE_WIZARD_OFFLINE ? path.resolve(env.AGENT_OFFICE_WIZARD_OFFLINE) : undefined,
  };
}

const ver = (v: string) => v.split('.').map((n) => Number.parseInt(n, 10) || 0);
const newerFirst = (a: string, b: string) => {
  const [x, y] = [ver(a), ver(b)];
  for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (y[i] ?? 0) - (x[i] ?? 0);
  return 0;
};

/** The Studio Pro versions installed (each a folder with modeler/mxbuild), newest first. */
export function mendixVersions(dir: string): string[] {
  try {
    return readdirSync(dir)
      .filter((d) => /^\d+\.\d+\.\d+/.test(d) && existsSync(path.join(dir, d, 'modeler', isWin ? 'mxbuild.exe' : 'mxbuild')))
      .sort(newerFirst);
  } catch {
    return [];
  }
}

/** mxcli's validated line: the default when it's installed. */
export const PREFERRED_MENDIX = '11.6.4';

export function mxbuildPath(cfg: WizardConfig, version: string): string {
  return path.join(cfg.mendixDir, version, 'modeler', isWin ? 'mxbuild.exe' : 'mxbuild');
}

/** What's missing for the toolkit to run, in words for the wizard's first page. */
export function configProblems(cfg: WizardConfig, versions: string[]): string[] {
  const out: string[] = [];
  if (!existsSync(path.join(cfg.toolkitDir, 'bin', 'init-project.sh'))) out.push(`The mxcli-project-toolkit isn't at ${cfg.toolkitDir} (set AGENT_OFFICE_TOOLKIT_DIR to its clone)`);
  if (isWin && !existsSync(cfg.bash)) out.push(`Git Bash isn't at ${cfg.bash} (set AGENT_OFFICE_BASH)`);
  if (!cfg.mxcli) out.push('No mxcli found (set AGENT_OFFICE_MXCLI to mxcli.exe)');
  if (isWin && !cfg.jqDir) out.push('No jq found (install it with winget install jqlang.jq, or set AGENT_OFFICE_JQ_DIR)');
  if (!versions.length) out.push(`No Studio Pro under ${cfg.mendixDir} (set AGENT_OFFICE_MENDIX_DIR)`);
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
  return env;
}
