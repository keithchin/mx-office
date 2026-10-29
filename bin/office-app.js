#!/usr/bin/env node
// office-app: an agent's own running copy of its app, from the office (src/server/agent-app/, the
// /office/app endpoint on the loopback hook port). Start an instance at a commit (your candidate, or main),
// get its address and test users, run journeys and a smoke click-through on it (results recorded against that
// commit: the Testing page and the change's Checks show them), run the microflow tests at a commit, stop it.
// Never start the app yourself with `mxcli run --local` in a worktree: that leaves processes and databases
// behind and its results count for nothing. The office puts this on every worker's PATH (also as
// office-journey: `office-journey run <J-id|file>`), and its tools are in the office's MCP server
// (bin/office-workers.js mcp). Plain Node, no dependencies.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const APP_USAGE = `  office-app start [--commit <sha|main|HEAD>] [--const Module.Name=value]... [--no-wait]
                                                a running instance of the app at that commit (default:
                                                HEAD of this folder, committed files only), on its own
                                                ports and fresh database; waits until it answers and
                                                prints its URL and test users. One per agent: another
                                                commit (or other constants) replaces it. Stops after 15
                                                min unused. --const sets a constant for this run only
                                                (over .agent-office/instance-constants.json; never the
                                                model): no secrets, the seed password is generated
  office-app status                             your instance now (and its generated test password)
  office-app journey <J-id|path> [--commit <sha>]
                                                play a journey on it (the project's at that commit by id
                                                or path, or a file of yours): a toolkit .journey.json, or
                                                a .journey.js script run with node against the instance
                                                (APP_URL, TEST_USER/TEST_PASS set); runtime errors in the
                                                app's log fail it; recorded at the commit
  office-app smoke [--page /p/addr]... [--as <user>]
                                                open pages (default the home page) as one of the
                                                project's test users (its config, its journeys' personas,
                                                the seed password); an error dialog or runtime error fails
                                                it; a refused sign-in is raised to the PM; recorded
  office-app check --name "<what>" --result passed|failed [--detail "..."] [--shot <png>]... [--commit <sha>]
                                                record a check you ran yourself (a measurement, your own
                                                script, screenshots) at your instance's commit, labelled
                                                as reported by you: it shows in the change's Checks
  office-app test [--commit <sha|main|HEAD>] [--no-wait]
                                                the microflow tests (tests/*.test.mdl) at that commit, run
                                                by the office (mxcli's built-in database, no superuser);
                                                the JUnit result is recorded at that commit
  office-app stop                               stop your instance (its processes and database go)`;

const ENV = ['AGENT_OFFICE_HOOK_URL', 'AGENT_OFFICE_WORKER_ID', 'AGENT_OFFICE_HOOK_TOKEN'];
const START_WAIT_MS = 15 * 60_000;
const TEST_WAIT_MS = 25 * 60_000;
const POLL_MS = 5_000;

export class AppUsageError extends Error {}

/** What the command line asks for (the words after `office-app`). */
export function parseApp(argv) {
  const [cmd0, ...rest0] = argv;
  // office-journey run <J>: the same as office-app journey <J>.
  const cmd = cmd0;
  const rest = cmd === 'journey' && rest0[0] === 'run' ? rest0.slice(1) : rest0;
  if (cmd === undefined || cmd === 'help' || cmd === '-h' || cmd === '--help') return { cmd: 'help' };
  const out = { cmd, json: false, wait: true, pages: [] };
  const words = [];
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    const val = () => {
      if (a.includes('=')) return a.slice(a.indexOf('=') + 1);
      if (i + 1 >= rest.length) throw new AppUsageError(`${a} needs a value`);
      return rest[++i];
    };
    const flag = a.includes('=') ? a.slice(0, a.indexOf('=')) : a;
    if (flag === '--json') out.json = true;
    else if (flag === '--no-wait') out.wait = false;
    else if (flag === '--wait') out.wait = true;
    else if (flag === '--commit') out.commit = val();
    else if (flag === '--page' || flag === '--path') out.pages.push(val());
    else if (flag === '--as') out.as = val();
    else if (flag === '--file') out.file = val();
    else if (flag === '--name') out.name = val();
    else if (flag === '--result') out.result = val();
    else if (flag === '--detail') out.detail = val();
    else if (flag === '--shot') (out.shots ??= []).push(val());
    else if (flag === '--const' || flag === '--constant') {
      // --const Module.Name=value: the value may hold '=' itself, so only the flag's own '=' is split off.
      const v = a.startsWith(`${flag}=`) ? a.slice(flag.length + 1) : i + 1 < rest.length ? rest[++i] : '';
      if (!/^[A-Za-z_][A-Za-z0-9_]*\.[A-Za-z_][A-Za-z0-9_]*=/.test(v)) throw new AppUsageError(`${flag} takes Module.Name=value (for example --const Core.SeedDemoData=true)`);
      (out.constants ??= []).push(v);
    }
    else if (a.startsWith('-')) throw new AppUsageError(`Unknown option: ${flag}`);
    else words.push(a);
  }
  if (!['start', 'status', 'stop', 'journey', 'smoke', 'test', 'check'].includes(cmd)) throw new AppUsageError(`Unknown command: ${cmd}`);
  if (out.constants && cmd !== 'start') throw new AppUsageError('--const is for office-app start');
  if (cmd === 'check' && (!out.name || !['passed', 'failed'].includes(out.result))) throw new AppUsageError('check needs --name "<what you checked>" and --result passed|failed');
  if (cmd === 'journey') {
    if (!out.file && words.length !== 1) throw new AppUsageError('journey takes one journey: its id (J-12), its path in the repository, or a file of yours');
    if (words[0]) out.journey = words[0];
  } else if (words.length) throw new AppUsageError(`Unexpected argument: ${words[0]}`);
  return out;
}

