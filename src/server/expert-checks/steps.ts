// The background checks' steps on the office's machine (./runner.ts runs them in turn). None of them opens the
// project folder's .mpr, which the in-place preview runs and reloads:
//   * lint: `mxcli lint --format json` in the office's own warm copy of the commit (app-instance/workspace.ts,
//     <data>/testing/work/<project>/instance-expertlint), vendor modules left out as the toolkit's lint gate leaves
//     them out (.claude/lint-vendor-modules.txt), the delta against the commit's baseline (./lint-delta.ts), and
//     a record in the testing ledger at the commit (source office-check);
//   * journeys: played on the preview itself (it serves the session's folder, which the office just committed), one
//     at a time through the agent journeys' own runner (agent-app/journey.ts: recorded at the commit by journey id,
//     the same records Team mode's journeys make), stopped at once when the run is cancelled;
//   * microflow tests: the Testing page's own run (testing/mxcli-office.ts startMicroflowTests) on the commit, for
//     the selected files only, in its work folder: recorded the same way. It can't be stopped safely mid-way.
// mxcli runs at below-normal priority (its children inherit it on Windows), so the preview's reload comes first.

import os from 'node:os';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import type { CheckCounts, CheckFailure } from '../../shared/expert-checks.js';
import { IMPORTER_VERSION, type TestRunDraft } from '../../shared/testing/record.js';
import { instanceDir } from '../app-instance/index.js';
import { prepareWorkspace } from '../app-instance/workspace.js';
import { testingStore } from '../testing/index.js';
import { startMicroflowTests, testRunOf } from '../testing/mxcli-office.js';
import { mxcliFor } from '../testing/mxcli-tool.js';
import { oneAtATime, readOwner, runMxOwned } from '../testing/run-guard.js';
import { readFiles } from '../testing/repo.js';
import { runJourney, type JourneyDeps } from '../agent-app/journey.js';
import type { AgentApp } from '../agent-app/service.js';
import { lintDelta, lintFindings, readBaseline } from './lint-delta.js';
import type { LintOut, StepIn, TestsOut } from './runner.js';
import type { TestRunLine } from '../testing/store.js';
import type { Floor } from '../floor.js';

export const LINT_TIMEOUT_MS = 20 * 60_000;
export const BASELINE_FILE = '.claude/lint-baseline.json';
export const VENDOR_FILE = '.claude/lint-vendor-modules.txt';
/** Who the records say ran them. */
export const BY = 'Expert background check';

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms).unref?.());

/** While `until` runs: every program recorded beside work folder `dir` (run-guard.ts) set to below-normal priority. */
export async function lowerWhile(dir: string, until: Promise<unknown>, pollMs = 500): Promise<void> {
  let done = false;
  void until.finally(() => (done = true));
  const seen = new Set<number>();
  while (!done) {
    const o = await readOwner(dir);
    if (o && !seen.has(o.pid)) {
      seen.add(o.pid);
      try {
        os.setPriority(o.pid, os.constants.priority.PRIORITY_BELOW_NORMAL);
      } catch {
        // gone already, or not ours to change
      }
    }
    await sleep(pollMs);
  }
}

/** The commit an earlier record shows `name` passing at (not `commit` itself), newest first: a failure now is a regression. */
export function passedBefore(records: readonly Pick<TestRunLine, 'testedRevision' | 'results' | 'ingestedAt'>[], name: string, commit: string): string | undefined {
  for (let i = records.length - 1; i >= 0; i--) {
    const r = records[i];
    if (r.testedRevision === commit || r.testedRevision === 'unknown') continue;
    const hit = r.results.find((x) => x.name === name);
    if (hit) return hit.status === 'passed' ? r.testedRevision : undefined;
  }
  return undefined;
}

export interface StepEnv {
  dataDir: string;
  /** The preview's address and runtime log, while it serves. */
  preview(floorId: string): { url: string; runtimeLog: string } | undefined;
  /** The floor's worker list (the Testing run's "agents busy" look), when there is one. */
  floor(floorId: string): Pick<Floor, 'id' | 'dir'> | undefined;
  /** Stand-ins (tests). */
  journey?: typeof runJourney;
  journeyDeps?: Partial<JourneyDeps>;
}

// ---- Lint --------------------------------------------------------------------------------------------

