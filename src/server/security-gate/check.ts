// The office's own `mx check` of a project at one commit: Mendix's checker (Studio Pro's mx, beside the
// mxbuild the live app would use: liveapp/mxbuild.ts), run through `mxcli docker check`, which updates the
// pluggable widget definitions first so stale ones don't read as errors (CE0463). Not `mxcli check`, which
// only checks an MDL script and has passed models mx check then failed.
//
// It runs in the office's own copy of the app at that commit (app-instance/workspace.ts: <data>/testing/
// work/<project>/instance-mxcheck, updated in place from the project's git objects; never the project's
// checkout or an agent's worktree), off the event loop, one at a time office-wide (it's a heavy process),
// with a time limit. In test mode only a plainly fake mxcli runs (testing/mxcli-tool.ts). Every outcome is
// a result: a run that didn't reach a verdict is `error` with why, never a pass.

import path from 'node:path';
import { instanceDir } from '../app-instance/index.js';
import { markWorkspace, prepareWorkspace, type Workspace } from '../app-instance/workspace.js';
import { existsSync } from 'node:fs';
import { linuxMxbuildIn, linuxMxbuildMessage, pickMxbuild, studioProMxbuild, type MxbuildPick } from '../liveapp/mxbuild.js';
import { Limiter, stripNoise } from '../model/mxcli.js';
import { runMx, type MxOut } from '../testing/mxcli-run.js';
import { mxcliFor, type MxTool } from '../testing/mxcli-tool.js';
import { floorToolkitEnv } from '../toolkit-env.js';
import { parseMxCheck, stateFromShowJson, type MxCheckResult, type SecurityState } from '../../shared/security.js';

/** How long one check may take (a cold mx on a busy laptop takes minutes). */
export const CHECK_TIMEOUT_MS = 20 * 60_000;

export interface CheckDeps {
  dataDir: string;
  now(): number;
  tool(floorDir: string): Promise<MxTool | { why: string }>;
  prepare(floorDir: string, sha: string, dir: string, dataDir: string): Promise<Pick<Workspace, 'dir' | 'commit' | 'mpr'>>;
  pick(mpr: string, floorEnv: Record<string, string>): MxbuildPick;
  run(bin: string, args: string[], cwd: string, timeout: number): Promise<MxOut>;
  /** Marks the workspace's start as clean (nothing to clear next time); a no-op in tests. */
  mark?(dir: string, ws: Pick<Workspace, 'commit' | 'mpr'>): Promise<void>;
}

export const machineCheckDeps = (dataDir: string): CheckDeps => ({
  dataDir,
  now: Date.now,
  tool: (floorDir) => mxcliFor(dataDir, floorDir),
  prepare: prepareWorkspace,
  pick: (mpr, floorEnv) => pickForCheck(mpr, floorEnv),
  run: runMx,
  mark: (dir, ws) => markWorkspace(dir, ws, true),
});

/**
 * The mxbuild (and so the mx beside it) for a check: the live app's pick, except that the office's own MXBUILD_PATH
 * naming another Mendix version than the project's gives way to the installed Studio Pro of the project's version:
 * mx refuses a model of another version, where a live app may still be meant to build with the office's mxbuild.
 */
export function pickForCheck(mpr: string, floorEnv: Record<string, string>, pick = pickMxbuild, exists: (p: string) => boolean = existsSync, env: NodeJS.ProcessEnv = process.env): MxbuildPick {
  const p = pick(mpr, floorEnv);
  if (p.source !== 'office' || !p.version || !p.path || p.path.includes(p.version)) return p;
  const sp = studioProMxbuild(env, p.version);
  return exists(sp) ? { ...p, path: sp, source: 'studio-pro', skipped: [...p.skipped, `the office's MXBUILD_PATH (${p.path}) is not Mendix ${p.version}, the project's version`] } : p;
}

/** Heavy: one mx check at a time across the office. */
const heavy = new Limiter(1);

