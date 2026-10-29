// Journeys and smoke runs on an agent's app instance (./service.ts), with results bound to the instance's
// commit in the test-run store (testing/store.ts, source `office-journey`): the Testing page, the live app's
// readiness and a Developer change's Checks fact read them there for exactly that commit.
//   * Who signs in: the project's own test users (./identity.ts: its config unless it's the toolkit template's,
//     the journeys' personas, the instance's seed password); a refused sign-in says what to do and is raised for
//     the PM (`onSignInFailed`). A project's .journey.js script is played by ./journey-js.ts instead.
//   * A journey is the project's own (tests/**/*.journey.json at the commit, by its id or path) or a file the
//     agent sends (its worktree's, maybe uncommitted: then its definition revision is "unknown"). It is played
//     by the walkthrough recorder unfilmed (walkthroughs/recorder.ts, film: false: the toolkit journey runner's
//     actions and checks), signed in as the journey's identity, and signed out when it ends (an unlicensed
//     Mendix app keeps only 6 sessions: shared/liveapp/session-cap.ts).
//   * A smoke run signs in once and opens each page address asked for (default the home page), failing on an
//     error dialog. Both read the instance's runtime log for the stretch they ran: an ERROR or CRITICAL entry
//     there (a page's "Operator formatDecimal not supported…") is a failed check with its line, even when every
//     step passed on screen. A refused session is said plainly, with what to do.

import { mkdir, open, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ulid } from '../../shared/evidence/ids.js';
import { outcomeWords, runtimeErrorsIn, runtimeErrorWords, SEED_JOURNEY, type RunOutcome } from '../../shared/agent-app.js';
import { CAP_REASON, isSessionCap, TRIAL_SESSIONS } from '../../shared/liveapp/session-cap.js';
import { IMPORTER_VERSION, UNKNOWN, type Link, type TestResult, type TestRunDraft } from '../../shared/testing/record.js';
import { resolveIdentity, SOURCE_WORDS, type RunnerConfig } from '../../shared/walkthroughs/identity.js';
import { scriptOf } from '../../shared/walkthroughs/script.js';
import { DEFAULT_SETTINGS, type WalkScript } from '../../shared/walkthroughs/types.js';
import { testingStore } from '../testing/index.js';
import { listFiles, readFiles } from '../testing/repo.js';
import { appShows } from '../walkthroughs/actions.js';
import { record as realRecord, type RecordInput, type RecordResult } from '../walkthroughs/recorder.js';
import { AppSessions, IN_APP, lockTo, VIEWPORT, type Browser } from '../walkthroughs/signin.js';
import type { AgentApp } from './service.js';
import { identitiesFor, JOURNEY_FILE } from './identity.js';
import { jsJourneyId, runJsJourney } from './journey-js.js';
import { personasIn, signInHelp, type ProjectIdentities } from '../../shared/agent-app-identity.js';

export { outcomeWords };

export interface JourneyDeps {
  dataDir: string;
  floorDir: string;
  mxcliVersion?: string;
  launch?: () => Promise<Browser>;
  record?: (i: RecordInput) => Promise<RecordResult>;
  runnerConfig?: (dir: string, commit: string) => Promise<RunnerConfig | undefined>;
  /** Stand-in for journey-js.ts runJsJourney (tests). */
  js?: typeof runJsJourney;
  /** A sign-in the app refused: raised for the Project Manager (agent-app/raise.ts); the escalation's id. */
  onSignInFailed?: (e: AgentApp, words: string) => string | undefined;
  /** The demo user when the project names none (the Walkthroughs setting's default). */
  demo?: { user: string; password: string };
  now?: () => number;
}

export interface JourneyAsk {
  /** A journey's id ("J-12") or its path in the repository. */
  journey?: string;
  /** A journey file the agent sends: its path (for the record) and text. */
  file?: string;
  text?: string;
}

/** The log's size now (where a run's stretch starts). */
const sizeOf = (f: string) => stat(f).then((s) => s.size, () => 0);