export async function lintStep(env: StepEnv, i: StepIn): Promise<LintOut> {
  const tool = await mxcliFor(env.dataDir, i.dir);
  if ('why' in tool) return { skipped: tool.why, records: [] };
  const dir = instanceDir(env.dataDir, i.floorId, 'expertlint');
  return oneAtATime(dir, async () => {
    let ws: { dir: string; commit: string; mpr: string };
    try {
      ws = await prepareWorkspace(i.dir, i.commit, dir, env.dataDir);
    } catch (err) {
      return { skipped: `The office couldn't copy the commit to lint it: ${(err as Error).message}`, records: [] };
    }
    const read = (f: string) => readFile(path.join(ws.dir, ...f.split('/')), 'utf8').catch(() => undefined);
    const [baseText, vendorText] = await Promise.all([read(BASELINE_FILE), read(VENDOR_FILE)]);
    const vendor = (vendorText ?? '')
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#'));
    const mpr = path.join(ws.dir, ...ws.mpr.split('/'));
    const startedAt = new Date().toISOString();
    const run = runMxOwned(dir, tool.bin, ['lint', '-p', mpr, ...(vendor.length ? ['-e', vendor.join(',')] : []), '--format', 'json'], path.dirname(mpr), LINT_TIMEOUT_MS);
    void lowerWhile(dir, run);
    const out = await run;
    const findings = lintFindings(out.stdout);
    if (!findings) return { skipped: `Lint gave no findings list (exit ${out.code ?? 'none'}${out.killed ? ', timed out' : ''}${out.startError ? `, ${out.startError}` : ''})`, records: [] };
    const delta = lintDelta(findings, readBaseline(baseText));
    const words = (n: number, w: string) => `${n} new ${w}${n === 1 ? '' : 's'}`;
    const list = (sev: string) =>
      delta.findings
        .filter((f) => f.severity === sev)
        .slice(0, 10)
        .map((f) => `${f.rule} ${[f.module, f.document].filter(Boolean).join('.')}: ${f.message}`)
        .join(' · ')
        .slice(0, 600);
    const draft: TestRunDraft = {
      source: 'office-check',
      sourceKey: `expert-lint:${i.floorId}:${ws.commit}:${tool.version}`,
      suite: 'lint (new against the baseline)',
      testedRevision: ws.commit,
      definitionRevision: ws.commit,
      evidence: { kind: 'office', revision: ws.commit, locator: 'office:expert-lint' },
      startedAt,
      finishedAt: new Date().toISOString(),
      results: delta.baseline
        ? [
            { name: 'lint new errors', status: delta.errors ? 'failed' : 'passed', ...(delta.errors ? { detail: `${words(delta.errors, 'error')}: ${list('error')}` } : {}), links: [] },
            { name: 'lint new warnings', status: delta.warnings ? 'failed' : 'passed', ...(delta.warnings ? { detail: `${words(delta.warnings, 'warning')}: ${list('warning')}` } : {}), links: [] },
          ]
        : [],
      links: [],
      actor: { kind: 'office', name: BY },
      environment: { runner: 'mxcli lint (Expert background check)', mxcliVersion: tool.version, runtime: 'local', workFolder: ws.dir },
      exitCode: out.code,
      ...(delta.baseline ? {} : { harnessError: `No ${BASELINE_FILE} at this commit: new findings can't be told from old ones` }),
      importer: `${IMPORTER_VERSION}+expert-lint/1`,
    };
    const [rec] = await testingStore(env.dataDir, i.floorId).ingest([draft]);
    return { delta, records: rec ? [rec.id] : [] };
  });
}

// ---- Journeys ----------------------------------------------------------------------------------------

/** The preview as the journey runner's instance: its address and log, the commit the folder was just committed at. */
function previewApp(i: StepIn, p: { url: string; runtimeLog: string }, workspace: string, abort: AbortController): AgentApp {
  const instance = { url: p.url, appPort: Number(new URL(p.url).port) || 0, pid: undefined, commit: i.commit, dbName: '', logFile: '', runtimeLog: p.runtimeLog, workspace } as unknown as NonNullable<AgentApp['instance']>;
  return { floorId: i.floorId, workerId: 'expert-session', worker: BY, commit: i.commit, purpose: 'expert', workspace, state: 'ready', instance, asked: 'expert-check', startedAt: Date.now(), lastUsed: Date.now(), abort, started: Promise.resolve() } as unknown as AgentApp;
}

