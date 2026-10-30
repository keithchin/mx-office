// The office's own mxcli runs for the Testing tab (Testing release 1b), each in a fresh work folder at a
// known commit (workfolder.ts) and off the event loop:
//   * microflow tests: `mxcli test <files> -p <app>.mpr --local --require-assertions --junit <file>`,
//     the JUnit file written into the office's data folder and read inside the run's envelope
//     (shared/testing/junit.ts). It needs a Mendix runtime, so it may legitimately fail to start: that
//     is recorded as a harness error, never as failed tests. Exit code 1 is never read on its own.
//     The project's instance constants (and a generated seed password) go in as `--constant` for that run
//     only; an app seed that finds its password constant empty is said with that constant's name.
//   * quality: `mxcli report --format json`, `mxcli lint --format json` and the catalog's schema
//     (catalog_meta), bound to the commit and the mxcli version, with wall times.
// The work folder is wiped before and after, so whatever mxcli writes there (catalog, widget docs, a
// test module) never reaches a floor.

import { mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ulid } from '../../shared/evidence/ids.js';
import { draftFromMxcliRun, type MxcliRunEnvelope } from '../../shared/testing/junit.js';
import { parseLintJson, parseReportJson, qualityKey, ruleFailuresOf, type QualityDraft } from '../../shared/testing/quality.js';
import type { TestRunDraft } from '../../shared/testing/record.js';
import { stripNoise } from '../model/mxcli.js';
import { execFileOffP, type OffError } from '../offloop/exec.js';
import { EMPTY_PASSWORD, emptySeedPasswordWhy, NEEDS_MXCLI, testRunWhy } from '../../shared/testing/test-reason.js';
import { checkoutAt, disposeFolder, testPathsIn, workDirOf } from './workfolder.js';
import { NO_FLAGS, type TestFlags } from './test-flags.js';
import { freeFolder, heldWords, oneAtATime, runMxOwned } from './run-guard.js';
import { newProgress, readLine, stoppedWhile, type RunProgress } from '../../shared/testing/run-progress.js';
import { isSubset, partialResults, pickFiles, readTestFile, type RunSubset, type TestFile } from '../../shared/testing/test-files.js';

export interface MxOut {
  code: number | null;
  stdout: string;
  stderr: string;
  /** Stopped by the timeout. */
  killed?: boolean;
  /** It never started (ENOENT, EACCES…). */
  startError?: string;
  /** Its results were in, but it hadn't ended a while later: its tree was stopped (run-guard.ts). */
  lingered?: boolean;
  ms: number;
}

/** Runs mxcli and always answers (never rejects): exit code, output, whether it was stopped or never started. */
export async function runMx(bin: string, args: string[], cwd: string, timeout: number, extraEnv: Record<string, string> = {}): Promise<MxOut> {
  const t0 = Date.now();
  try {
    const { stdout, stderr } = await execFileOffP(bin, args, { cwd, timeout, maxBuffer: 64 * 1024 * 1024, windowsHide: true, env: { ...process.env, NO_COLOR: '1', ...extraEnv } });
    return { code: 0, stdout, stderr, ms: Date.now() - t0 };
  } catch (err) {
    const e = err as OffError;
    const ms = Date.now() - t0;
    if (typeof e.code === 'number') return { code: e.code, stdout: e.stdout ?? '', stderr: e.stderr ?? '', ms, ...(e.killed ? { killed: true } : {}) };
    if (e.killed || e.signal) return { code: null, stdout: e.stdout ?? '', stderr: e.stderr ?? '', killed: true, ms };
    return { code: null, stdout: e.stdout ?? '', stderr: e.stderr ?? '', startError: `${e.code ?? ''} ${e.message}`.trim(), ms };
  }
}

/** "11.12.2" from mxcli's "Connected to: project.mpr (Mendix 11.12.2)". */
export const mendixOf = (out: string) => /Connected to: .*\(Mendix ([0-9][\w.-]*)\)/.exec(out)?.[1];

