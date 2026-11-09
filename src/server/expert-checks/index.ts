// Expert mode's background checks wired to the office (slice 6; the machinery is ./runner.ts, the steps ./steps.ts):
// one BackgroundChecks per office, made on first use. It hears:
//   * the session's turns (expert/index.ts expertOnWorker hands each worker update over): busy cancels;
//   * the background proof settling (expert/service.ts: the session idle, its change committed): a run after the debounce;
//   * the session's hooks (workers/hook-bus.ts): the MDL scripts its exec.sh calls named, for the affected set.
// The proof strip reads proofChecks (GET /api/expert/proof), and Lock in (slice 7) calls runChecks.
//
// Exported for Lock in:
//   runChecks(ctx, floor, { scope: 'affected' | 'all', kinds: ['tests', 'journeys', 'lint', 'mxcheck'] })
//     → ChecksResult: the commit, each kind's outcome and every testing ledger record written at that commit.
//   It waits for the run under way (one per project), and the session's turns never cancel it.

import { existsSync } from 'node:fs';
import path from 'node:path';
import type { Floor } from '../floor.js';
import type { Ctx } from '../office/context.js';
import type { WorkerInfo } from '../../shared/protocol.js';
import type { ProofLint, ProofTests } from '../../shared/expert-checks.js';
import { execFileOff } from '../offloop/exec.js';
import { onForgetFloor } from '../office/forget.js';
import { onWorkerHook } from '../workers/hook-bus.js';
import { liveAppsIfMade, runtimeLogOf } from '../liveapp/index.js';
import { listFiles, readFiles } from '../testing/repo.js';
import { securityOf } from '../security-gate/index.js';
import { wizardConfig } from '../wizard/config.js';
import { floorToolkitEnv } from '../toolkit-env.js';
import { isExpertProject } from '../expert/mode.js';
import { instanceDir } from '../app-instance/index.js';
import { BackgroundChecks, type ChecksResult, type RunOpts } from './runner.js';
import { parseAffected, selectChecks, type SelectDeps } from './select.js';
import { BY, journeysStep, lintStep, microflowStep, type StepEnv } from './steps.js';

export { BackgroundChecks, IDLE_CHECK_DEBOUNCE_MS, type ChecksResult, type RunOpts, type StepIn, type TestsOut, type LintOut, type MxCheckOut } from './runner.js';
export { fillSession, cantFill } from './send.js';