function officeEnv(env) {
  const missing = ENV.filter((k) => !env[k]);
  if (missing.length) throw new Error(`${missing.join(', ')} ${missing.length === 1 ? "isn't" : "aren't"} set. office-app only works inside Agent Office, from a worker's terminal.`);
  return { url: env.AGENT_OFFICE_HOOK_URL.replace(/\/+$/, ''), worker: env.AGENT_OFFICE_WORKER_ID, token: env.AGENT_OFFICE_HOOK_TOKEN };
}

/** One call to /office/app<path>; resolves to the answer, or throws with the office's reason. */
export async function appCall(path, body, io, timeout = 60_000) {
  const o = officeEnv(io.env);
  const url = new URL(`${o.url}/office/app${path}`);
  url.searchParams.set('worker', o.worker);
  const init = body === undefined ? { method: 'GET', headers: { authorization: `Bearer ${o.token}` } } : { method: 'POST', headers: { authorization: `Bearer ${o.token}`, 'content-type': 'application/json' }, body: JSON.stringify(body) };
  let res;
  try {
    res = await io.fetch(url.href, { ...init, signal: AbortSignal.timeout(timeout) });
  } catch (err) {
    throw new Error(`Couldn't reach the office at ${url.origin} (${err?.cause?.code ?? err?.code ?? err?.message ?? err}). Is it running?`);
  }
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { error: text.slice(0, 300) };
  }
  if (res.status === 404 && !data.error) throw new Error("The office doesn't know office-app (404): it runs an older Agent Office. Restart or upgrade it.");
  if (res.status < 200 || res.status >= 300) throw new Error(data.error || `The office said no (${res.status}).`);
  return data;
}