const lastWords = (o: MxOut) =>
  stripNoise(`${o.stderr}\n${o.stdout}`)
    .split('\n')
    .filter((l) => l.trim() && !/^\s*\[(error|warning)\]/i.test(l) && !/^\s+at\s/.test(l) && !/^\s*---/.test(l))
    .slice(-3)
    .join(' ')
    .slice(0, 400);

export interface CheckOutcome {
  result: MxCheckResult;
  /** `show project security` read in the same copy, when asked for (the units couldn't be read). */
  state?: SecurityState;
}

/** One mx check of `floor` at `sha`, by `by`; never rejects. */
export async function runMxCheck(d: CheckDeps, floor: { id: string; dir: string }, sha: string, by: string, alsoState = false): Promise<CheckOutcome> {
  const t0 = d.now();
  const err = (why: string, commit = sha, tool?: string): CheckOutcome => ({ result: { commit, at: d.now(), status: 'error', why, ms: d.now() - t0, ...(tool ? { tool } : {}), by } });
  const tool = await d.tool(floor.dir);
  if ('why' in tool) return err(tool.why);
  return heavy.run(async () => {
    let ws: Pick<Workspace, 'dir' | 'commit' | 'mpr'>;
    const dir = instanceDir(d.dataDir, floor.id, 'mxcheck');
    try {
      ws = await d.prepare(floor.dir, sha, dir, d.dataDir);
    } catch (e) {
      return err(`The office couldn't prepare its copy of the app: ${(e as Error).message}`, sha, `mxcli ${tool.version}`);
    }
    const mpr = path.join(ws.dir, ...ws.mpr.split('/'));
    const pick = d.pick(mpr, floorToolkitEnv(floor.dir));
    const args = ['docker', 'check', '-p', mpr, ...(pick.path ? ['--mxbuild-path', path.dirname(pick.path)] : [])];
    const out = await d.run(tool.bin, args, path.dirname(mpr), CHECK_TIMEOUT_MS);
    const text = `${out.stdout}\n${out.stderr}`;
    const label = `${pick.path ? path.join(path.dirname(pick.path), 'mx') : 'mx (found by mxcli)'} · mxcli ${tool.version}`;
    if (out.startError) return err(`mxcli didn't start: ${out.startError}`, ws.commit, label);
    if (out.killed) return err(`mx check ran past ${Math.round(CHECK_TIMEOUT_MS / 60_000)} min and was stopped`, ws.commit, label);
    const linux = linuxMxbuildIn(text.split('\n'));
    if (linux) return err(linuxMxbuildMessage(linux, pick, true, tool.bin), ws.commit, label);
    const p = parseMxCheck(text);
    let result: MxCheckResult;
    if (p.passed && out.code === 0) result = { commit: ws.commit, at: d.now(), status: 'pass', errors: 0, warnings: p.warnings, ms: d.now() - t0, tool: label, by };
    else if (p.errors !== undefined && p.errors > 0) result = { commit: ws.commit, at: d.now(), status: 'fail', errors: p.errors, warnings: p.warnings, codes: p.codes, first: p.first, ms: d.now() - t0, tool: label, by };
    else return err(`mx check gave no verdict (exit ${out.code ?? '?'}): ${lastWords(out) || 'no output'}`, ws.commit, label);
    let state: SecurityState | undefined;
    if (alsoState) {
      const s = await d.run(tool.bin, ['--json', '-p', mpr, '-c', 'show project security;'], path.dirname(mpr), 120_000);
      try {
        const body = stripNoise(s.stdout);
        const parsed = stateFromShowJson(JSON.parse(body.slice(body.indexOf('['))));
        if (parsed) state = { ...parsed, commit: ws.commit, readAt: d.now(), source: 'mxcli' };
      } catch {
        // no state: the card says it wasn't read
      }
    }
    await d.mark?.(dir, ws).catch(() => undefined);
    return { result, ...(state ? { state } : {}) };
  });
}
