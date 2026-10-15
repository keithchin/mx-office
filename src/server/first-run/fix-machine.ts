// First-run setup's fixes on the real machine (FixDeps for fixes.ts): programs started off the event
// loop, a terminal window of its own for a sign-in, PATH read again from Windows after an install,
// mxcli downloaded into the office's tools folder, gh's token straight into 🔌 Connections. A test
// office never gets these: its deps refuse to run anything (winget, npm, gh auth, claude, a download),
// or, with AGENT_OFFICE_FAKE_SETUP=1, are the scripted fakes in fix-fake.ts, so its page can be shown
// and photographed without touching the machine. Tests hand in their own deps (useFixDeps).

import { spawn } from 'node:child_process';
import { chmod, mkdir, rename, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DEFAULT_TOOLKIT_REPO } from '../../shared/first-run.js';
import type { Ctx } from '../office/context.js';
import { audit, human } from '../audit/index.js';
import { tildify } from '../building.js';
import { saveCredential } from '../connections/index.js';
import { setPath } from '../connections/paths.js';
import { credential } from '../connections/resolve.js';
import { officeSettings, updateOfficeSettings } from '../connections/store.js';
import { spawnOff } from '../offloop/exec.js';
import { testModeOf } from '../testmode.js';
import { checkOne, findOnPath, prereqIdsFor, runOff } from './checks.js';
import { cloneToolkit } from './clone.js';
import type { FixChild, FixDeps } from './fixes.js';
import { fakeFixDeps } from './fix-fake.js';
import { defaultCloneDir, prereqDeps, runPrereqs, setMxcli, type Who } from './index.js';
import { MACHINE_ENV_KEY, USER_ENV_KEY, expandVars, mergePath, parseRegPath } from './path-refresh.js';

let injected: ((ctx: Ctx, who: Who) => FixDeps) | undefined;

/** Tests: the deps every fix route uses from now on (undefined: the machine's again). */
export const useFixDeps = (fn: ((ctx: Ctx, who: Who) => FixDeps) | undefined) => void (injected = fn);

