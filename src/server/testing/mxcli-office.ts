// Testing release 1b's wiring into the office: the microflow test run an admin starts from the Testing
// tab ("Run microflow tests on main"), and the quality scores (report + lint) worked out once per new
// main commit, plus on asking. One run of each kind at a time per project; each in the office's own work
// folder (workfolder.ts), never a floor checkout or an agent's worktree. The automatic quality run for a
// new main commit happens only while "Score main automatically with mxcli" is on (switches.ts, off by
// default), and never while any of the project's agents is working (a cheap look at the floor's
// workers): it waits for the next look (a newer commit, or a moment the floor is idle), so it never
// competes with them for the machine; each commit is tried once. An admin's "Score main now" always works.

import path from 'node:path';
import { buildQualityView, qualityKey, type MxcliRunState, type QualityPart } from '../../shared/testing/quality.js';
import { agent, audit, human, office } from '../audit/index.js';
import type { Floor } from '../floor.js';
import type { Ctx } from '../office/context.js';
import { dropKeys, onForgetFloor } from '../office/forget.js';
import { testingStore } from './index.js';
import { NoTestsError, runMicroflowTests, runQuality, type TestRunOpts } from './mxcli-run.js';
import { testRunConstants } from '../app-instance/constants.js';
import { mxcliFor, type MxTool } from './mxcli-tool.js';
import { QualityStore } from './quality-store.js';
import { mainOf } from './repo.js';
import { pgEnvFor, prepareTestRun, serialTestRuntime, testPorts } from './test-db.js';
import { testFlags, type TestFlags } from './test-flags.js';
import type { TestRunDraft } from '../../shared/testing/record.js';
import { pickMxbuild } from '../liveapp/mxbuild.js';
import { floorToolkitEnv } from '../toolkit-env.js';
import { execFileOffP } from '../offloop/exec.js';
import { testingSwitches } from './switches.js';
import { limitFor, testLimitOf } from './runner-settings.js';
import { testFilesAt } from './workfolder.js';
import { progressWords, type RunProgress } from '../../shared/testing/run-progress.js';
import { isSubset, pickFiles, subsetWords, type RunSubset } from '../../shared/testing/test-files.js';

/** A run's time limit when nothing else says (tests); the office sizes it to the suite or takes the project's own (runner-settings.ts). */
export const TEST_TIMEOUT_MS = 45 * 60_000;

type FloorLike = Pick<Floor, 'id' | 'dir'> & { workers?: Pick<Floor['workers'], 'list'> };

interface RunSlot {
  running: boolean;
  since?: number;
  commit?: string;
  last?: string;
  /** Who started the last microflow test run (a person, or an agent through office-app test). */
  by?: string;
  /** The last run's record (the test-run store's id) and whether it decided anything. */
  record?: string;
  harness?: string;
  /** How far the run now has got (read off mxcli's output), and what it covers: its files, tests and time limit. */
  progress?: RunProgress;
  plan?: { paths: string[]; tests: number; limitMs: number; auto: boolean };
  subset?: RunSubset;
}
interface FloorRuns {
  tests: RunSlot;
  quality: RunSlot & { deferredFor?: string };
  /** Commits whose automatic quality run was tried (commit:version): once each. */
  tried: Set<string>;
}

const runs = new Map<string, FloorRuns>();
const qstores = new Map<string, QualityStore>();
onForgetFloor((f) => {
  dropKeys(runs, f);
  for (const k of [...qstores.keys()]) if (path.basename(k) === f.id) qstores.delete(k);
});

const runsOf = (id: string): FloorRuns => {
  let r = runs.get(id);
  if (!r) runs.set(id, (r = { tests: { running: false }, quality: { running: false }, tried: new Set() }));
  return r;
};

export function qualityStore(dataDir: string, floorId: string): QualityStore {
  const dir = path.join(dataDir, 'testing', 'quality');
  const key = path.join(dir, floorId);
  let s = qstores.get(key);
  if (!s) qstores.set(key, (s = new QualityStore(dir, floorId)));
  return s;
}

/** Whether the floor's agents are working right now (the cheap check: the worker list in memory). */
export const floorBusy = (floor: FloorLike) => !!floor.workers?.list().some((w) => w.status === 'working');