/** A revision as the office takes it: main as it is, HEAD (or nothing) as this folder's committed head. */
export function revOf(commit, cwd, git = (args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()) {
  const c = commit ?? 'HEAD';
  if (c === 'main' || c === 'origin/main') return { commit: c };
  try {
    const sha = git(['rev-parse', '--verify', `${c}^{commit}`]);
    const dirty = c === 'HEAD' && git(['status', '--porcelain', '--untracked-files=no']) !== '';
    return { commit: sha, ...(dirty ? { note: `Your worktree has uncommitted changes: the instance runs the committed ${sha.slice(0, 7)} without them. Commit first to test them.` } : {}) };
  } catch {
    return { commit: c };
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Starts (or reuses) the instance and, with `wait`, polls until it's ready or failed. */
async function startApp(commit, wait, io, say = () => {}, constants) {
  let a = await appCall('/start', { commit, ...(constants !== undefined ? { constants } : {}) }, io);
  const until = Date.now() + START_WAIT_MS;
  let last = '';
  while (wait && a.app?.state === 'starting' && Date.now() < until) {
    if (a.line !== last) say((last = a.line));
    await sleep(POLL_MS);
    a = await appCall('', undefined, io);
  }
  return a;
}

/** Starts the microflow tests and, with `wait`, polls until that run's record is in. */
async function runTests(commit, wait, io, say = () => {}) {
  const s = await appCall('/test', { commit }, io);
  say(s.line);
  if (!wait) return { started: s.started, words: s.line, ok: true };
  const until = Date.now() + TEST_WAIT_MS;
  for (;;) {
    await sleep(POLL_MS);
    const t = await appCall('/test', undefined, io);
    if (!t.run?.running && t.run?.commit === s.started) {
      const r = t.record;
      if (!r) return { words: t.run.last ?? 'The run ended without a record', ok: false, state: t };
      const failed = (r.results ?? []).filter((x) => x.status === 'failed');
      const lines = [`Microflow tests @${String(r.commit).slice(0, 7)}: ${t.run.last ?? ''} (record ${r.id})`];
      if (r.harnessError) lines.push(`  did not run: ${r.harnessError}`);
      for (const x of r.results ?? []) if (x.status !== 'passed') lines.push(`  ${x.harness ? 'harness error' : x.status}: ${x.name}${x.detail ? ` — ${x.detail}` : ''}`);
      return { words: lines.join('\n'), ok: !r.harnessError && !failed.length && (r.results ?? []).length > 0, state: t };
    }
    if (Date.now() > until) return { words: `Still running after ${TEST_WAIT_MS / 60_000} min: office-app test --no-wait, then GET status later`, ok: false };
  }
}

/** A check's body: screenshots by full path (the office copies them into its evidence). */
/** The generated test password of the instance (status only): for the agent's own scripts, never a file. */
export function passwordLine(app) {
  const p = app?.testPassword;
  return p ? `Test password for this instance only (${p.constant}): ${p.value}\nUse it for the seeded test users in your own scripts; never write it into a file, a commit, a journal or a message: it changes with every instance.` : '';
}

const withPassword = (line, app) => [line, passwordLine(app)].filter(Boolean).join('\n');

function checkBody(cmd, cwd) {
  const abs = (p) => (/^([a-z]:)?[\\/]/i.test(p) ? p : `${cwd}/${p}`.replace(/\\/g, '/'));
  return { name: cmd.name, result: cmd.result, ...(cmd.detail ? { detail: cmd.detail } : {}), shots: (cmd.shots ?? []).map(abs), ...(cmd.commit ? { commit: cmd.commit } : {}) };
}

function journeyBody(cmd, cwd) {
  const p = cmd.file ?? (cmd.journey && /\.json$/i.test(cmd.journey) && existsSync(`${cwd}/${cmd.journey}`) ? cmd.journey : undefined);
  if (p) return { file: p.replace(/\\/g, '/'), text: readFileSync(p.match(/^([a-z]:)?[\\/]/i) ? p : `${cwd}/${p}`, 'utf8'), ...(cmd.commit ? { commit: cmd.commit } : {}) };
  return { journey: cmd.journey, ...(cmd.commit ? { commit: cmd.commit } : {}) };
}

// --- MCP tools (served by bin/office-workers.js mcp) --------------------------------------------------

const RUNTIME_NOTE = 'Results are recorded against the instance\'s commit and show on the Testing page and in the change\'s Checks; runtime errors in the app\'s log fail a run even when every step passed on screen. The runner signs out after each run (an unlicensed Mendix app keeps only 6 sessions).';

export const APP_TOOLS = [
  {
    name: 'app_start',
    title: 'Start your app instance',
    description: "Starts a running copy of the project's Mendix app at a commit (your candidate's sha, or 'main'), run by the office on its own ports and a fresh database, and waits until it answers (a cold start takes 2-8 minutes). Gives its URL and the test users. One per agent; another commit replaces it; it stops after 15 minutes unused. Use this instead of `mxcli run --local`. Uncommitted changes are not in it: commit first.",
    inputSchema: {
      type: 'object',
      properties: {
        commit: { type: 'string', description: "A commit sha (yours: git rev-parse HEAD) or 'main'." },
        wait: { type: 'boolean', description: 'Wait until it is ready (default true).' },
        constants: { type: 'object', additionalProperties: { type: ['string', 'number', 'boolean'] }, description: 'Constants for this run only, over the project\'s .agent-office/instance-constants.json ({"Core.SeedDemoData": true}); never written to the model. No secrets: a seed password the project names is generated by the office.' },
      },
      required: ['commit'],
      additionalProperties: false,
    },
    annotations: { destructiveHint: false, openWorldHint: false },
  },
  { name: 'app_status', title: 'Your app instance', description: 'Your app instance now: starting (and where), ready (URL, test users, the constants it runs with, when it stops, and the seed password the office generated for it when the project names one: for your own scripts only, never write it down), failed or stopped (why).', inputSchema: { type: 'object', properties: {}, additionalProperties: false }, annotations: { readOnlyHint: true, openWorldHint: false } },
  { name: 'app_stop', title: 'Stop your app instance', description: 'Stops your app instance: its processes end and its database is dropped.', inputSchema: { type: 'object', properties: {}, additionalProperties: false }, annotations: { destructiveHint: false, openWorldHint: false } },
  {
    name: 'journey_run',
    title: 'Run a journey on your app instance',
    description: `Plays a journey on your running app instance: a toolkit tests/**/*.journey.json, or a project's own tests/**/*.journey.js script (run with node against the instance, APP_URL and TEST_USER/TEST_PASS set): the project's own at the instance's commit by id (J-12) or path, or a file of yours (file, a path from your working folder). ${RUNTIME_NOTE}`,
    inputSchema: { type: 'object', properties: { journey: { type: 'string', description: 'The journey id or its path in the repository.' }, file: { type: 'string', description: 'A journey file of yours, instead.' }, commit: { type: 'string', description: 'The commit you expect the instance to run (checked).' } }, additionalProperties: false },
    annotations: { destructiveHint: false, openWorldHint: false },
  },
  {
    name: 'app_smoke',
    title: 'Smoke-test pages on your app instance',
    description: `Signs in as a test user and opens each page address (default the home page) on your running instance; an error dialog or a runtime error fails it. For the pages you changed when no journey covers them. ${RUNTIME_NOTE}`,
    inputSchema: { type: 'object', properties: { paths: { type: 'array', items: { type: 'string' }, description: "Page addresses ('/p/claims'), at most 20." }, as: { type: 'string', description: "A test user (default: the project's own: its config, else its journeys' personas with the seed password)." } }, additionalProperties: false },
    annotations: { destructiveHint: false, openWorldHint: false },
  },
  {
    name: 'app_check',
    title: 'Record a check you ran yourself',
    description: "Records a check you ran yourself on your app instance (a measurement, your own browser script, screenshots) against its commit, labelled as reported by you, so the change's receipt and the merge dialog show it with pass or fail. Prefer journey_run / app_smoke when they can do the check: those the office runs and watches.",
    inputSchema: { type: 'object', properties: { name: { type: 'string', description: "What you checked ('P3 header at 390 px as the requestor')." }, result: { type: 'string', enum: ['passed', 'failed'] }, detail: { type: 'string', description: 'What you saw, in a line or two.' }, shots: { type: 'array', items: { type: 'string' }, description: 'Screenshot files (.png/.jpg/.webp, full paths), at most 5.' }, commit: { type: 'string', description: "The commit (default: your instance's)." } }, required: ['name', 'result'], additionalProperties: false },
    annotations: { destructiveHint: false, openWorldHint: false },
  },
  {
    name: 'app_test',
    title: 'Run the microflow tests at a commit',
    description: "Runs the project's microflow tests (tests/*.test.mdl) at a commit, by the office in its own work folder with its test database (no superuser for anyone), and waits for the result; the JUnit result is recorded at that commit. When they can't run it says exactly why. Use this instead of `mxcli test --local` in your worktree.",
    inputSchema: { type: 'object', properties: { commit: { type: 'string', description: "A commit sha or 'main'." }, wait: { type: 'boolean', description: 'Wait for the result (default true).' } }, required: ['commit'], additionalProperties: false },
    annotations: { destructiveHint: false, openWorldHint: false },
  },
];

export const APP_TOOL_NAMES = APP_TOOLS.map((t) => t.name);

/** Runs one of APP_TOOLS: its text and whether it failed. */
export async function runAppTool(name, args, io) {
  const a = args && typeof args === 'object' ? args : {};
  const cwd = io.cwd ?? process.cwd();
  if (name === 'app_status') {
    const r = await appCall('', undefined, io);
    return { text: withPassword(r.line, r.app) };
  }
  if (name === 'app_stop') return { text: (await appCall('/stop', {}, io)).line };
  if (name === 'app_start') {
    const r = await startApp(revOf(a.commit, cwd).commit, a.wait !== false, io, undefined, a.constants);
    return { text: `${withPassword(r.line, r.app)}\n${JSON.stringify(r.app ?? {}, null, 1)}`, isError: r.app?.state === 'failed' };
  }
  if (name === 'journey_run') {
    const r = await appCall('/journey', journeyBody({ journey: a.journey, file: a.file, commit: a.commit }, cwd), io, 20 * 60_000);
    return { text: r.words, isError: r.outcome?.status !== 'passed' };
  }
  if (name === 'app_smoke') {
    const r = await appCall('/smoke', { paths: a.paths ?? [], ...(a.as ? { as: a.as } : {}) }, io, 10 * 60_000);
    return { text: r.words, isError: r.outcome?.status !== 'passed' };
  }
  if (name === 'app_check') {
    const r = await appCall('/check', checkBody({ name: a.name, result: a.result, detail: a.detail, shots: a.shots, commit: a.commit }, cwd), io);
    return { text: r.line };
  }
  if (name === 'app_test') {
    const r = await runTests(revOf(a.commit, cwd).commit, a.wait !== false, io);
    return { text: r.words, isError: !r.ok };
  }
  throw new Error(`Unknown tool: ${name}`);
}

/** Runs the command; resolves to its exit code. */
export async function appMain(argv, io = {}) {
  const env = io.env ?? process.env;
  const out = io.out ?? ((s) => process.stdout.write(`${s}\n`));
  const err = io.err ?? ((s) => process.stderr.write(`${s}\n`));
  const ctx = { env, fetch: io.fetch ?? fetch, cwd: io.cwd ?? process.cwd() };
  try {
    const cmd = parseApp(argv);
    if (cmd.cmd === 'help') {
      out(`Usage:\n${APP_USAGE}`);
      return 0;
    }
    officeEnv(env);
    if (cmd.cmd === 'status' || cmd.cmd === 'stop') {
      const r = cmd.cmd === 'status' ? await appCall('', undefined, ctx) : await appCall('/stop', {}, ctx);
      out(cmd.json ? JSON.stringify(r, null, 2) : cmd.cmd === 'status' ? withPassword(r.line, r.app) : r.line);
      return 0;
    }
    if (cmd.cmd === 'start') {
      const rev = revOf(cmd.commit, ctx.cwd);
      if (rev.note) err(rev.note);
      const r = await startApp(rev.commit, cmd.wait, ctx, cmd.json ? undefined : err, cmd.constants);
      out(cmd.json ? JSON.stringify(r, null, 2) : r.line);
      return r.app?.state === 'failed' ? 1 : 0;
    }
    if (cmd.cmd === 'test') {
      const rev = revOf(cmd.commit, ctx.cwd);
      if (rev.note) err(rev.note);
      const r = await runTests(rev.commit, cmd.wait, ctx, cmd.json ? undefined : err);
      out(cmd.json ? JSON.stringify(r.state ?? r, null, 2) : r.words);
      return r.ok ? 0 : 1;
    }
    if (cmd.cmd === 'check') {
      const r = await appCall('/check', checkBody(cmd, ctx.cwd), ctx);
      out(cmd.json ? JSON.stringify(r, null, 2) : r.line);
      return 0;
    }
    const r = cmd.cmd === 'journey' ? await appCall('/journey', journeyBody(cmd, ctx.cwd), ctx, 20 * 60_000) : await appCall('/smoke', { paths: cmd.pages, ...(cmd.as ? { as: cmd.as } : {}) }, ctx, 10 * 60_000);
    out(cmd.json ? JSON.stringify(r.outcome, null, 2) : r.words);
    return r.outcome?.status === 'passed' ? 0 : 1;
  } catch (e) {
    err(`office-app: ${e.message}`);
    if (e instanceof AppUsageError) err(`\nUsage:\n${APP_USAGE}`);
    return e instanceof AppUsageError ? 2 : 1;
  }
}

const invoked = (() => {
  try {
    return !!process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
})();
if (invoked) process.exitCode = await appMain(process.argv.slice(2));