/** The runtime log written since byte `from` (the last 512 KB of it at most). */
async function logSince(file: string, from: number): Promise<string> {
  const size = await sizeOf(file);
  if (size <= from) return '';
  const start = Math.max(from, size - 512 * 1024);
  const fh = await open(file, 'r').catch(() => undefined);
  if (!fh) return '';
  try {
    const buf = Buffer.alloc(size - start);
    await fh.read(buf, 0, buf.length, start);
    return buf.toString('utf8');
  } finally {
    await fh.close();
  }
}

/** The plain words for a refused session. */
export const sessionCapWords = (said?: string) =>
  `The app refused a new session (${said ? `“${said}”: ` : ''}${CAP_REASON}). The journey runner signs out after every journey, so other sessions hold the rest: your own browser scripts that didn't sign out, or windows left open. They end about 15 minutes after they were last used, or start the instance again (office-app stop, then start) for a clean ${TRIAL_SESSIONS}.`;

type Script = { kind: 'json'; sc: WalkScript; definition: string } | { kind: 'js'; file: string; text?: string; id: string; persona?: string; definition: string };

/** The journey asked for (a toolkit .journey.json, or a project's own .journey.js script), and the revision its definition is from. */
async function scriptFor(e: AgentApp, ask: JourneyAsk, d: JourneyDeps): Promise<Script | string> {
  if (ask.text !== undefined) {
    const file = ask.file ?? 'journey.json';
    if (/\.journey\.c?js$|\.c?js$/i.test(file)) return { kind: 'js', file, text: ask.text, id: jsJourneyId(file, ask.text), persona: personasIn(ask.text)[0], definition: UNKNOWN };
    const sc = scriptOf(file, ask.text);
    return typeof sc === 'string' ? sc : { kind: 'json', sc, definition: UNKNOWN };
  }
  const want = (ask.journey ?? '').trim();
  if (!want) return 'Say which journey: its id (J-12) or its path, or send a file';
  const files = (await listFiles(d.floorDir, e.commit, ['tests'])).filter((f) => JOURNEY_FILE.test(f)).slice(0, 300);
  const texts = await readFiles(d.floorDir, e.commit, files, 512 * 1024);
  const norm = want.replace(/\\/g, '/').replace(/^\.\//, '');
  const byPath = (f: string) => f === norm || f.endsWith(`/${norm}`);
  for (const f of files.filter((x) => /\.json$/i.test(x))) {
    const sc = scriptOf(f, texts.get(f) ?? '');
    if (typeof sc === 'string') continue;
    if (sc.journey.toLowerCase() === norm.toLowerCase() || byPath(f)) return { kind: 'json', sc, definition: e.commit };
  }
  // A project's own script (tests/e2e/J-16.journey.js): by its id or its path.
  for (const f of files.filter((x) => /\.c?js$/i.test(x))) {
    const id = jsJourneyId(f, texts.get(f) ?? '');
    if (id.toLowerCase() === norm.toLowerCase() || byPath(f)) return { kind: 'js', file: f, id, persona: personasIn(texts.get(f) ?? '')[0], definition: e.commit };
  }
  return `No journey ${want} at ${e.commit.slice(0, 7)} (tests/**/*.journey.json or *.journey.js${files.length ? `: ${files.length} there` : ': none there'}). Commit it first, or send the file (office-app journey --file <path>)`;
}

/** The project's test users for this instance (agent-app/identity.ts). */
const idsOf = (e: AgentApp, d: JourneyDeps): Promise<ProjectIdentities> => identitiesFor(d.floorDir, e.commit, e.instance?.runtimeLog, { ...(d.runnerConfig ? { runnerConfig: d.runnerConfig } : {}), ...(e.generated ? { generated: e.generated } : {}) });

/** A refused sign-in, said with who, where the account came from and what to do, and raised for the PM. */
function signInFailure(e: AgentApp, d: JourneyDeps, failure: string, who: { user: string; from: string }, ids: ProjectIdentities): string {
  const help = signInHelp(who.user, who.from, ids);
  const raised = d.onSignInFailed?.(e, `${failure} ${help}`);
  return `${failure}. ${help}${raised ? ` (raised as ${raised})` : ''}`;
}

const SIGN_IN = /couldn['’]t sign in|still on the sign-in page/i;

/** Plays a journey on the agent's instance; records the result against its commit unless `keep` is false. */
export async function runJourney(e: AgentApp, ask: JourneyAsk, d: JourneyDeps, keep = true): Promise<RunOutcome> {
  const inst = e.instance;
  if (!inst) return { suite: 'journey', commit: e.commit, status: 'error', failure: 'the instance is not running' };
  const got = await scriptFor(e, ask, d);
  if (typeof got === 'string') return { suite: 'journey', commit: e.commit, status: 'error', failure: got };
  const { definition } = got;
  const journey = got.kind === 'json' ? got.sc.journey : got.id;
  const file = got.kind === 'json' ? got.sc.file : got.file;
  const requirement = got.kind === 'json' ? got.sc.requirement : [];
  const now = d.now ?? Date.now;
  const runId = `oj_${ulid(now())}`;
  const startedAt = new Date(now()).toISOString();
  const ids = await idsOf(e, d);
  const demo = d.demo ?? { user: DEFAULT_SETTINGS.demoUser, password: DEFAULT_SETTINGS.demoPassword };
  const hint = got.kind === 'json' ? (got.sc.identity ?? { names: [] }) : got.persona ? { user: got.persona, names: [got.persona] } : { names: [] };
  const who = resolveIdentity(hint, ids.cfg, demo);
  const whoFrom = who.from === 'setting' ? SOURCE_WORDS.setting : who.from === 'journey' ? 'named by the journey' : 'the project’s test users';
  const from = await sizeOf(inst.runtimeLog);
  let res: { status: string; steps: { n: number; caption: string; status: string; why?: string }[]; failure?: { step?: number; why: string } };
  let signInRefused = false;
  if (got.kind === 'js') {
    const o = await (d.js ?? runJsJourney)({ workspace: e.workspace, file: got.file, ...(got.text !== undefined ? { text: got.text } : {}), url: inst.url, login: { user: who.user, password: who.password }, signal: e.abort.signal });
    signInRefused = !!o.signIn;
    res = { status: o.status, steps: o.steps, ...(o.failure ? { failure: { why: o.failure } } : {}) };
  } else {
    const sessions = new AppSessions({ url: inst.url, runtimeLog: inst.runtimeLog, ...(d.launch ? { launch: d.launch } : {}) });
    const outDir = path.join(d.dataDir, 'testing', 'evidence', e.floorId, runId);
    try {
      res = await (d.record ?? realRecord)({ url: inst.url, script: got.sc, outDir, login: { user: who.user, password: who.password }, sessions, film: false, signal: e.abort.signal, workspace: e.workspace });
    } finally {
      // Signed out, every time: the trial licence's sessions are few.
      await sessions.close().catch(() => undefined);
    }
    signInRefused = SIGN_IN.test(res.failure?.why ?? '') && !isSessionCap(res.failure?.why);
  }
  const log = await logSince(inst.runtimeLog, from);
  const errors = runtimeErrorsIn(log).map(runtimeErrorWords);
  const capped = isSessionCap(res.failure?.why) || /Maximum number of sessions exceeded/i.test(log);
  const status: RunOutcome['status'] = capped || signInRefused || res.status === 'error' || res.status === 'cancelled' ? 'error' : res.status === 'failed' || errors.length ? 'failed' : 'passed';
  let failure = res.failure ? (res.failure.step ? `step ${res.failure.step}: ${res.failure.why}` : res.failure.why) : undefined;
  if (signInRefused && keep && !capped) failure = signInFailure(e, d, failure ?? `couldn't sign in as ${who.user}`, { user: who.user, from: whoFrom }, ids);
  const outcome: RunOutcome = {
    suite: `journey ${journey}`,
    commit: e.commit,
    status,
    steps: res.steps.map((s) => ({ n: s.n, caption: s.caption, status: s.status, ...(s.why ? { why: s.why } : {}) })),
    ...(failure ? { failure } : {}),
    ...(errors.length ? { runtimeErrors: errors } : {}),
    ...(capped ? { sessionCap: sessionCapWords() } : {}),
    signedOut: got.kind === 'json',
  };
  if (!keep) return outcome;
  const links: Link[] = [{ target: journey, basis: 'recorded', via: definition === UNKNOWN ? `${file} (sent by ${e.worker})` : file }, ...requirement.map((r): Link => ({ target: r, basis: 'recorded', via: `${file} (requirement)` }))];
  const results: TestResult[] =
    status === 'error'
      ? []
      : [
          { name: journey, status: status === 'passed' ? 'passed' : 'failed', ...(outcome.failure || errors.length ? { detail: [outcome.failure, ...errors.map((x) => `runtime error: ${x}`)].filter(Boolean).join(' · ').slice(0, 600) } : {}), links },
          ...errors.map((x, i): TestResult => ({ name: `${journey} runtime log ${i + 1}`, status: 'failed', detail: x, links: [links[0]] })),
        ];
  outcome.record = await keepRecord(e, d, runId, startedAt, outcome, results, definition, now, { steps: res.steps, log: errors, identity: who.user, ...(got.kind === 'js' ? { runner: 'node (the project’s journey script)' } : {}) });
  return outcome;
}

/** A smoke click-through: signs in once, opens each address (default the home page), fails on an error dialog or a runtime error. */
export async function runSmoke(e: AgentApp, ask: { paths?: string[]; as?: string }, d: JourneyDeps): Promise<RunOutcome> {
  const inst = e.instance;
  if (!inst) return { suite: 'smoke', commit: e.commit, status: 'error', failure: 'the instance is not running' };
  const paths = (ask.paths?.length ? ask.paths : ['/']).slice(0, 20).map((p) => (p.startsWith('/') ? p : `/${p}`));
  const now = d.now ?? Date.now;
  const runId = `os_${ulid(now())}`;
  const startedAt = new Date(now()).toISOString();
  // The project's own test users (its config unless that is the toolkit template's, the journeys' personas, the seed password).
  const ids = await idsOf(e, d);
  const demo = d.demo ?? { user: DEFAULT_SETTINGS.demoUser, password: DEFAULT_SETTINGS.demoPassword };
  const who = resolveIdentity(ask.as ? { user: ask.as, names: [ask.as] } : { names: [] }, ids.cfg, demo);
  const whoFrom = ask.as ? 'asked with --as' : who.from === 'setting' ? SOURCE_WORDS.setting : 'the project’s test users';
  const from = await sizeOf(inst.runtimeLog);
  const sessions = new AppSessions({ url: inst.url, runtimeLog: inst.runtimeLog, ...(d.launch ? { launch: d.launch } : {}) });
  const steps: NonNullable<RunOutcome['steps']> = [];
  let failure: string | undefined;
  try {
    const state = await sessions.storage({ user: who.user, password: who.password });
    const browser = await sessions.browserNow();
    const ctx = await browser.newContext({ viewport: VIEWPORT, serviceWorkers: 'block', storageState: state });
    try {
      await lockTo(new URL(inst.url).origin)(ctx);
      const page = await ctx.newPage();
      for (const [i, p] of paths.entries()) {
        const step = { n: i + 1, caption: `Open ${p}`, status: 'passed' as string, why: undefined as string | undefined };
        try {
          await page.goto(new URL(p, inst.url).href, { waitUntil: 'domcontentloaded', timeout: 30_000 });
          await page.locator(IN_APP).first().waitFor({ state: 'visible', timeout: 15_000 }).catch(() => undefined);
          await page.waitForTimeout(1500);
          const said = await appShows(page);
          if (said && (said.kind === 'error' || said.kind === 'warning')) Object.assign(step, { status: 'failed', why: `the app showed ${said.kind === 'error' ? 'an error' : 'a warning'}: “${said.text}”` });
        } catch (err) {
          Object.assign(step, { status: 'failed', why: String((err as Error).message).split('\n')[0].slice(0, 200) });
        }
        steps.push({ n: step.n, caption: step.caption, status: step.status, ...(step.why ? { why: step.why } : {}) });
      }
    } finally {
      await ctx.close().catch(() => undefined);
    }
  } catch (err) {
    failure = String((err as Error).message).slice(0, 400);
  } finally {
    await sessions.close().catch(() => undefined);
  }
  const log = await logSince(inst.runtimeLog, from);
  const errors = runtimeErrorsIn(log).map(runtimeErrorWords);
  const capped = isSessionCap(failure) || /Maximum number of sessions exceeded/i.test(log);
  const status: RunOutcome['status'] = failure || capped ? 'error' : steps.some((s) => s.status === 'failed') || errors.length ? 'failed' : 'passed';
  // A refused sign-in: who, from where, what to do, and raised for the PM (never a quiet idle).
  if (failure && !capped && SIGN_IN.test(failure)) failure = signInFailure(e, d, failure, { user: who.user, from: whoFrom }, ids);
  const outcome: RunOutcome = { suite: 'smoke', commit: e.commit, status, steps, ...(failure ? { failure } : {}), ...(errors.length ? { runtimeErrors: errors } : {}), ...(capped ? { sessionCap: sessionCapWords() } : {}), signedOut: true };
  const link: Link = { target: 'smoke', basis: 'recorded', via: `office-app smoke (${e.worker})` };
  const results: TestResult[] = status === 'error' ? [] : [...steps.map((s): TestResult => ({ name: `smoke ${s.caption.replace(/^Open /, '')}`, status: s.status === 'passed' ? 'passed' : 'failed', ...(s.why ? { detail: s.why } : {}), links: [link] })), ...errors.map((x, i): TestResult => ({ name: `smoke runtime log ${i + 1}`, status: 'failed', detail: x, links: [link] }))];
  outcome.record = await keepRecord(e, d, runId, startedAt, outcome, results, UNKNOWN, now, { steps, log: errors, identity: who.user });
  return outcome;
}

/** The record, bound to the instance's commit, and its evidence file. */
async function keepRecord(e: AgentApp, d: JourneyDeps, runId: string, startedAt: string, o: RunOutcome, results: TestResult[], definition: string, now: () => number, evidence: unknown): Promise<string | undefined> {
  const dir = path.join(d.dataDir, 'testing', 'evidence', e.floorId);
  const file = path.join(dir, `${runId}.json`);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await writeFile(file, JSON.stringify({ runId, commit: e.commit, suite: o.suite, status: o.status, by: e.worker, ...((evidence as object) ?? {}) }, null, 1), { mode: 0o600 });
  const draft: TestRunDraft = {
    source: 'office-journey',
    sourceKey: `office-journey:${e.floorId}:${runId}`,
    suite: o.suite,
    testedRevision: e.commit,
    definitionRevision: definition,
    evidence: { kind: 'office', revision: runId, locator: `office:${path.relative(d.dataDir, file).replace(/\\/g, '/')}` },
    startedAt,
    finishedAt: new Date(now()).toISOString(),
    results,
    links: [],
    actor: { kind: 'office', name: `${e.worker} (office-app)` },
    environment: { runner: (evidence as { runner?: string } | undefined)?.runner ?? 'office journey runner (Playwright, agent instance)', mxcliVersion: d.mxcliVersion ?? 'unknown', runtime: 'local', workFolder: e.workspace },
    ...(o.status === 'error' ? { harnessError: [o.failure, o.sessionCap].filter(Boolean).join(' ').slice(0, 600) || 'the run did not complete' } : {}),
    importer: `${IMPORTER_VERSION}+office-journey/1`,
  };
  const [rec] = await testingStore(d.dataDir, e.floorId).ingest([draft]);
  return rec?.id;
}

/** The project's seed journey (SEED_JOURNEY), played once on a fresh instance; what seeded it, in words. */
export async function playSeed(e: AgentApp, d: JourneyDeps): Promise<string | undefined> {
  const has = (await listFiles(d.floorDir, e.commit, [SEED_JOURNEY], false).catch(() => [] as string[])).includes(SEED_JOURNEY);
  if (!has) return undefined;
  const o = await runJourney(e, { journey: SEED_JOURNEY }, d, false);
  return `the after-startup microflow, then ${SEED_JOURNEY}: ${o.status === 'passed' ? 'played' : `didn't finish (${o.failure ?? o.runtimeErrors?.[0] ?? o.status})`}`;
}
