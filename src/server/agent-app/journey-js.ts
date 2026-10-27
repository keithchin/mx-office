// A project's own Playwright-style journey script (tests/**/<id>.journey.js) played on an agent's app instance
// (the real rebuild test: the projects write `.journey.js`, office-app only played `.journey.json`, so the
// agents checked with their own scripts and nothing was recorded). The script is the project's code, run the
// way its agents already run it (`node tests/e2e/J-01.journey.js`), with the office's limits around it:
//   * it runs in the instance's own workspace (the office's copy of the commit's files under its data folder,
//     never the project's folder or an agent's worktree), so what it writes (screens, artifacts) stays there;
//     a file the agent sends (maybe uncommitted) is put beside the committed ones for that run only, then removed;
//   * its environment is an allowlist: what a browser and node need (PATH, the temp and profile folders,
//     PW_CORE / CHROME_EXE / PLAYWRIGHT_BROWSERS_PATH / MXCLI when the office has them) plus the instance's
//     address (APP_URL, BASE_URL) and the account the office resolved (TEST_USER / TEST_PASS, SEED_PASSWORD):
//     no token, key or office setting of any kind;
//   * a time limit (10 min), its whole process tree ended at the limit or when the instance stops, and its
//     output capped.
// The verdict: the findings file the script writes for this run (`artifacts/<id>.findings.json`, its
// `verdict_` / `verdict` and steps) when there is one, else the exit code (0 passed, anything else failed).
// An INVALID verdict, a timeout or a sign-in the app refused is a run that couldn't complete, never a pass.

import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { killTreeAsync } from '../liveapp/process.js';

export const JS_JOURNEY_TIMEOUT_MS = 10 * 60_000;
const OUTPUT_MAX = 256 * 1024;