const lastWords = (o: MxOut) =>
  stripNoise(`${o.stderr}\n${o.stdout}`)
    .split('\n')
    .filter((l) => l.trim())
    .slice(-3)
    .join(' ')
    .slice(0, 400);

const evidenceDir = (dataDir: string, floorId: string) => path.join(dataDir, 'testing', 'evidence', floorId);
/** The evidence locator kept in a record: relative to the office's data folder, forward slashes. */
const locator = (dataDir: string, file: string) => path.relative(dataDir, file).replace(/\\/g, '/');

export interface TestRunOpts {
  dataDir: string;
  floorId: string;
  floorDir: string;
  bin: string;
  mxcliVersion: string;
  sha: string;
  branch?: string;
  actor: string;
  /** The whole run's time limit when `limit` doesn't say (mxcli's own --timeout is the same, in minutes). */
  timeoutMs: number;
  /** The whole run's time limit for a run of `tests` tests: the project's own, or sized to the suite (release 82). */
  limit?: (tests: number) => { ms: number; auto: boolean };
  /** Only some of the test files: named ones, and/or the ones with a tag (shared/testing/test-files.ts). */
  subset?: RunSubset;
  /** What the run will cover, once the work folder is ready: the files, the tests counted in them, the limit. */
  onPlan?: (plan: { paths: string[]; tests: number; limitMs: number; auto: boolean }) => void;
  /** How far it has got (read off mxcli's output, shared/testing/run-progress.ts), on each change; the same object each time. */
  onProgress?: (p: RunProgress) => void;
  /** How long mxcli may take to end once it has written its results (run-guard.ts; default 30 s), and its output to close once it ended (default 5 s). */
  graceMs?: number;
  drainMs?: number;
  now?: () => number;
  /**
   * What the run needs, got ready first (test-db.ts prepareTestRun: the lower-case test database, the fixed
   * ports): the database it uses and what was done, or why the run can't start (a harness error that says so).
   */
  prepare?: (mprBase: string) => Promise<{ db: string; notes: string[] } | { why: string }>;
  /** One test runtime at a time on the machine (test-db.ts serialTestRuntime); runs it straight away without. */
  serial?: <T>(fn: () => Promise<T>) => Promise<T>;
  /** The mxbuild for the app (liveapp/mxbuild.ts pickMxbuild, as the live app and the app instances pick it): handed to mxcli as MXCLI_MXBUILD_PATH. */
  mxbuildFor?: (mprPath: string) => string | undefined;
  /**
   * What this mxcli's `test` can be told (test-flags.ts). With `--db-type` the run boots on the runtime's built-in
   * database (`--db-type hsqldb`): no PostgreSQL, no superuser, and `prepare` isn't needed; with the port flags it
   * runs on ports the office picks (`ports`). Without them, the older route: `prepare` and the fixed ports.
   */
  flags?: TestFlags;
  /** Three free ports (app, admin, serve) held for the run, and their release; undefined when none are free. */
  ports?: () => Promise<{ ports: number[]; release(): void } | undefined>;
  /** Extra environment for the older route (PGPASSWORD of the office's own database user, when that user is mxcli's `postgres`). */
  pgEnv?: Record<string, string>;
  /**
   * The project's instance constants for this run (app-instance/constants.ts testRunConstants): mxcli's
   * `--constant Module.Name=value`, the values never shown (a generated seed password), the seed password
   * constant declared and the model's password-like String constants (to name one when the seed finds it
   * empty); or why they can't be used (a harness error that says so, nothing started).
   */
  constants?: { args: string[]; secrets: string[]; seedPassword?: string; passwordConstants(): Promise<string[]> } | { why: string };
}

/** How the run boots its runtime, in words for the record. */
export const routeWords = (hsql: boolean) => (hsql ? "the runtime's built-in database (--db-type hsqldb: no PostgreSQL needed)" : 'PostgreSQL (<app>_test)');

export class NoTestsError extends Error {}

/** The most of mxcli's output kept with a run (its log beside the JUnit file). */
const LOG_MAX = 4 * 1024 * 1024;

