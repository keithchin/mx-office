// The office's own mxcli runs for the Testing tab (Testing release 1b), each in a fresh work folder at a
// known commit (workfolder.ts) and off the event loop:
//   * microflow tests: `mxcli test <files> -p <app>.mpr --local --require-assertions --junit <file>`,
//     the JUnit file written into the office's data folder and read inside the run's envelope
//     (shared/testing/junit.ts). It needs a Mendix runtime, so it may legitimately fail to start: that
//     is recorded as a harness error, never as failed tests. Exit code 1 is never read on its own.
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
import { testRunWhy } from '../../shared/testing/test-reason.js';
import { checkoutAt, disposeFolder, testPathsIn, workDirOf } from './workfolder.js';
import { NO_FLAGS, type TestFlags } from './test-flags.js';

export interface MxOut {
  code: number | null;
  stdout: string;
  stderr: string;
  /** Stopped by the timeout. */
  killed?: boolean;
  /** It never started (ENOENT, EACCES…). */
  startError?: string;
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
  /** mxcli's own runtime timeout; the process gets a minute more. */
  timeoutMs: number;
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
}

/** How the run boots its runtime, in words for the record. */
export const routeWords = (hsql: boolean) => (hsql ? "the runtime's built-in database (--db-type hsqldb: no PostgreSQL needed)" : 'PostgreSQL (<app>_test)');

export class NoTestsError extends Error {}

/**
 * One microflow test run on commit `sha`: the record to ingest (both revisions = the work folder's
 * commit) and where its JUnit file is kept. Throws NoTestsError when the commit has no test files (no
 * record: nothing was run); every other failure is a harness-error record.
 */
