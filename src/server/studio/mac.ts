// Studio Pro on macOS (preview: written without a Mac to try it on, see docs/site/get-started/new-machine.md).
// Mendix installs Studio Pro for Mac (11.x, Apple silicon, beta) from a .pkg as an app bundle per version,
// "/Applications/Mendix Studio Pro <X.Y.Z>[ suffix].app", with its command-line tools inside:
// Contents/modeler/mxbuild and Contents/modeler/mx. That's the layout mxcli itself resolves (mxcli's
// cmd/mxcli/docker/detect.go: resolveStudioProDirMacOS, matched on the X.Y.Z at the start of the name).
// There's no Version Selector on macOS, so opening a project picks the bundle of the project's version
// and starts it with `open -n -a <bundle> --args <mpr>` (a new instance, the .mpr as its argument, as
// studiopro.exe takes it on Windows). Detection reads `ps` for processes running out of such a bundle.
// AGENT_OFFICE_MENDIX_DIR points at another folder of bundles (as it points at another Mendix folder on Windows).

import path from 'node:path';
import type { StudioProcess } from './detect.js';

/** Where Studio Pro's app bundles are on macOS: AGENT_OFFICE_MENDIX_DIR, else /Applications. */
export const macAppsDir = (env: NodeJS.ProcessEnv) => env.AGENT_OFFICE_MENDIX_DIR || '/Applications';

/** "Mendix Studio Pro 11.12.4.app", "Mendix Studio Pro 11.10.0-rc.7 Beta.app": the X.Y.Z at its start. */
export const BUNDLE_RE = /^Mendix Studio Pro (\d+\.\d+\.\d+)[^/]*\.app$/;

export interface MacBundle {
  /** X.Y.Z, from the bundle's name. */
  version: string;
  /** The .app folder. */
  bundle: string;
  /** Contents/modeler, where mxbuild and mx are. */
  modeler: string;
}

const parts = (v: string) => v.split('.').map(Number);
const newestFirst = (a: string, b: string) => {
  const x = parts(a);
  const y = parts(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) if ((y[i] ?? 0) !== (x[i] ?? 0)) return (y[i] ?? 0) - (x[i] ?? 0);
  return 0;
};

/** The X.Y.Z of a version ("11.12.4.81234" → "11.12.4"), as bundles are named. */
export const baseVersion = (v: string) => v.split('.').slice(0, 3).join('.');

/** The Studio Pro bundles in `dir` (newest first), each with the file `need` in its modeler folder when given. */
export function macBundles(dir: string, d: { exists(p: string): boolean; readdir(p: string): string[] }, need?: 'mxbuild' | 'mx'): MacBundle[] {
  let names: string[] = [];
  try {
    names = d.readdir(dir);
  } catch {
    return [];
  }
  const out: MacBundle[] = [];
  for (const name of names.sort()) {
    const m = BUNDLE_RE.exec(name);
    if (!m) continue;
    const bundle = path.posix.join(dir, name);
    const modeler = path.posix.join(bundle, 'Contents', 'modeler');
    if (need && !d.exists(path.posix.join(modeler, need))) continue;
    if (!need && !d.exists(bundle)) continue;
    if (out.some((b) => b.version === m[1])) continue;
    out.push({ version: m[1], bundle, modeler });
  }
  return out.sort((a, b) => newestFirst(a.version, b.version));
}

/** The bundle of `version` (by its X.Y.Z), or undefined. */
export const macBundleOf = (bundles: readonly MacBundle[], version: string) => bundles.find((b) => b.version === baseVersion(version));

/**
 * How to open `mpr` on macOS: the bundle of the project's version (an older or newer one would offer to
 * convert it, so none is picked then), or the newest when the version isn't known.
 */
export function macLauncherFor(mpr: string, version: string | undefined, d: { env: NodeJS.ProcessEnv; exists(p: string): boolean; readdir(p: string): string[] }): { via: 'studiopro'; cmd: string; args: string[] } | { problem: 'not-installed'; error: string } {
  const dir = macAppsDir(d.env);
  const bundles = macBundles(dir, d);
  const pick = version ? macBundleOf(bundles, version) : bundles[0];
  if (pick) return { via: 'studiopro', cmd: '/usr/bin/open', args: ['-n', '-a', pick.bundle, '--args', mpr] };
  if (version && bundles.length) return { problem: 'not-installed', error: `Studio Pro ${version} isn't installed on the office's Mac (it has ${bundles.map((b) => b.version).join(', ')}): install it from the Mendix Marketplace (Download for Mac)` };
  return { problem: 'not-installed', error: `Studio Pro isn't installed on the office's Mac (no "Mendix Studio Pro <version>.app" in ${dir})` };
}

/** A process running out of a Studio Pro bundle, from `ps -axww -o pid=,command=` output. Helpers in nested bundles aren't. */
const PS_LINE = /^\s*(\d+)\s+(.*\/Mendix Studio Pro [^/]*\.app\/Contents\/MacOS\/.*)$/;

/** The Studio Pro processes in `ps -axww -o pid=,command=` output, with their command lines. */
export function parsePsStudio(out: string): StudioProcess[] {
  const procs: StudioProcess[] = [];
  for (const line of out.split(/\r?\n/)) {
    const m = PS_LINE.exec(line);
    if (m) procs.push({ pid: Number(m[1]), cmd: m[2].trim() });
  }
  return procs;
}