/** A run stopped at its time limit, in words: where it was, what it had, what to do. ASCII punctuation only. */
export function stoppedWords(p: RunProgress, limit: { minutes: number; auto: boolean }, now: number, last: string): string {
  const notRun = p.total !== undefined ? Math.max(0, p.total - p.results.length) : undefined;
  const which = limit.auto ? 'sized to the suite' : "the project's own";
  return `Stopped at the time limit (${limit.minutes} min, ${which}) ${stoppedWhile(p, now)}${notRun !== undefined ? `; ${notRun} of ${p.total} never ran` : ''}. Raise the project's time limit (Testing > Quality) or run a subset (office-app test --files / --tag). (last: ${last || 'nothing'})`;
}

/**
 * One microflow test run on commit `sha`: the record to ingest (both revisions = the work folder's
 * commit) and where its JUnit file is kept. Throws NoTestsError when the commit has no test files (no
 * record: nothing was run); every other failure is a harness-error record.
 */
export function runMicroflowTests(o: TestRunOpts): Promise<{ draft: TestRunDraft; junit?: string }> {
  // One run at a time per work folder, and never into a folder a previous run still holds (run-guard.ts).
  return oneAtATime(workDirOf(o.dataDir, o.floorId, 'tests'), () => microflowRun(o));
}