/** The environment variables a journey script may see from the office's own (nothing secret is ever among them). */
const PASS_THROUGH = ['PATH', 'Path', 'PATHEXT', 'SystemRoot', 'windir', 'COMSPEC', 'TEMP', 'TMP', 'TMPDIR', 'HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'ProgramFiles', 'ProgramFiles(x86)', 'ProgramData', 'LANG', 'PW_CORE', 'CHROME_EXE', 'PLAYWRIGHT_BROWSERS_PATH', 'MXCLI'];

/** A journey script's id: `J-16` from tests/e2e/J-16.journey.js, else the id it gives its recorder. */
export function jsJourneyId(file: string, text = ''): string {
  const fromRecorder = /makeRecorder\(\s*["'`]([\w.-]{1,40})["'`]/.exec(text)?.[1] ?? /\bjourney(?:Id)?\s*[:=]\s*["'`]([\w.-]{1,40})["'`]/.exec(text)?.[1];
  const base = path.basename(file).replace(/\.journey\.(c?js)$/i, '');
  return /^[A-Z]{1,6}-\d+[a-z]?$/i.test(base) ? base : (fromRecorder ?? base);
}

export interface JsStep {
  n: number;
  caption: string;
  status: string;
  why?: string;
}

export interface JsOutcome {
  status: 'passed' | 'failed' | 'error';
  steps: JsStep[];
  failure?: string;
  /** The app refused the account (said by the script's output). */
  signIn?: boolean;
  exitCode: number | null;
  ms: number;
}

/** The verdict and steps of a findings file (the recorder shape the projects use), or undefined when it gives none. */
export function readFindings(j: unknown): { status: JsOutcome['status']; steps: JsStep[]; failure?: string } | undefined {
  if (!j || typeof j !== 'object') return undefined;
  const o = j as { verdict_?: unknown; verdict?: unknown; steps?: unknown };
  const v = String(o.verdict_ ?? o.verdict ?? '').toUpperCase();
  const raw = Array.isArray(o.steps) ? (o.steps as { name?: unknown; status?: unknown; error?: unknown; checks?: { label?: unknown; ok?: unknown }[] }[]) : [];
  const steps: JsStep[] = raw.slice(0, 60).map((s, i) => {
    const st = String(s.status ?? '').toUpperCase();
    const bad = (s.checks ?? []).find((c) => c && c.ok === false);
    const why = typeof s.error === 'string' ? s.error : bad && typeof bad.label === 'string' ? `check failed: ${bad.label}` : undefined;
    return { n: i + 1, caption: String(s.name ?? `step ${i + 1}`).slice(0, 200), status: st.startsWith('PASS') ? 'passed' : st === 'NOT RUN' ? 'not-run' : st === 'BLOCKED' ? 'skipped' : st === 'INVALID' ? 'error' : 'failed', ...(why ? { why: why.slice(0, 300) } : {}) };
  });
  if (!v) return undefined;
  const status: JsOutcome['status'] = v.startsWith('PASS') ? 'passed' : v.startsWith('INVALID') ? 'error' : 'failed';
  const first = steps.find((s) => s.status !== 'passed' && s.status !== 'skipped');
  return { status, steps, ...(status !== 'passed' ? { failure: first ? `step ${first.n} (${first.caption}): ${first.why ?? first.status}` : `the journey's verdict: ${v}` } : {}) };
}

const SIGN_IN_REFUSED = /(username or password (you entered )?is incorrect|couldn['’]?t sign in|login failed|still on the sign-in page|invalid (user ?name|credentials))/i;

export interface JsRunSpec {
  /** The instance's workspace (the commit's files). */
  workspace: string;
  /** The journey's path in the repository (forward slashes). */
  file: string;
  /** The text of a file the agent sent, for this run only. */
  text?: string;
  url: string;
  login: { user: string; password: string };
  signal?: AbortSignal;
  timeoutMs?: number;
  node?: string;
  env?: NodeJS.ProcessEnv;
  now?: () => number;
}

/** Plays one journey script on the instance (see the header); never rejects. */
export async function runJsJourney(s: JsRunSpec): Promise<JsOutcome> {
  const now = s.now ?? Date.now;
  const t0 = now();
  const rel = s.file.replace(/\\/g, '/').replace(/^\.\//, '');
  if (rel.split('/').includes('..') || path.isAbsolute(rel)) return { status: 'error', steps: [], failure: `not a path inside the project: ${s.file}`, exitCode: null, ms: 0 };
  const committed = path.join(s.workspace, ...rel.split('/'));
  // A sent file goes beside the committed ones (so its own requires resolve), under a name of its own.
  const script = s.text !== undefined ? path.join(path.dirname(committed), `.office-sent-${randomBytes(4).toString('hex')}.journey.js`) : committed;
  const id = jsJourneyId(rel, s.text ?? (await readFile(committed, 'utf8').catch(() => '')));
  if (s.text !== undefined) {
    await mkdir(path.dirname(script), { recursive: true });
    await writeFile(script, s.text);
  } else if (!(await stat(script).then((x) => x.isFile(), () => false))) return { status: 'error', steps: [], failure: `${rel} isn't in the instance's files (commit it first, or send it with --file)`, exitCode: null, ms: 0 };
  const findings = path.join(path.dirname(committed), 'artifacts', `${id}.findings.json`);
  const base = s.env ?? process.env;
  const env: Record<string, string> = {};
  for (const k of PASS_THROUGH) if (base[k]) env[k] = base[k]!;
  Object.assign(env, { APP_URL: s.url.replace(/\/+$/, ''), BASE_URL: s.url.replace(/\/+$/, ''), TEST_USER: s.login.user, TEST_PASS: s.login.password, SEED_PASSWORD: s.login.password, CI: '1', NO_COLOR: '1' });
  try {
    const out = await new Promise<{ code: number | null; text: string; killed?: string }>((resolve) => {
      let text = '';
      let killed: string | undefined;
      const ch = spawn(s.node ?? process.execPath, [script], { cwd: s.workspace, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, detached: process.platform !== 'win32' });
      const take = (b: Buffer) => {
        if (text.length < OUTPUT_MAX) text += b.toString('utf8');
      };
      ch.stdout?.on('data', take);
      ch.stderr?.on('data', take);
      const end = (why: string) => {
        killed ??= why;
        if (ch.pid) void killTreeAsync(ch.pid);
      };
      const timer = setTimeout(() => end(`timed out after ${Math.round((s.timeoutMs ?? JS_JOURNEY_TIMEOUT_MS) / 60_000)} min`), s.timeoutMs ?? JS_JOURNEY_TIMEOUT_MS);
      const onAbort = () => end('the instance stopped');
      s.signal?.addEventListener('abort', onAbort, { once: true });
      ch.once('error', (err) => {
        clearTimeout(timer);
        resolve({ code: null, text: `${text}\n${err.message}`, killed: `node didn't start: ${err.message}` });
      });
      ch.once('close', (code) => {
        clearTimeout(timer);
        s.signal?.removeEventListener('abort', onAbort);
        resolve({ code, text, ...(killed ? { killed } : {}) });
      });
    });
    const ms = now() - t0;
    const tail = out.text.replace(/\r/g, '').split('\n').map((l) => l.trim()).filter(Boolean).slice(-4).join(' | ').slice(0, 500);
    const signIn = SIGN_IN_REFUSED.test(out.text);
    if (out.killed) return { status: 'error', steps: [], failure: `the journey ${out.killed} (last: ${tail || 'nothing'})`, exitCode: out.code, ms, ...(signIn ? { signIn } : {}) };
    // Only a findings file this run wrote counts.
    const fresh = await stat(findings).then((x) => x.mtimeMs >= t0 - 2_000, () => false);
    const read = fresh ? readFindings(await readFile(findings, 'utf8').then((t) => JSON.parse(t) as unknown, () => undefined)) : undefined;
    if (read) return { ...read, exitCode: out.code, ms, ...(signIn && read.status !== 'passed' ? { signIn, status: 'error' as const } : {}) };
    if (out.code === 0) return { status: 'passed', steps: [], exitCode: 0, ms };
    return { status: signIn ? 'error' : 'failed', steps: [], failure: `exit ${out.code ?? 'none'}: ${tail || 'no output'}`, exitCode: out.code, ms, ...(signIn ? { signIn } : {}) };
  } finally {
    if (s.text !== undefined) await rm(script, { force: true }).catch(() => undefined);
  }
}
