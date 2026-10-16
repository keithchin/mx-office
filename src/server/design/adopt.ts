// Putting a package version into a project, the two ways:
//   - a NEW project (the wizard's design step, after the app is created and before the setup's commit):
//     applied in place, here, the setup's own commit takes it;
//   - an EXISTING app, only after the Project Manager pressed Adopt on the ✋ card: ./adoption.ts, an operation
//     with stages (apply on a branch of its own → commit → push → merge → activate); the binding changes only
//     once the candidate is merged into the default branch.
// The in-place apply writes its step record before mxcli runs (started → done | failed): a restart or a Retry
// with the same binding never applies twice (done: skipped; started: mxcli's idempotent apply runs again and
// says `unchanged`). A project whose styling is its own (custom rules, overridden Atlas variables, theme modules)
// is never applied by the wizard: it gets the ✋ card instead.

import path from 'node:path';
import { findMpr } from '../liveapp/checkout.js';
import type { PackageManifest, ProjectDesignBinding, StartPoint } from '../../shared/design/types.js';
import { applyPackage, mxcliVersion, type Run } from './apply.js';
import type { DesignProjects } from './projects.js';
import { scanTheme, scanWords } from './scan.js';

export interface AdoptEnv {
  projects: DesignProjects;
  packageDir(id: string, n: number): string;
  mxcli(): string | undefined;
  run?: Run;
  now(): number;
  log?(line: string): void;
}

export type AdoptResult = { ok: true; detail: string; binding: ProjectDesignBinding } | { ok: false; detail: string; custom?: boolean };

const keyOf = (floor: string, digest: string) => `${floor}|${digest}`;

export function bindingOf(m: PackageManifest, approval: ProjectDesignBinding['approval'], start: StartPoint | undefined): ProjectDesignBinding {
  return { systemId: m.id, name: m.name, n: m.version, digest: m.digest, kind: m.kind, ...(m.themeName ? { themeName: m.themeName } : {}), preset: m.preset, approval, exceptions: [], ...(start ? { start } : {}) };
}

/** Applies `m` to the app in `dir` (where it is now): the wizard's step. */
export async function applyInPlace(env: AdoptEnv, floor: string, dir: string, m: PackageManifest, approval: ProjectDesignBinding['approval']): Promise<AdoptResult> {
  const key = keyOf(floor, m.digest);
  const was = env.projects.binding(floor);
  if (was?.digest === m.digest && env.projects.apply(floor)?.key === key && env.projects.apply(floor)?.state === 'done') return { ok: true, detail: `${m.name} v${m.version} is already applied`, binding: was };
  const mpr = findMpr(dir);
  if (!mpr) return { ok: false, detail: 'no .mpr in the project: nothing to apply the design system to' };
  const appDir = path.dirname(mpr);
  const scan = await scanTheme(appDir);
  // The theme this very binding applied before a restart reads as an mxcli start: that's the binding's own.
  const own = scan.start === `mxcli:${m.themeName}`;
  const start = own ? (was?.start ?? scan.start) : scan.start;
  if (start === 'custom') return { ok: false, custom: true, detail: `the app already has ${scanWords(scan)}: not applied; the Project Manager decides on the ✋ card` };
  if (m.kind === 'atlas') {
    const b = bindingOf(m, approval, start);
    await env.projects.bind(floor, dir, b);
    await env.projects.setApply(floor, { key, state: 'done', at: env.now(), detail: 'Atlas defaults: no theme change' });
    return { ok: true, detail: `${m.name} v${m.version} (Atlas defaults) recorded; the theme is left as it is (${scanWords(scan)})`, binding: b };
  }
  return runApply(env, floor, dir, appDir, mpr, m, approval, start);
}

async function runApply(env: AdoptEnv, floor: string, recordDir: string | undefined, appDir: string, mpr: string, m: PackageManifest, approval: ProjectDesignBinding['approval'], start: StartPoint): Promise<AdoptResult> {
  const mxcli = env.mxcli();
  if (!mxcli) return { ok: false, detail: 'mxcli isn’t set up on the office’s machine (🔌 Connections › Paths): the design system can’t be applied' };
  const key = keyOf(floor, m.digest);
  await env.projects.setApply(floor, { key, state: 'started', at: env.now() });
  const version = await mxcliVersion(mxcli, env.run);
  const r = await applyPackage({ appDir, mpr, themeName: m.themeName!, tokensFile: path.join(env.packageDir(m.id, m.version), 'tokens.css'), title: `${m.name} v${m.version}`, mxcli, run: env.run, log: env.log });
  if (!r.ok) {
    await env.projects.setApply(floor, { key, state: 'failed', at: env.now(), detail: r.detail.slice(0, 300) });
    return { ok: false, detail: r.detail };
  }
  const warnings = version !== m.compat.mxcli ? [`Applied with mxcli ${version}; the package was published with mxcli ${m.compat.mxcli}.`] : undefined;
  const b: ProjectDesignBinding = { ...bindingOf(m, approval, start), applied: { at: env.now(), fences: r.fences, mxcli: version }, ...(warnings ? { warnings } : {}) };
  await env.projects.bind(floor, recordDir, b);
  await env.projects.setApply(floor, { key, state: 'done', at: env.now(), detail: r.detail.slice(0, 300) });
  return { ok: true, detail: r.detail, binding: b };
}