async function microflowRun(o: TestRunOpts): Promise<{ draft: TestRunDraft; junit?: string }> {
  const now = o.now ?? Date.now;
  const runId = `mt_${ulid(now())}`;
  const startedAt = new Date(now()).toISOString();
  const dir = workDirOf(o.dataDir, o.floorId, 'tests');
  const evDir = evidenceDir(o.dataDir, o.floorId);
  const junitFile = path.join(evDir, `${runId}.junit.xml`);
  const envelope = (over: Partial<MxcliRunEnvelope>): MxcliRunEnvelope => ({
    runId,
    floor: o.floorId,
    commit: over.commit ?? o.sha,
    ...(o.branch ? { branch: o.branch } : {}),
    paths: [],
    environment: { runner: 'mxcli test (office)', mxcliVersion: o.mxcliVersion, runtime: 'local', workFolder: dir },
    startedAt,
    finishedAt: new Date(now()).toISOString(),
    exitCode: null,
    actor: o.actor,
    ...over,
  });
  let wf;
  try {
    const held = await freeFolder(dir);
    if (held) throw new Error(held);
    wf = await checkoutAt(o.floorDir, o.sha, dir, o.dataDir);
  } catch (err) {
    return { draft: draftFromMxcliRun(envelope({ failure: `The office could not prepare its work folder: ${heldWords((err as Error).message)}` }), undefined) };
  }
  try {
    const all = testPathsIn(wf.files);
    if (!all.length) throw new NoTestsError(`No microflow tests (.test.mdl / .test.md) at ${wf.commit.slice(0, 7)}`);
    // Each file's tests and tags, read by the office: the subset, the limit sized to the suite, and the tests a stopped run never reached.
    const catalog: TestFile[] = await Promise.all(all.map(async (f) => readTestFile(f, await readFile(path.join(wf.dir, f), 'utf8').catch(() => ''))));
    const picked = pickFiles(catalog, o.subset);
    const subset = isSubset(o.subset) ? { ...o.subset, paths: 'files' in picked ? picked.files.map((f) => f.file) : [] } : undefined;
    if ('why' in picked) return { draft: draftFromMxcliRun(envelope({ commit: wf.commit, paths: [], ...(subset ? { subset } : {}), failure: `Not started: ${picked.why}` }), undefined) };
    const files = picked.files;
    const paths = files.map((f) => f.file);
    const tests = files.reduce((n, f) => n + f.tests.length, 0);
    const lim = o.limit?.(tests) ?? { ms: o.timeoutMs, auto: false };
    const minutes = Math.max(1, Math.ceil(lim.ms / 60_000));
    const limit = { minutes, auto: lim.auto };
    o.onPlan?.({ paths, tests, limitMs: lim.ms, auto: lim.auto });
    await mkdir(evDir, { recursive: true, mode: 0o700 });
    // Only the file this run writes is ever read: one left from before is removed first.
    await rm(junitFile, { force: true });
    const args = ['test', ...paths, '-p', wf.mpr, '--local', '--require-assertions', '--junit', junitFile, '--timeout', `${minutes}m`];
    const base = path.basename(wf.mpr).replace(/\.mpr$/i, '');
    const flags = o.flags ?? NO_FLAGS;
    // Each phase and a line per test as they run: the progress, and a stopped run's partial results.
    if (flags.verbose) args.push('--verbose');
    const consts = o.constants && 'args' in o.constants ? o.constants : undefined;
    const more = { commit: wf.commit, paths, limit, ...(subset ? { subset } : {}) };
    if (o.constants && 'why' in o.constants) return { draft: draftFromMxcliRun(envelope({ ...more, failure: `Not started: ${o.constants.why}` }), undefined) };
    if (consts?.args.length) {
      const names = consts.args.map((c) => c.slice(0, c.indexOf('='))).join(', ');
      if (!flags.constant) return { draft: draftFromMxcliRun(envelope({ ...more, failure: `Not started: ${NEEDS_MXCLI} the project's instance constants (${names}) need \`mxcli test --constant\`, which mxcli ${o.mxcliVersion} doesn't have. Point the office at a newer mxcli (Connections > Folders > mxcli), then run the tests again.` }), undefined) };
      for (const c of consts.args) args.push('--constant', c);
    }
    // mxcli v0.27+: the built-in database, so nobody needs a PostgreSQL superuser (or any PostgreSQL at all).
    const hsql = flags.dbType;
    if (hsql) args.push('--db-type', 'hsqldb');
    // A generated seed password never reaches the record, the log or the page, even when mxcli echoes it.
    const mask = (t: string) => (consts?.secrets ?? []).reduce((acc, sec) => (sec ? acc.replaceAll(sec, '***') : acc), t);
    const progress = newProgress(now(), tests);
    const log: string[] = [];
    let logSize = 0;
    const onLine = (line: string, stream: 'stdout' | 'stderr') => {
      if (logSize < LOG_MAX) {
        const l = `${stream === 'stderr' ? '! ' : ''}${mask(line)}`;
        log.push(l);
        logSize += l.length + 1;
      }
      if (stream === 'stdout' && readLine(progress, line, now())) o.onProgress?.(progress);
    };
    const run = async (): Promise<{ ready?: { db: string; notes: string[] } | { why: string }; out?: MxOut }> => {
      const ready = hsql ? { db: '', notes: [`ran on ${routeWords(true)}`] } : o.prepare ? await o.prepare(base) : undefined;
      if (ready && 'why' in ready) return { ready };
      const held = hsql && flags.ports && o.ports ? await o.ports() : undefined;
      const a = held ? [...args, '--app-port', String(held.ports[0]), '--admin-port', String(held.ports[1]), '--serve-port', String(held.ports[2])] : args;
      const mxbuild = o.mxbuildFor?.(path.join(wf.dir, wf.mpr));
      try {
        // Started as the office's own (run-guard.ts): at the limit its whole tree stops, root first; it answers once
        // mxcli ends (not when the last process holding its output does), and soon after its results are in.
        const env = { ...(hsql ? {} : (o.pgEnv ?? {})), ...(mxbuild ? { MXCLI_MXBUILD_PATH: mxbuild, MXBUILD_PATH: mxbuild } : {}) };
        const hooks = { onLine, resultsIn: () => !!progress.junitWritten, ...(o.graceMs !== undefined ? { graceMs: o.graceMs } : {}), ...(o.drainMs !== undefined ? { drainMs: o.drainMs } : {}) };
        return { ready, out: await runMxOwned(dir, o.bin, a, wf.dir, lim.ms, env, {}, hooks) };
      } finally {
        held?.release();
      }
    };
    const got = await (o.serial ?? (<T>(fn: () => Promise<T>) => fn()))(run);
    if (got.ready && 'why' in got.ready) return { draft: draftFromMxcliRun(envelope({ ...more, failure: `Not started: ${got.ready.why}` }), undefined) };
    const out = { ...got.out!, stdout: mask(got.out!.stdout), stderr: mask(got.out!.stderr) };
    const db = got.ready && 'db' in got.ready && got.ready.db ? got.ready.db : undefined;
    const junitRaw = await readFile(junitFile, 'utf8').catch(() => undefined);
    const junit = junitRaw === undefined ? undefined : mask(junitRaw);
    if (junit !== undefined && junit !== junitRaw) await writeFile(junitFile, junit);
    // mxcli's whole output, masked, kept beside the JUnit: where a stopped run was, in mxcli's own words.
    const logFile = path.join(evDir, `${runId}.log`);
    const logKept = log.length ? await writeFile(logFile, `${log.join('\n')}\n`, { mode: 0o600 }).then(() => true, () => false) : false;
    const mendix = mendixOf(`${out.stdout}\n${out.stderr}`);
    // No results: why, in mxcli's words and what they mean (shared/testing/test-reason.ts), never "no JUnit file" alone.
    // The app's startup seed refused an empty password: name the constant the run left empty.
    const emptySeed = EMPTY_PASSWORD.test(`${junit ?? ''}\n${out.stdout}\n${out.stderr}`) ? emptySeedPasswordWhy((await consts?.passwordConstants().catch(() => [])) ?? [], consts?.seedPassword) : undefined;
    const stopped = out.killed ? stoppedWords(progress, limit, now(), lastWords(out)) : undefined;
    const failure = junit === undefined ? (emptySeed ?? stopped ?? testRunWhy({ ...out, minutes }, db, { mxcliVersion: o.mxcliVersion, hsql })) : emptySeed;
    // No JUnit file, but the run got to its tests (or was stopped): what mxcli said live for each, and the rest as never run.
    const partialWhy = out.killed ? `the run was stopped at its ${minutes}-min time limit ${stoppedWhile(progress, now())}` : 'the run ended before it got to it';
    const partial = junit === undefined && (out.killed || progress.results.length) ? partialResults(files, progress, partialWhy) : undefined;
    const env = envelope({
      ...more,
      environment: { runner: 'mxcli test (office)', mxcliVersion: o.mxcliVersion, runtime: 'local', workFolder: wf.dir, ...(mendix ? { mendixVersion: mendix } : {}) },
      workFolderReal: await realpath(wf.dir).catch(() => wf.dir),
      exitCode: out.code,
      ...(junit !== undefined ? { junitLocator: locator(o.dataDir, junitFile) } : {}),
      ...(logKept ? { logLocator: locator(o.dataDir, logFile) } : {}),
      ...(partial ? { partial } : {}),
      ...(failure ? { failure } : {}),
      tail: [...(got.ready && 'notes' in got.ready ? got.ready.notes : []), out.lingered ? "mxcli wrote its results but hadn't ended a while later, so the office stopped it" : '', lastWords(out)].filter(Boolean).join(' · ').slice(0, 600),
    });
    return { draft: draftFromMxcliRun(env, junit), ...(junit !== undefined ? { junit: junitFile } : {}) };
  } finally {
    await disposeFolder(dir);
  }
}