const quote = (a: string) => (/[\s"&|<>^]/.test(a) ? `"${a.replace(/"/g, '""')}"` : a);
const pathKey = (env: NodeJS.ProcessEnv) => Object.keys(env).find((k) => k.toUpperCase() === 'PATH') ?? 'PATH';

/** Starts `file` off the event loop; a .cmd (npm) through cmd.exe. */
function start(file: string, args: string[], env?: NodeJS.ProcessEnv): FixChild {
  const shim = /\.(cmd|bat)$/i.test(file);
  return shim ? spawnOff(quote(file), args.map(quote), { env, shell: true, stdin: true }) : spawnOff(file, args, { env, stdin: true });
}

/** A terminal window of its own, running `cmd args` (found on `env`'s PATH), left to the person. */
function openTerminal(cmd: string, args: string[], env: NodeJS.ProcessEnv): Promise<string | undefined> {
  return new Promise((resolve) => {
    let file: string;
    let argv: string[];
    if (process.platform === 'win32') [file, argv] = [process.env.ComSpec || 'cmd.exe', ['/d', '/c', 'start', 'Mx Office setup', 'cmd', '/k', cmd, ...args]];
    else if (process.platform === 'darwin') [file, argv] = ['osascript', ['-e', `tell application "Terminal" to do script "${[cmd, ...args].join(' ')}"`, '-e', 'tell application "Terminal" to activate']];
    else return resolve('There’s no terminal window to open here');
    try {
      const child = spawn(file, argv, { env, detached: true, stdio: 'ignore', windowsHide: false });
      child.once('error', (e) => resolve(`Couldn’t open a terminal window: ${e.message}`));
      child.once('spawn', () => (child.unref(), resolve(undefined)));
    } catch (err) {
      resolve(`Couldn’t open a terminal window: ${(err as Error).message}`);
    }
  });
}

/** PATH read again: the machine's and the user's from the registry (Windows), Claude Code's ~/.local/bin anywhere. */
async function refreshPath(): Promise<string[] | undefined> {
  const env = process.env;
  const key = pathKey(env);
  const fresh: string[] = [];
  if (process.platform === 'win32') {
    const reg = await findOnPath('reg');
    if (!reg) return undefined;
    const [m, u] = await Promise.all([runOff(reg, ['query', MACHINE_ENV_KEY, '/v', 'Path']), runOff(reg, ['query', USER_ENV_KEY, '/v', 'Path'])]);
    const machine = parseRegPath(m.out);
    if (!machine) return undefined;
    fresh.push(expandVars(machine, env), expandVars(parseRegPath(u.out) ?? '', env));
  }
  const local = path.join(os.homedir(), '.local', 'bin');
  if (existsSync(local)) fresh.push(local);
  const sep = process.platform === 'win32' ? ';' : ':';
  const merged = mergePath((env[key] ?? '').split(sep).join(';'), fresh);
  env[key] = merged.value.split(';').join(sep);
  return merged.added;
}

async function download(url: string, dest: string, line: (t: string) => void): Promise<string | undefined> {
  try {
    const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(5 * 60_000) });
    if (!res.ok) return `The download answered ${res.status} (${url})`;
    const bytes = new Uint8Array(await res.arrayBuffer());
    await mkdir(path.dirname(dest), { recursive: true });
    const part = `${dest}.part`;
    await writeFile(part, bytes);
    if (process.platform !== 'win32') await chmod(part, 0o755);
    await rename(part, dest);
    line(`Downloaded ${(bytes.length / 1048576).toFixed(1)} MB to ${tildify(dest)}`);
    return undefined;
  } catch (err) {
    return `Couldn’t download it: ${(err as Error).message}`;
  }
}

function record(who: Who, id: string, label: string, summary: string, details?: Record<string, unknown>) {
  audit.record({ actor: human(who.name, who.id), action: 'settings.change', target: { kind: 'setting', id, label }, summary, details, severity: 'notice' });
}

/** The real machine's deps. */
export function machineFixDeps(ctx: Ctx, who: Who): FixDeps {
  const toolkit = () => ({ url: officeSettings().toolkitRepo ?? DEFAULT_TOOLKIT_REPO, dir: defaultCloneDir() });
  return {
    platform: process.platform,
    arch: process.arch,
    get env() {
      return process.env;
    },
    find: (cmd) => findOnPath(cmd),
    spawn: start,
    run: (file, args, env) => runOff(file, args, env),
    openTerminal,
    refreshPath,
    download,
    check: (id) => checkOne(prereqDeps(ctx), id),
    async saveAgentToken(token) {
      const why = await saveCredential(ctx, 'github-agents', token, who);
      if (!why) record(who, 'credential:github-agents', 'GitHub token for agents', `${who.name} saved the agents’ GitHub token from gh’s sign-in (token saved from gh sign-in)`, { credential: 'github-agents', source: 'gh auth token' });
      return why;
    },
    hasAgentToken: () => !!credential('github-agents'),
    mxcliDest: () => path.join(ctx.cfg.dir, 'tools', 'mxcli', process.platform === 'win32' ? 'mxcli.exe' : 'mxcli'),
    setMxcli: (file) => setMxcli(file, who),
    toolkit,
    async cloneToolkit(line) {
      const { url, dir } = toolkit();
      let error: string | undefined;
      const done = await cloneToolkit(url, dir, (e) => (e.t === 'line' ? line(e.text) : e.t === 'done' && !e.ok ? (error = e.error) : undefined));
      if (!done) return error ?? 'The clone didn’t finish';
      updateOfficeSettings({ toolkitRepo: url });
      record(who, 'toolkitRepo', 'Toolkit clone', `${who.name} cloned the toolkit from ${url} into ${tildify(done)}`, { after: { url, dir: tildify(done) } });
      return setPath(ctx, 'toolkitDir', done, who);
    },
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    waitMs: 15 * 60_000,
  };
}

/** What a test office says instead of running anything real. */
export const TEST_MODE_REFUSAL = 'This is a test office: setup never runs winget, npm, gh auth or claude here, and downloads nothing (AGENT_OFFICE_FAKE_SETUP=1 runs scripted fakes instead).';

/** A test office's deps: everything that would touch the machine throws, and `refuse` stops a run before it starts. */
export function refusingDeps(d: FixDeps, why = TEST_MODE_REFUSAL): FixDeps {
  const no = () => {
    throw new Error(why);
  };
  return { ...d, refuse: why, spawn: no, run: no, openTerminal: no, refreshPath: no, download: no, saveAgentToken: no, cloneToolkit: no, setMxcli: no };
}

const on = (v: string | undefined) => !!v && v !== '0';

/** A test office running the scripted fakes (AGENT_OFFICE_FAKE_SETUP=1, only in test mode). */
const fakeSetup = () => testModeOf().on && on(process.env.AGENT_OFFICE_FAKE_SETUP);

/** The prerequisite rows the page shows: this machine's, or the scripted office's fresh laptop. */
export async function checkRows(ctx: Ctx) {
  if (!fakeSetup()) return runPrereqs(ctx);
  const d = fakeFixDeps();
  return Promise.all(prereqIdsFor('win32').map((id) => d.check(id)));
}

/** The deps the fix routes use: the tests', a test office's (refusing, or fakes), or the machine's. */
export function fixDepsFor(ctx: Ctx, who: Who): FixDeps {
  if (injected) return injected(ctx, who);
  if (testModeOf().on) return fakeSetup() ? fakeFixDeps() : refusingDeps(machineFixDeps(ctx, who));
  return machineFixDeps(ctx, who);
}