export async function runMicroflowTests(o: TestRunOpts): Promise<{ draft: TestRunDraft; junit?: string }> {
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
    wf = await checkoutAt(o.floorDir, o.sha, dir, o.dataDir);
  } catch (err) {
    return { draft: draftFromMxcliRun(envelope({ failure: `The office could not prepare its work folder: ${(err as Error).message}` }), undefined) };
  }
  try {
    const paths = testPathsIn(wf.files);
    if (!paths.length) throw new NoTestsError(`No microflow tests (.test.mdl / .test.md) at ${wf.commit.slice(0, 7)}`);
    await mkdir(evDir, { recursive: true, mode: 0o700 });
    // Only the file this run writes is ever read: one left from before is removed first.
    await rm(junitFile, { force: true });
    const minutes = Math.max(1, Math.round(o.timeoutMs / 60_000));
    const args = ['test', ...paths, '-p', wf.mpr, '--local', '--require-assertions', '--junit', junitFile, '--timeout', `${minutes}m`];
    const base = path.basename(wf.mpr).replace(/\.mpr$/i, '');
    const flags = o.flags ?? NO_FLAGS;
    // mxcli v0.27+: the built-in database, so nobody needs a PostgreSQL superuser (or any PostgreSQL at all).
    const hsql = flags.dbType;
    if (hsql) args.push('--db-type', 'hsqldb');
    const run = async (): Promise<{ ready?: { db: string; notes: string[] } | { why: string }; out?: MxOut }> => {
      const ready = hsql ? { db: '', notes: [`ran on ${routeWords(true)}`] } : o.prepare ? await o.prepare(base) : undefined;
      if (ready && 'why' in ready) return { ready };
      const held = hsql && flags.ports && o.ports ? await o.ports() : undefined;
      const a = held ? [...args, '--app-port', String(held.ports[0]), '--admin-port', String(held.ports[1]), '--serve-port', String(held.ports[2])] : args;
      const mxbuild = o.mxbuildFor?.(path.join(wf.dir, wf.mpr));
      try {
        return { ready, out: await runMx(o.bin, a, wf.dir, o.timeoutMs + 60_000, { ...(hsql ? {} : (o.pgEnv ?? {})), ...(mxbuild ? { MXCLI_MXBUILD_PATH: mxbuild, MXBUILD_PATH: mxbuild } : {}) }) };
      } finally {
        held?.release();
      }
    };
    const got = await (o.serial ?? (<T>(fn: () => Promise<T>) => fn()))(run);
    if (got.ready && 'why' in got.ready) return { draft: draftFromMxcliRun(envelope({ commit: wf.commit, paths, failure: `Not started: ${got.ready.why}` }), undefined) };
    const out = got.out!;
    const db = got.ready && 'db' in got.ready && got.ready.db ? got.ready.db : undefined;
    const junit = await readFile(junitFile, 'utf8').catch(() => undefined);
    const mendix = mendixOf(`${out.stdout}\n${out.stderr}`);
    // No results: why, in mxcli's words and what they mean (shared/testing/test-reason.ts), never "no JUnit file" alone.
    const failure = junit === undefined ? testRunWhy({ ...out, minutes: minutes + 1 }, db, { mxcliVersion: o.mxcliVersion, hsql }) : undefined;
    const env = envelope({
      commit: wf.commit,
      paths,
      environment: { runner: 'mxcli test (office)', mxcliVersion: o.mxcliVersion, runtime: 'local', workFolder: wf.dir, ...(mendix ? { mendixVersion: mendix } : {}) },
      workFolderReal: await realpath(wf.dir).catch(() => wf.dir),
      exitCode: out.code,
      ...(junit !== undefined ? { junitLocator: locator(o.dataDir, junitFile) } : {}),
      ...(failure ? { failure } : {}),
      tail: [...(got.ready && 'notes' in got.ready ? got.ready.notes : []), lastWords(out)].filter(Boolean).join(' · ').slice(0, 600),
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
export async function runQuality(o: QualityOpts): Promise<QualityDraft> {
  const now = o.now ?? Date.now;
  const timeout = o.timeoutMs ?? 180_000;
  const startedAt = new Date(now()).toISOString();
  const dir = workDirOf(o.dataDir, o.floorId, 'quality');
  const evDir = evidenceDir(o.dataDir, o.floorId);
  const timings: Record<string, number> = {};
  const errors: string[] = [];
  const t0 = Date.now();
  const wf = await checkoutAt(o.floorDir, o.sha, dir, o.dataDir);
  timings.checkout = Date.now() - t0;
  const tag = `q_${wf.commit.slice(0, 12)}_${o.mxcliVersion.replace(/[^\w.-]/g, '_')}`;
  try {
    await mkdir(evDir, { recursive: true, mode: 0o700 });
    const reportFile = path.join(evDir, `${tag}.report.json`);
    const lintFile = path.join(evDir, `${tag}.lint.json`);
    await rm(reportFile, { force: true });
    const rep = await runMx(o.bin, ['report', '-p', wf.mpr, '--format', 'json', '-o', reportFile], wf.dir, timeout);
    timings.report = rep.ms;
    const reportText = await readFile(reportFile, 'utf8').catch(() => undefined);
    const report = reportText ? parseReportJson(reportText) : undefined;
    if (!report) errors.push(`report gave no scores (exit ${rep.code ?? 'none'}${rep.killed ? ', timed out' : ''}${rep.startError ? `, ${rep.startError}` : ''}): ${lastWords(rep)}`);

    // lint exits 1 when it found an error-severity finding: its JSON decides, not the code.
    const lnt = await runMx(o.bin, ['lint', '-p', wf.mpr, '--format', 'json'], wf.dir, timeout);
    timings.lint = lnt.ms;
    const lintText = jsonIn(lnt.stdout);
    const lint = lintText ? parseLintJson(lintText) : undefined;
    if (lintText) await writeFile(lintFile, lintText, { mode: 0o600 });
    if (!lint) errors.push(`lint gave no findings list (exit ${lnt.code ?? 'none'}${lnt.killed ? ', timed out' : ''}${lnt.startError ? `, ${lnt.startError}` : ''}): ${lastWords(lnt)}`);

    const meta = await runMx(o.bin, ['-p', wf.mpr, '--json', '-c', 'select * from CATALOG.catalog_meta'], wf.dir, 60_000);
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