export interface QualityOpts {
  dataDir: string;
  floorId: string;
  floorDir: string;
  bin: string;
  mxcliVersion: string;
  sha: string;
  branch?: string;
  trigger: string;
  timeoutMs?: number;
  now?: () => number;
}

/** The JSON object in mxcli's stdout (from its first `{`), or undefined. */
function jsonIn(out: string): string | undefined {
  const s = stripNoise(out);
  const i = s.indexOf('{');
  return i < 0 ? undefined : s.slice(i);
}

/** Report, lint and the catalog's schema on commit `sha`, in the office's work folder: the record to keep. */
export function runQuality(o: QualityOpts): Promise<QualityDraft> {
  return oneAtATime(workDirOf(o.dataDir, o.floorId, 'quality'), () => qualityRun(o));
}

async function qualityRun(o: QualityOpts): Promise<QualityDraft> {
  const now = o.now ?? Date.now;
  const timeout = o.timeoutMs ?? 180_000;
  const startedAt = new Date(now()).toISOString();
  const dir = workDirOf(o.dataDir, o.floorId, 'quality');
  const evDir = evidenceDir(o.dataDir, o.floorId);
  const timings: Record<string, number> = {};
  const errors: string[] = [];
  const t0 = Date.now();
  const held = await freeFolder(dir);
  if (held) throw new Error(held);
  const wf = await checkoutAt(o.floorDir, o.sha, dir, o.dataDir).catch((err: Error) => {
    throw new Error(heldWords(err.message));
  });
  timings.checkout = Date.now() - t0;
  const tag = `q_${wf.commit.slice(0, 12)}_${o.mxcliVersion.replace(/[^\w.-]/g, '_')}`;
  try {
    await mkdir(evDir, { recursive: true, mode: 0o700 });
    const reportFile = path.join(evDir, `${tag}.report.json`);
    const lintFile = path.join(evDir, `${tag}.lint.json`);
    await rm(reportFile, { force: true });
    const rep = await runMxOwned(dir, o.bin, ['report', '-p', wf.mpr, '--format', 'json', '-o', reportFile], wf.dir, timeout);
    timings.report = rep.ms;
    const reportText = await readFile(reportFile, 'utf8').catch(() => undefined);
    const report = reportText ? parseReportJson(reportText) : undefined;
    if (!report) errors.push(`report gave no scores (exit ${rep.code ?? 'none'}${rep.killed ? ', timed out' : ''}${rep.startError ? `, ${rep.startError}` : ''}): ${lastWords(rep)}`);

    // lint exits 1 when it found an error-severity finding: its JSON decides, not the code.
    const lnt = await runMxOwned(dir, o.bin, ['lint', '-p', wf.mpr, '--format', 'json'], wf.dir, timeout);
    timings.lint = lnt.ms;
    const lintText = jsonIn(lnt.stdout);
    const lint = lintText ? parseLintJson(lintText) : undefined;
    if (lintText) await writeFile(lintFile, lintText, { mode: 0o600 });
    if (!lint) errors.push(`lint gave no findings list (exit ${lnt.code ?? 'none'}${lnt.killed ? ', timed out' : ''}${lnt.startError ? `, ${lnt.startError}` : ''}): ${lastWords(lnt)}`);

    const meta = await runMxOwned(dir, o.bin, ['-p', wf.mpr, '--json', '-c', 'select * from CATALOG.catalog_meta'], wf.dir, 60_000);
    timings.catalog = meta.ms;
    const rows = (() => {
      try {
        const s = stripNoise(meta.stdout);
        const i = s.indexOf('[');
        return i < 0 ? [] : (JSON.parse(s.slice(i)) as { Key?: string; Value?: string }[]);
      } catch {
        return [];
      }
    })();
    const metaOf = (k: string) => rows.find((r) => r.Key === k)?.Value;
    const mendix = metaOf('mendix_version') ?? mendixOf(`${rep.stdout}\n${rep.stderr}`);
    const schema = metaOf('schema_version');
    timings.total = Date.now() - t0;
    return {
      sourceKey: qualityKey(wf.commit, o.mxcliVersion),
      commit: wf.commit,
      ...(o.branch ? { branch: o.branch } : {}),
      mxcliVersion: o.mxcliVersion,
      ...(schema ? { catalogSchema: schema } : {}),
      ...(mendix ? { mendixVersion: mendix } : {}),
      startedAt,
      finishedAt: new Date(now()).toISOString(),
      timings,
      ...(report ? { report } : {}),
      ...(lint ? { lint } : {}),
      ruleFailures: [...ruleFailuresOf('report', reportText, rep.stderr), ...ruleFailuresOf('lint', lintText, lnt.stderr)],
      errors,
      evidence: { ...(reportText ? { report: locator(o.dataDir, reportFile) } : {}), ...(lintText ? { lint: locator(o.dataDir, lintFile) } : {}) },
      trigger: o.trigger,
      workFolder: wf.dir,
    };
  } finally {
    await disposeFolder(dir);
  }
}