export async function journeysStep(env: StepEnv, i: StepIn): Promise<TestsOut> {
  const want = i.selection.journeys;
  const counts: CheckCounts = { passed: 0, failed: 0, notRun: 0, total: want.length };
  const p = env.preview(i.floorId);
  if (!p) return { counts: { ...counts, notRun: want.length }, failures: [], notes: ['The preview isn’t running: start it and the journeys run on the next idle'], records: [] };
  // A project's own .journey.js runs in a copy of the commit's files (never the project folder): kept warm between runs.
  const needsFiles = want.some((f) => /\.c?js$/i.test(f));
  let workspace = path.join(env.dataDir, 'testing', 'work', i.floorId);
  if (needsFiles) {
    try {
      workspace = (await prepareWorkspace(i.dir, i.commit, instanceDir(env.dataDir, i.floorId, 'expertjourneys'), env.dataDir)).dir;
    } catch (err) {
      return { counts: { ...counts, notRun: want.length }, failures: [], notes: [`The journeys’ files couldn’t be copied: ${(err as Error).message}`], records: [] };
    }
  }
  const abort = new AbortController();
  const stop = () => abort.abort(typeof i.signal.reason === 'string' ? i.signal.reason : 'cancelled');
  i.signal.addEventListener('abort', stop, { once: true });
  const app = previewApp(i, p, workspace, abort);
  const d: JourneyDeps = { dataDir: env.dataDir, floorDir: i.dir, ...env.journeyDeps };
  const outside = want.filter((f) => !f.startsWith('tests/'));
  const texts = outside.length ? await readFiles(i.dir, i.commit, outside, 512 * 1024) : new Map<string, string>();
  const failures: CheckFailure[] = [];
  const records: string[] = [];
  const notes: string[] = [];
  const store = testingStore(env.dataDir, i.floorId);
  try {
    for (const file of want) {
      if (i.signal.aborted) break;
      const label = file.split('/').pop()!.replace(/\.journey\.(json|c?js)$/i, '');
      i.now(`journey ${label}`);
      // The journey runner finds journeys under tests/ by path; one elsewhere (the toolkit's journeys/) is handed over as its file.
      const ask = file.startsWith('tests/') ? { journey: file } : { file, text: texts.get(file) ?? '' };
      const o = await (env.journey ?? runJourney)(app, ask, d).catch((err: Error) => ({ suite: `journey ${label}`, commit: i.commit, status: 'error' as const, failure: err.message, record: undefined }));
      if (o.record) records.push(o.record);
      const id = o.suite.replace(/^journey\s+/, '') || label;
      if (o.status === 'passed') counts.passed++;
      else if (o.status === 'failed') {
        counts.failed++;
        const passedAt = passedBefore((await store.all()).filter((r) => r.id !== o.record), id, i.commit);
        failures.push({ kind: 'journey', id, ...(o.failure || o.runtimeErrors?.[0] ? { detail: (o.failure ?? `runtime error: ${o.runtimeErrors![0]}`).slice(0, 300) } : {}), ...(passedAt ? { passedAt } : {}), ...(o.record ? { record: o.record } : {}) });
      } else {
        counts.notRun++;
        if (!i.signal.aborted && o.failure) notes.push(`${id} didn’t run: ${o.failure.slice(0, 200)}`);
      }
    }
  } finally {
    i.signal.removeEventListener('abort', stop);
  }
  counts.notRun = counts.total - counts.passed - counts.failed;
  return { counts, failures, notes: notes.slice(0, 5), records };
}

// ---- Microflow tests ---------------------------------------------------------------------------------

export async function microflowStep(env: StepEnv, i: StepIn): Promise<TestsOut> {
  const files = i.selection.tests;
  const counts: CheckCounts = { passed: 0, failed: 0, notRun: files.length, total: files.length };
  const floor = env.floor(i.floorId);
  if (!floor) return { counts, failures: [], notes: [], records: [] };
  const started = await startMicroflowTests(env.dataDir, floor, { name: BY, commit: i.commit, subset: { files } });
  if (typeof started === 'string') return { counts, failures: [], notes: [`Microflow tests didn’t run: ${started}`], records: [] };
  void lowerWhile(path.join(env.dataDir, 'testing', 'work', i.floorId, 'tests'), started.done);
  await started.done;
  const run = testRunOf(i.floorId);
  const all = await testingStore(env.dataDir, i.floorId).all();
  const rec = run.record ? all.find((r) => r.id === run.record) : undefined;
  if (!rec) return { counts, failures: [], notes: [run.last ? `Microflow tests: ${run.last}` : 'Microflow tests weren’t recorded'], records: [] };
  const failures: CheckFailure[] = [];
  const out: CheckCounts = { passed: 0, failed: 0, notRun: 0, total: rec.results.length };
  const before = all.filter((r) => r.id !== rec.id);
  for (const t of rec.results) {
    if (t.status === 'passed') out.passed++;
    else if (t.status === 'failed') {
      out.failed++;
      const passedAt = passedBefore(before, t.name, i.commit);
      failures.push({ kind: 'microflow', id: t.name, ...(t.detail ? { detail: t.detail.slice(0, 300) } : {}), ...(passedAt ? { passedAt } : {}), record: rec.id });
    } else out.notRun++;
  }
  return { counts: out, failures, notes: rec.harnessError ? [`Microflow tests: ${rec.harnessError.slice(0, 200)}`] : [], records: [rec.id] };
}