export interface MxDeps {
  tool?: (dataDir: string, floorDir: string) => Promise<MxTool | { why: string }>;
  now?: () => number;
  /** Whether automatic scoring is on (tests); the office's switch otherwise. */
  auto?: boolean;
  /** Stand-in for test-db.ts prepareTestRun (tests); the real one otherwise. */
  prepare?: (mprBase: string) => Promise<{ db: string; notes: string[] } | { why: string }>;
  /** Stand-in for test-flags.ts testFlags (tests). */
  flags?: (bin: string) => Promise<TestFlags>;
  /** Stand-in for app-instance/constants.ts testRunConstants (tests). */
  constants?: (floorDir: string, sha: string) => Promise<TestRunOpts['constants']>;
  /** Stand-in for runner-settings.ts limitFor (tests): a run's time limit for its number of tests. */
  limit?: (tests: number) => { ms: number; auto: boolean };
  /** Hears each finished run's record (the callers raise what only a person can clear: agent-app/raise.ts). */
  onDone?: (draft: TestRunDraft) => void;
}

/** Who starts a microflow test run, and on which commit (default: main's newest). */
export interface TestAsk {
  name: string;
  accountId?: string;
  /** An agent (office-app test): its worker id. */
  agentId?: string;
  /** A commit the project's repository has (an agent's candidate): its full sha. */
  commit?: string;
  /** Only some test files (office-app test --files / --tag): checked against the commit's files before it starts. */
  subset?: RunSubset;
}

/** The full sha of `rev` in the project's repository (worktrees share its objects), or undefined. */
export async function commitIn(dir: string, rev: string): Promise<string | undefined> {
  if (!/^[\w./@^~-]{1,200}$/.test(rev) || rev.startsWith('-')) return undefined;
  try {
    const { stdout } = await execFileOffP('git', ['rev-parse', '--verify', '--quiet', `${rev}^{commit}`], { cwd: dir, timeout: 15_000, windowsHide: true });
    return /^[0-9a-f]{40}$/.test(stdout.trim()) ? stdout.trim() : undefined;
  } catch {
    return undefined;
  }
}

const toolOf = (deps: MxDeps) => deps.tool ?? ((d: string, f: string) => mxcliFor(d, f));

/**
 * Starts a microflow test run (admins from the Testing page: the route checks; agents through office-app test,
 * on their candidate): on main's newest commit, or `who.commit`. The test database and the fixed ports are got
 * ready first (test-db.ts), one test runtime at a time on the machine. The started commit, or why not.
 */
