// Putting a package version into a project, the two ways:
//   - a NEW project (the wizard's design step, after the app is created and before the setup's commit):
//     applied in place, the setup's own commit takes it;
//   - an EXISTING app, only after the Project Manager pressed Adopt on the ✋ card: applied in a temporary
//     worktree on a branch of its own (agent-office/design-<theme>), committed there and pushed as that branch
//     when the project has a remote (never to its default branch): the change is reviewed like any other.
// Both write the apply step record before mxcli runs (started → done | failed): a restart or a Retry with
// the same binding never applies twice (done: skipped; started: mxcli's idempotent apply runs again and says
// `unchanged`). A project whose styling is its own (custom rules, overridden Atlas variables, theme modules)
// is never applied by the wizard: it gets the ✋ card instead.

import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { findMpr } from '../liveapp/checkout.js';
import { gitRun, revParse } from '../toolkit-pin/git.js';
import type { PackageManifest, ProjectDesignBinding, StartPoint } from '../../shared/design/types.js';
import { applyPackage, mxcliVersion, type Run } from './apply.js';
import type { DesignProjects } from './projects.js';
import { writeProjectRecord } from './projects.js';
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

function bindingOf(m: PackageManifest, approval: ProjectDesignBinding['approval'], start: StartPoint | undefined): ProjectDesignBinding {
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

async function runApply(env: AdoptEnv, floor: string, recordDir: string | undefined, appDir: string, mpr: string, m: PackageManifest, approval: ProjectDesignBinding['approval'], start: StartPoint, branch?: string): Promise<AdoptResult> {
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
  const b: ProjectDesignBinding = { ...bindingOf(m, approval, start), applied: { at: env.now(), fences: r.fences, mxcli: version, ...(branch ? { branch } : {}) }, ...(warnings ? { warnings } : {}) };
  await env.projects.bind(floor, recordDir, b);
  await env.projects.setApply(floor, { key, state: 'done', at: env.now(), detail: r.detail.slice(0, 300) });
  return { ok: true, detail: r.detail, binding: b };
}

/** An existing app's adoption, after Adopt on the card: on a branch of its own in a temporary worktree. */
export async function applyOnBranch(env: AdoptEnv, floor: string, floorDir: string, m: PackageManifest, approval: ProjectDesignBinding['approval']): Promise<AdoptResult & { branch?: string; pushed?: boolean }> {
  const mprHere = findMpr(floorDir);
  if (!mprHere) return { ok: false, detail: 'no .mpr in the project: nothing to apply the design system to' };
  if (m.kind === 'atlas') {
    const scan = await scanTheme(path.dirname(mprHere));
    const b = bindingOf(m, approval, scan.start);
    // Atlas defaults change no file: the office's book records it (the project file isn't touched in a shared folder).
    await env.projects.bind(floor, undefined, b);
    await env.projects.setApply(floor, { key: keyOf(floor, m.digest), state: 'done', at: env.now(), detail: 'Atlas defaults: no theme change' });
    return { ok: true, detail: `${m.name} v${m.version} (Atlas defaults) recorded; no file changed`, binding: b };
  }
  const rel = path.relative(floorDir, mprHere);
  const base = await revParse(floorDir, 'HEAD');
  if (!base) return { ok: false, detail: 'the project folder has no commit to build on' };
  const branch = `agent-office/design-${m.themeName}`;
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'ao-design-'));
  let keep = false;
  try {
    await gitRun(['branch', '-D', branch], floorDir);
    const made = await gitRun(['worktree', 'add', '-b', branch, tmp, base], floorDir, 120_000);
    if (!made.ok) return { ok: false, detail: `couldn't check out the project: ${made.err.slice(0, 200)}` };
    const mpr = path.join(tmp, rel);
    const scan = await scanTheme(path.dirname(mpr));
    const r = await runApply(env, floor, undefined, path.dirname(mpr), mpr, m, approval, scan.start, branch);
    if (!r.ok) return r;
    await writeProjectRecord(tmp, r.binding);
    await gitRun(['-c', 'core.safecrlf=false', 'add', '-A'], tmp, 120_000);
    const who = (await gitRun(['config', 'user.email'], tmp)).out.trim() ? [] : ['-c', 'user.name=Agent Office', '-c', 'user.email=agent-office@localhost'];
    const c = await gitRun([...who, '-c', 'core.safecrlf=false', 'commit', '-q', '-m', `design: adopt ${m.name} v${m.version}`, '-m', `Branded Atlas package ${m.id} v${m.version} (digest ${m.digest}), applied with mxcli theme as ${m.themeName}. Approved by ${approval.by} on the decision card. Only theme/web, theme/mxcli-themes and agent-office.project.json change.`], tmp, 120_000);
    if (!c.ok) return { ok: false, detail: `the commit failed: ${c.err.slice(0, 200)}` };
    keep = true;
    const origin = (await gitRun(['remote', 'get-url', 'origin'], tmp)).ok;
    const pushed = origin && (await gitRun(['push', '-q', 'origin', `HEAD:refs/heads/${branch}`], tmp, 5 * 60_000)).ok;
    return { ...r, detail: `${r.detail}; committed on ${branch}${pushed ? ' and pushed' : ' (local branch)'}: merge it (or open a pull request) to adopt it on main`, branch, pushed };
  } finally {
    await gitRun(['worktree', 'remove', '--force', '--force', tmp], floorDir, 60_000);
    await rm(tmp, { recursive: true, force: true }).catch(() => undefined);
    await gitRun(['worktree', 'prune'], floorDir);
    if (!keep) await gitRun(['branch', '-D', branch], floorDir);
  }
}
