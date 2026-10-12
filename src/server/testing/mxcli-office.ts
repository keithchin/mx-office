// Testing release 1b's wiring into the office: the microflow test run an admin starts from the Testing
// tab ("Run microflow tests on main"), and the quality scores (report + lint) worked out once per new
// main commit, plus on asking. One run of each kind at a time per project; each in the office's own work
// folder (workfolder.ts), never a floor checkout or an agent's worktree. A quality run for a new main
// commit waits while the project's agents are working (a cheap look at the floor's workers), at most
// DEFER_MAX_MS, so it never competes with them for the machine; each commit is tried once.

import path from 'node:path';
import { buildQualityView, qualityKey, type MxcliRunState, type QualityPart } from '../../shared/testing/quality.js';
import { audit, human, office } from '../audit/index.js';
import type { Floor } from '../floor.js';
import type { Ctx } from '../office/context.js';
import { dropKeys, onForgetFloor } from '../office/forget.js';
import { testingStore } from './index.js';
import { NoTestsError, runMicroflowTests, runQuality } from './mxcli-run.js';
import { mxcliFor, type MxTool } from './mxcli-tool.js';
import { QualityStore } from './quality-store.js';
import { mainOf } from './repo.js';

/** mxcli test's runtime timeout for the office's run. */
export const TEST_TIMEOUT_MS = 15 * 60_000;
/** How long a new main commit's quality run waits for busy agents at most. */
export const DEFER_MAX_MS = 30 * 60_000;

type FloorLike = Pick<Floor, 'id' | 'dir'> & { workers?: Pick<Floor['workers'], 'list'> };

interface RunSlot {
  running: boolean;
  since?: number;
  commit?: string;
  last?: string;
}
interface FloorRuns {
  tests: RunSlot;
  quality: RunSlot & { deferredSince?: number; deferredFor?: string };
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
}

const toolOf = (deps: MxDeps) => deps.tool ?? ((d: string, f: string) => mxcliFor(d, f));

/** Starts the microflow test run on main (admins only: the route checks). The started commit, or why not. */
export async function startMicroflowTests(dataDir: string, floor: FloorLike, who: { name: string; accountId?: string }, deps: MxDeps = {}): Promise<{ commit: string; done: Promise<void> } | string> {
  const slot = runsOf(floor.id).tests;
  if (slot.running) return 'A microflow test run is already under way for this project';
  const tool = await toolOf(deps)(dataDir, floor.dir);
  if ('why' in tool) return tool.why;
  const main = await mainOf(floor.dir);
  if (!main) return 'This project has no commits yet';
  if (slot.running) return 'A microflow test run is already under way for this project';
  Object.assign(slot, { running: true, since: Date.now(), commit: main.sha });
  audit.record({
    floor: floor.id,
    actor: human(who.name, who.accountId),
    action: 'testing.mxcli-test',
    target: { kind: 'commit', id: main.sha, label: `main at ${main.sha.slice(0, 7)}` },
    summary: `Started the microflow tests (mxcli test --local --require-assertions) on main at ${main.sha.slice(0, 7)}, in the office's work folder`,
    details: { mxcli: tool.version, branch: main.branch },
    severity: 'info',
  });
  const done = (async () => {
    try {
      const { draft } = await runMicroflowTests({ dataDir, floorId: floor.id, floorDir: floor.dir, bin: tool.bin, mxcliVersion: tool.version, sha: main.sha, branch: main.branch, actor: who.name, timeoutMs: TEST_TIMEOUT_MS, ...(deps.now ? { now: deps.now } : {}) });
      await testingStore(dataDir, floor.id).ingest([draft]);
      const c = { passed: 0, failed: 0, skipped: 0, harness: 0 };
      for (const t of draft.results) {
        if (t.harness) c.harness++;
        else c[t.status]++;
      }
      slot.last = draft.harnessError ? `Harness error: ${draft.harnessError}` : `${c.passed} passed, ${c.failed} failed, ${c.harness} harness error${c.harness === 1 ? '' : 's'}, ${c.skipped} skipped`;
    } catch (err) {
      slot.last = err instanceof NoTestsError ? err.message : `The run could not be recorded: ${(err as Error).message}`;
    } finally {
      slot.running = false;
    }
  })();
  return { commit: main.sha, done };
}

/** Runs report + lint on `sha` unless that commit and mxcli version are already recorded. */
async function qualityOn(dataDir: string, floor: FloorLike, tool: MxTool, sha: string, branch: string, trigger: string, deps: MxDeps): Promise<string> {
  const slot = runsOf(floor.id).quality;
  const store = qualityStore(dataDir, floor.id);
  Object.assign(slot, { running: true, since: Date.now(), commit: sha });
  slot.deferredSince = undefined;
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
 * version, at most one run at a time, waiting while the agents work. Fire and forget; never throws.
 * Gives back the run (its `done`) when one started; tests wait on it.
 */
export async function qualityOnMain(dataDir: string, floor: FloorLike, main: { sha: string; branch: string } | undefined, deps: MxDeps = {}): Promise<{ done: Promise<string> } | undefined> {
  try {
    if (!main) return undefined;
    const r = runsOf(floor.id);
    if (r.quality.running) return undefined;
    const tool = await toolOf(deps)(dataDir, floor.dir);
    if ('why' in tool) return undefined;
    const key = qualityKey(main.sha, tool.version);
    if (r.tried.has(key) || (await qualityStore(dataDir, floor.id).has(key))) return undefined;
    const now = (deps.now ?? Date.now)();
    if (floorBusy(floor)) {
      if (r.quality.deferredFor !== key) Object.assign(r.quality, { deferredFor: key, deferredSince: now });
      if (now - (r.quality.deferredSince ?? now) < DEFER_MAX_MS) return undefined;
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
  return {
    available: !('why' in tool),
    ...('why' in tool ? { why: tool.why } : {}),
    tests: slot(r.tests),
    quality: { ...slot(r.quality), ...(r.quality.deferredFor && !r.quality.running ? { deferred: 'Waiting for the agents to finish before scoring the new main commit' } : {}) },
  };
}

/** GET /api/testing?part=quality. */
export async function qualityPart(dataDir: string, floor: FloorLike, admin: boolean, deps: MxDeps = {}): Promise<QualityPart> {
  const main = await mainOf(floor.dir);
  // Started (not waited for) before the state is read, so the answer already says it's running.
  await qualityOnMain(dataDir, floor, main, deps);
  const [records, state] = await Promise.all([qualityStore(dataDir, floor.id).all(), runState(dataDir, floor, deps)]);
  return { quality: buildQualityView(records, main?.sha), runs: state, admin, ...(main ? { main: main.sha } : {}) };
}