const git = (args: string[], cwd: string, timeout = 30_000) =>
  new Promise<string | undefined>((resolve) => {
    execFileOff('git', args, { cwd, timeout, maxBuffer: 16 * 1024 * 1024, windowsHide: true, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0' } }, (err, out) => resolve(err ? undefined : String(out)));
  });

const lines = (s: string | undefined) => (s ?? '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

/** The office's real selection deps: git, and the toolkit's affected-tests.sh when the project has it. */
export const officeSelect: SelectDeps = {
  async changed(dir, from, to) {
    if (from) return lines(await git(['diff', '--name-only', '--no-renames', from, to], dir));
    return lines(await git(['show', '--name-only', '--format=', '--no-renames', to], dir));
  },
  files: (dir, sha) => listFiles(dir, sha, []),
  read: (dir, sha, files) => readFiles(dir, sha, files, 512 * 1024),
  async toolkit(dir, scripts) {
    const script = path.join(dir, 'bin', 'affected-tests.sh');
    if (!existsSync(script)) return undefined;
    // --no-model: the script never asks mxcli for callers, so it never opens the .mpr the preview runs.
    const out = await new Promise<string | undefined>((resolve) => {
      execFileOff(wizardConfig().bash, ['bin/affected-tests.sh', '--no-model', ...scripts], { cwd: dir, timeout: 60_000, maxBuffer: 4 * 1024 * 1024, windowsHide: true, env: { ...process.env, ...floorToolkitEnv(dir), MXTK_NO_FETCH: '1' } }, (err, stdout) => resolve(err ? undefined : String(stdout)));
    });
    return out === undefined ? undefined : parseAffected(out);
  },
};

/** The MDL scripts a command ran through the toolkit's exec.sh (relative to the project folder). */
export function scriptsIn(command: string): string[] {
  return [...command.matchAll(/exec\.sh['"]?\s+(?:--?\S+\s+)*['"]?([^\s;&|'"]+\.mdl)\b/gi)].map((m) => m[1].replace(/\\/g, '/').replace(/^\.\//, ''));
}

const offices = new WeakMap<object, { checks: BackgroundChecks; scripts: Map<string, Set<string>> }>();

function previewOf(ctx: Ctx, floorId: string): { url: string; runtimeLog: string } | undefined {
  const s = liveAppsIfMade(ctx)?.peek(floorId);
  const floor = ctx.floors.get(floorId);
  if (!s || !floor || s.status !== 'running' || !s.served || !s.appPort) return undefined;
  return { url: `http://127.0.0.1:${s.appPort}/`, runtimeLog: runtimeLogOf(undefined, floor.dir) };
}

function wired(ctx: Ctx) {
  let o = offices.get(ctx.cfg);
  if (o) return o;
  const scripts = new Map<string, Set<string>>();
  const env: StepEnv = { dataDir: ctx.cfg.dataDir, preview: (id) => previewOf(ctx, id), floor: (id) => ctx.floors.get(id) };
  const checks = new BackgroundChecks({
    head: async (dir) => (await git(['rev-parse', '-q', '--verify', 'HEAD^{commit}'], dir))?.trim() || undefined,
    select: (dir, to, so) => selectChecks(officeSelect, dir, to, so),
    lint: (i) => lintStep(env, i),
    journeys: (i) => journeysStep(env, i),
    microflow: (i) => microflowStep(env, i),
    mxcheck: async (i) => {
      const r = await securityOf(ctx).startCheck({ id: i.floorId, dir: i.dir }, i.commit, BY);
      return { status: r.status, ...(r.errors !== undefined ? { errors: r.errors } : {}), ...(r.warnings !== undefined ? { warnings: r.warnings } : {}), ...(r.why ? { why: r.why } : {}) };
    },
    previewBusy: (id) => {
      const s = liveAppsIfMade(ctx)?.peek(id);
      return !!s && (s.status === 'starting' || s.status === 'updating' || s.status === 'stopping' || /^Reloading/i.test(s.message ?? ''));
    },
    lintFirst: (id) => !existsSync(instanceDir(ctx.cfg.dataDir, id, 'expertlint')),
    takeScripts: (id) => {
      const set = scripts.get(id);
      scripts.delete(id);
      const floor = ctx.floors.get(id);
      return set && floor ? [...set].filter((f) => existsSync(path.join(floor.dir, f))) : [];
    },
    changed: (id) => {
      const floor = ctx.floors.get(id);
      if (floor) ctx.toFloor(floor, { t: 'roster.changed', floor: id });
    },
    now: () => Date.now(),
  });
  onWorkerHook((workerId, event, payload) => {
    if (event !== 'PostToolUse') return;
    const floor = ctx.workerFloor(workerId);
    if (!floor || !isExpertProject(floor) || !floor.workers.get(workerId)?.session) return;
    const p = (payload ?? {}) as { tool_name?: unknown; tool_input?: { command?: unknown } };
    if (p.tool_name !== 'Bash' || typeof p.tool_input?.command !== 'string') return;
    const got = scriptsIn(p.tool_input.command).filter((f) => !f.split('/').includes('..') && !path.isAbsolute(f));
    if (!got.length) return;
    const set = scripts.get(floor.id) ?? new Set<string>();
    for (const f of got) if (set.size < 40) set.add(f);
    scripts.set(floor.id, set);
  });
  onForgetFloor((f) => {
    checks.forget(f.id);
    scripts.delete(f.id);
  });
  o = { checks, scripts };
  offices.set(ctx.cfg, o);
  return o;
}

/** The office's one. */
export const backgroundChecksOf = (ctx: Ctx): BackgroundChecks => wired(ctx).checks;

const BUSY = new Set<WorkerInfo['status']>(['working', 'starting', 'needs_input']);

/** A worker update on an Expert project (expert/index.ts): the session's turns start and end. */
export function checksOnWorker(ctx: Ctx, floor: Floor, w: WorkerInfo) {
  if (w.kind !== 'agent' || w.worktree) return;
  backgroundChecksOf(ctx).busy(floor.id, floor.dir, BUSY.has(w.status));
}

/** AGENT_OFFICE_EXPERT_CHECKS=0 turns the idle runs off (troubleshooting, and the loop timer measured without them). */
export const idleChecksOn = (env: NodeJS.ProcessEnv = process.env) => env.AGENT_OFFICE_EXPERT_CHECKS !== '0';

/** The background proof settled (the session idle, its change committed or seen): a run after the debounce. */
export function checksOnSettled(ctx: Ctx, floorId: string) {
  if (!idleChecksOn()) return;
  const floor = ctx.floors.get(floorId);
  if (floor && isExpertProject(floor)) backgroundChecksOf(ctx).settled(floor.id, floor.dir);
}

/** The strip's TESTS and LINT cells (nulls until a run started). */
export function proofChecks(ctx: Ctx, floorId: string): { tests: ProofTests | null; lint: ProofLint | null } {
  return offices.get(ctx.cfg)?.checks.proof(floorId) ?? { tests: null, lint: null };
}

/** Lock in's entry: checks now on the project folder's HEAD, recorded in the testing ledger at that commit. */
export function runChecks(ctx: Ctx, floor: Pick<Floor, 'id' | 'dir'>, o: RunOpts = {}): Promise<ChecksResult> {
  return backgroundChecksOf(ctx).runChecks(floor.id, floor.dir, o);
}

export function stopBackgroundChecks(ctx: Ctx) {
  offices.get(ctx.cfg)?.checks.stop();
}