export async function startMicroflowTests(dataDir: string, floor: FloorLike, who: TestAsk, deps: MxDeps = {}): Promise<{ commit: string; done: Promise<void> } | string> {
  const slot = runsOf(floor.id).tests;
  const busy = () => `A microflow test run is already under way for this project${slot.by ? ` (${slot.by}'s, on ${slot.commit?.slice(0, 7)})` : ''}: wait for it, then ask again`;
  if (slot.running) return busy();
  const tool = await toolOf(deps)(dataDir, floor.dir);
  if ('why' in tool) return tool.why;
  const main = await mainOf(floor.dir);
  if (!main) return 'This project has no commits yet';
  const sha = who.commit ? await commitIn(floor.dir, who.commit) : main.sha;
  if (!sha) return `The project's repository has no commit ${who.commit}: commit your work first (the run uses committed files only)`;
  const onMain = sha === main.sha;
  const label = onMain ? `main at ${sha.slice(0, 7)}` : `commit ${sha.slice(0, 7)}`;
  const subset = isSubset(who.subset) ? who.subset : undefined;
  if (subset) {
    // A name that matches no file is said now, not as a run that never started.
    const picked = pickFiles(await testFilesAt(floor.dir, sha), subset);
    if ('why' in picked) return `Nothing to run for ${subsetWords(subset)} at ${sha.slice(0, 7)}: ${picked.why}`;
  }
  if (slot.running) return busy();
  Object.assign(slot, { running: true, since: Date.now(), commit: sha, by: who.name, record: undefined, harness: undefined, progress: undefined, plan: undefined, subset });
  audit.record({
    floor: floor.id,
    actor: who.agentId ? agent(who.name, who.agentId) : human(who.name, who.accountId),
    action: 'testing.mxcli-test',
    target: { kind: 'commit', id: sha, label },
    summary: `Started the microflow tests (mxcli test --local --require-assertions) on ${label}${subset ? ` (${subsetWords(subset)})` : ''}, in the office's work folder`,
    details: { mxcli: tool.version, ...(onMain ? { branch: main.branch } : {}), ...(subset ? { subset } : {}) },
    severity: 'info',
  });
  const done = (async () => {
    try {
      const prepare = deps.prepare ?? ((base: string) => prepareTestRun(base, { dataDir }));
      const flags = await (deps.flags ?? testFlags)(tool.bin).catch(() => undefined);
      // The project's instance constants and a generated seed password, for this run only.
      const constants = await (deps.constants ?? ((d: string, c: string) => testRunConstants(dataDir, d, c)))(floor.dir, sha).catch(() => undefined);
      const limit = deps.limit ?? (await limitFor(dataDir, floor.id));
      const live = { subset, limit, onPlan: (p: NonNullable<RunSlot['plan']>) => void (slot.plan = p), onProgress: (p: RunProgress) => void (slot.progress = p) };
      const { draft } = await runMicroflowTests({ ...live, ...(constants ? { constants } : {}), dataDir, floorId: floor.id, floorDir: floor.dir, bin: tool.bin, mxcliVersion: tool.version, sha, ...(onMain ? { branch: main.branch } : {}), actor: who.name, timeoutMs: TEST_TIMEOUT_MS, prepare, serial: serialTestRuntime, mxbuildFor: (mpr) => pickMxbuild(mpr, floorToolkitEnv(floor.dir)).path, ...(flags ? { flags } : {}), ports: () => testPorts(dataDir), pgEnv: pgEnvFor(dataDir), ...(deps.now ? { now: deps.now } : {}) });
      try {
        deps.onDone?.(draft);
      } catch {
        // A listener's trouble isn't the run's.
      }
      const [rec] = await testingStore(dataDir, floor.id).ingest([draft]);
      slot.record = rec?.id;
      slot.harness = draft.harnessError;
      const c = { passed: 0, failed: 0, skipped: 0, harness: 0 };
      for (const t of draft.results) {
        if (t.harness) c.harness++;
        else c[t.status]++;
      }
      const counts = `${c.passed} passed, ${c.failed} failed, ${c.harness} harness error${c.harness === 1 ? '' : 's'}, ${c.skipped} ${draft.harnessError ? 'never ran' : 'skipped'}`;
      const of = subset ? ` (${subsetWords(subset)})` : '';
      slot.last = draft.harnessError ? `Harness error: ${draft.harnessError}${draft.results.length ? ` [kept: ${counts}]` : ''}${of}` : `${counts}${of}`;
    } catch (err) {
      slot.last = err instanceof NoTestsError ? err.message : `The run could not be recorded: ${(err as Error).message}`;
    } finally {
      slot.running = false;
    }
  })();
  return { commit: sha, done };
}

/** A running test run's progress in words and its time limit (the Testing page, office-app test). */
function testProgress(s: RunSlot): { progress?: string; limitMinutes?: number; limitAuto?: boolean } {
  return {
    ...(s.progress ? { progress: progressWords(s.progress, Date.now()) } : { progress: 'Getting the work folder ready' }),
    ...(s.plan ? { limitMinutes: Math.max(1, Math.ceil(s.plan.limitMs / 60_000)), limitAuto: s.plan.auto } : {}),
  };
}

/** The project's microflow test run now, or its last one (what an agent's office-app test waits on): its progress in words, not the raw object. */
export function testRunOf(floorId: string): Readonly<Omit<RunSlot, 'progress' | 'plan'> & { progress?: string; limitMinutes?: number; limitAuto?: boolean }> {
  const { progress: _p, plan: _l, ...s } = runsOf(floorId).tests;
  return { ...s, ...(s.running ? testProgress(runsOf(floorId).tests) : {}) };
}

/** Runs report + lint on `sha` unless that commit and mxcli version are already recorded. */
async function qualityOn(dataDir: string, floor: FloorLike, tool: MxTool, sha: string, branch: string, trigger: string, deps: MxDeps): Promise<string> {
  const slot = runsOf(floor.id).quality;
  const store = qualityStore(dataDir, floor.id);
  Object.assign(slot, { running: true, since: Date.now(), commit: sha });
  slot.deferredFor = undefined;
  try {
    const draft = await runQuality({ dataDir, floorId: floor.id, floorDir: floor.dir, bin: tool.bin, mxcliVersion: tool.version, sha, branch, trigger, ...(deps.now ? { now: deps.now } : {}) });
    const rec = await store.ingest(draft);
    slot.last = rec ? `Scored ${sha.slice(0, 7)}${draft.errors.length ? ` (${draft.errors.length} command${draft.errors.length === 1 ? '' : 's'} failed)` : ''}` : `${sha.slice(0, 7)} was already scored with this mxcli`;
  } catch (err) {
    slot.last = `Quality run on ${sha.slice(0, 7)} failed: ${(err as Error).message}`;
  } finally {
    slot.running = false;
  }
  return slot.last;
}

/** The quality run an admin asks for, on main. The commit, or why not. */
export async function startQuality(dataDir: string, floor: FloorLike, who: { name: string; accountId?: string }, deps: MxDeps = {}): Promise<{ commit: string; done: Promise<string> } | string> {
  const slot = runsOf(floor.id).quality;
  if (slot.running) return 'A quality run is already under way for this project';
  const tool = await toolOf(deps)(dataDir, floor.dir);
  if ('why' in tool) return tool.why;
  const main = await mainOf(floor.dir);
  if (!main) return 'This project has no commits yet';
  if (await qualityStore(dataDir, floor.id).has(qualityKey(main.sha, tool.version))) return `main at ${main.sha.slice(0, 7)} is already scored with mxcli ${tool.version}`;
  if (slot.running) return 'A quality run is already under way for this project';
  audit.record({ floor: floor.id, actor: human(who.name, who.accountId), action: 'testing.quality', target: { kind: 'commit', id: main.sha, label: `main at ${main.sha.slice(0, 7)}` }, summary: `Asked for the quality scores (mxcli report + lint) of main at ${main.sha.slice(0, 7)}`, details: { mxcli: tool.version }, severity: 'info' });
  return { commit: main.sha, done: qualityOn(dataDir, floor, tool, main.sha, main.branch, who.name, deps) };
}

/**
 * main's commit as the Testing view or the board's poll just read it: scored once per commit and mxcli
 * version, at most one run at a time, never while the agents work, and only while automatic scoring is
 * on (`deps.auto`, else the office's switch). Fire and forget; never throws.
 * Gives back the run (its `done`) when one started; tests wait on it.
 */
export async function qualityOnMain(dataDir: string, floor: FloorLike, main: { sha: string; branch: string } | undefined, deps: MxDeps = {}): Promise<{ done: Promise<string> } | undefined> {
  try {
    if (!main || !(deps.auto ?? testingSwitches().autoScore)) return undefined;
    const r = runsOf(floor.id);
    if (r.quality.running) return undefined;
    const tool = await toolOf(deps)(dataDir, floor.dir);
    if ('why' in tool) return undefined;
    const key = qualityKey(main.sha, tool.version);
    if (r.tried.has(key) || (await qualityStore(dataDir, floor.id).has(key))) return undefined;
    // Never while an agent is working: the next look (a newer commit, or the floor idle) tries again.
    if (floorBusy(floor)) {
      r.quality.deferredFor = key;
      return undefined;
    }
    if (r.quality.running) return undefined;
    r.tried.add(key);
    audit.record({ floor: floor.id, actor: office(), action: 'testing.quality', target: { kind: 'commit', id: main.sha, label: `main at ${main.sha.slice(0, 7)}` }, summary: `Working out the quality scores (mxcli report + lint) of the new main commit ${main.sha.slice(0, 7)}`, details: { mxcli: tool.version }, severity: 'info' });
    return { done: qualityOn(dataDir, floor, tool, main.sha, main.branch, 'auto', deps) };
  } catch {
    return undefined;
  }
}

/** The tab's buttons: whether runs can start here and what each did last. */
export async function runState(dataDir: string, floor: FloorLike, deps: MxDeps = {}): Promise<MxcliRunState> {
  const r = runsOf(floor.id);
  const tool = await toolOf(deps)(dataDir, floor.dir);
  const slot = (s: RunSlot) => ({ running: s.running, ...(s.since ? { since: s.since } : {}), ...(s.commit ? { commit: s.commit } : {}), ...(s.last ? { last: s.last } : {}) });
  const t = r.tests;
  return {
    available: !('why' in tool),
    ...('why' in tool ? { why: tool.why } : {}),
    tests: { ...slot(t), ...(t.running ? testProgress(t) : {}), ...(t.subset ? { subset: subsetWords(t.subset) } : {}) },
    quality: { ...slot(r.quality), ...(r.quality.deferredFor && !r.quality.running && (deps.auto ?? testingSwitches().autoScore) ? { deferred: 'Waiting for the agents to finish before scoring the new main commit' } : {}) },
  };
}

/** GET /api/testing?part=quality. */
export async function qualityPart(dataDir: string, floor: FloorLike, admin: boolean, deps: MxDeps = {}): Promise<QualityPart> {
  const main = await mainOf(floor.dir);
  // Started (not waited for) before the state is read, so the answer already says it's running.
  await qualityOnMain(dataDir, floor, main, deps);
  const [records, state, limit] = await Promise.all([qualityStore(dataDir, floor.id).all(), runState(dataDir, floor, deps), testLimitOf(dataDir, floor.id)]);
  return { quality: buildQualityView(records, main?.sha), runs: state, admin, auto: deps.auto ?? testingSwitches().autoScore, ...(main ? { main: main.sha } : {}), ...(limit ? { testLimit: limit } : {}) };
}
