// First-run setup's prerequisite check (shared/first-run.ts says what each row is for): Node, Git and
// Git Bash, gh and its sign-in, Claude Code and its sign-in, Studio Pro, mxcli, jq, the toolkit and the
// Live app's PostgreSQL. It runs when the page asks (Re-check), never on a timer, and every program it
// starts is started off the event loop (offloop/exec.ts). Claude Code is only ever asked its version:
// whether it's signed in is read from where it keeps its sign-in (the file's there or not, never read)
// and the environment, so no session starts and no API call is made. Everything it touches comes in
// through CheckDeps, so the tests run it against fakes.

import { access, constants } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { PREREQ_IDS, PREREQ_META, nodeVersionOk, type PrereqId, type PrereqResult } from '../../shared/first-run.js';
import { execFileOffP, type OffError } from '../offloop/exec.js';
import { redactor } from '../wizard/admin-token.js';

export interface Ran {
  code: number;
  out: string;
}

export interface CheckDeps {
  platform: NodeJS.Platform;
  env: NodeJS.ProcessEnv;
  home: string;
  nodeVersion: string;
  /** A program on PATH (with PATHEXT on Windows), or undefined. */
  find(cmd: string): Promise<string | undefined>;
  /** Runs a program found by `find` (or a full path) and gives back its exit code and output. */
  run(file: string, args: string[]): Promise<Ran>;
  exists(p: string): Promise<boolean>;
  /** Where Studio Pro versions are installed and which are (the wizard's own detection). */
  mendix(): { dir: string; versions: string[] };
  /** The mxcli the office is set to use, if any (first-run's pick, AGENT_OFFICE_MXCLI, where it usually is). */
  mxcli(): string | undefined;
  /** Git Bash, as the wizard runs it. */
  bash(): string;
  /** The folder jq is in, when the wizard found one. */
  jqDir(): string | undefined;
  toolkit(): { dir: string; problem?: string };
  /** The Live app's PostgreSQL. */
  db(): { host: string; port: number };
  reach(host: string, port: number, ms: number): Promise<boolean>;
  /** Values to keep out of anything shown (the tokens the office holds). */
  secrets(): (string | undefined)[];
}

const firstLine = (s: string) => s.split(/\r?\n/).find((l) => l.trim())?.trim() ?? '';

/** Whether a file is there (and, off Windows, can be run). */
export const exists = (p: string): Promise<boolean> => access(p, constants.F_OK).then(() => true, () => false);

/** `cmd` on PATH, looked up with fs/promises (on the libuv pool, never blocking the event loop). */
export async function findOnPath(cmd: string, env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): Promise<string | undefined> {
  const win = platform === 'win32';
  const pathKey = Object.keys(env).find((k) => k.toUpperCase() === 'PATH') ?? 'PATH';
  const dirs = (env[pathKey] ?? '').split(win ? ';' : ':').filter(Boolean);
  const exts = win && !path.extname(cmd) ? (env.PATHEXT || '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean) : [''];
  for (const d of dirs) {
    for (const ext of exts) {
      const p = path.join(d.replace(/^"|"$/g, ''), cmd + ext.toLowerCase());
      if (await access(p, win ? constants.F_OK : constants.X_OK).then(() => true, () => false)) return p;
    }
  }
  return undefined;
}

/** Runs `file` off the event loop: a .cmd or .bat (an npm shim) through cmd.exe, everything else as it is. */
export async function runOff(file: string, args: string[], env?: NodeJS.ProcessEnv): Promise<Ran> {
  const shim = /\.(cmd|bat)$/i.test(file);
  const quote = (a: string) => (/[\s"&|<>^]/.test(a) ? `"${a.replace(/"/g, '""')}"` : a);
  const [cmd, argv, verbatim] = shim ? [process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `"${[quote(file), ...args.map(quote)].join(' ')}"`], true] : [file, args, false];
  try {
    const r = await execFileOffP(cmd, argv, { env, timeout: 15_000, windowsHide: true, windowsVerbatimArguments: verbatim, maxBuffer: 1024 * 1024 });
    return { code: 0, out: `${r.stdout}${r.stderr}`.trim() };
  } catch (err) {
    const e = err as OffError;
    if (e.code === 'ENOENT') return { code: 127, out: '' };
    return { code: typeof e.code === 'number' ? e.code : 1, out: `${e.stdout ?? ''}${e.stderr ?? ''}`.trim() || e.message };
  }
}

/** Whether something answers on host:port within `ms` (a plain TCP connect, no login). */
export function reachable(host: string, port: number, ms: number): Promise<boolean> {
  return new Promise((resolve) => {
    const s = net.connect({ host, port });
    const done = (ok: boolean) => {
      s.destroy();
      resolve(ok);
    };
    s.setTimeout(ms, () => done(false));
    s.once('connect', () => done(true));
    s.once('error', () => done(false));
  });
}

/** The environment variables that sign Claude Code in without its own login. */
const CLAUDE_ENV = ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN', 'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX', 'CLAUDE_CODE_USE_FOUNDRY'];

type Check = (d: CheckDeps) => Promise<Omit<PrereqResult, 'id'>>;

/** A program's version row: found on PATH and answering `args`. */
const versionOf = (cmd: string, args: string[], missing: string, fix: string): Check => async (d) => {
  const p = await d.find(cmd);
  if (!p) return { status: 'missing', text: missing, fix };
  const r = await d.run(p, args);
  return r.code === 0 ? { status: 'ok', text: firstLine(r.out) || `${cmd} is installed`, path: p } : { status: 'missing', text: `${cmd} is there but didn’t answer (${firstLine(r.out) || `exit ${r.code}`})`, fix, path: p };
};

const CHECKS: Record<PrereqId, Check> = {
  async node(d) {
    const v = d.nodeVersion.replace(/^v/, '');
    return nodeVersionOk(v) ? { status: 'ok', text: `Node.js ${v}` } : { status: 'missing', text: `Node.js ${v} is too old`, fix: 'Install Node.js 22.5 or newer (winget install OpenJS.NodeJS.LTS), then start the office again.' };
  },
  git: versionOf('git', ['--version'], 'git isn’t installed (or not on the office’s PATH)', 'winget install Git.Git, then restart the office.'),
  async gitbash(d) {
    const bash = d.bash();
    if (await d.exists(bash)) return { status: 'ok', text: `Git Bash at ${bash}`, path: bash };
    return { status: 'missing', text: `Git Bash isn’t at ${bash}`, fix: 'It comes with Git for Windows (winget install Git.Git); set AGENT_OFFICE_BASH if it’s somewhere else.' };
  },
  gh: versionOf('gh', ['--version'], 'gh (the GitHub CLI) isn’t installed (or not on the office’s PATH)', 'winget install GitHub.cli, then restart the office.'),
  async 'gh-auth'(d) {
    const gh = await d.find('gh');
    if (!gh) return { status: 'missing', text: 'Needs gh first' };
    const r = await d.run(gh, ['auth', 'status', '--hostname', 'github.com']);
    const hide = redactor(d.secrets());
    const said = hide(r.out).split(/\r?\n/).map((l) => l.trim().replace(/^[✓✗X!-]\s*/, '')).filter(Boolean);
    const who = said.find((l) => /Logged in to/i.test(l));
    if (r.code === 0) return { status: 'ok', text: who ?? 'gh is signed in to github.com' };
    return { status: 'missing', text: said.find((l) => /not logged|fail|invalid|error/i.test(l)) ?? 'gh isn’t signed in to github.com', fix: 'Run gh auth login in a terminal, or save the agents’ GitHub token in the next step (gh uses it).' };
  },
  claude: versionOf('claude', ['--version'], 'Claude Code (claude) isn’t installed (or not on the office’s PATH)', 'Install it (see the link), open a new terminal so it’s on PATH, then restart the office.'),
  async 'claude-auth'(d) {
    const byEnv = CLAUDE_ENV.find((k) => d.env[k]);
    if (byEnv) return { status: 'ok', text: `Signed in through ${byEnv}` };
    const dir = d.env.CLAUDE_CONFIG_DIR ? path.resolve(d.env.CLAUDE_CONFIG_DIR) : path.join(d.home, '.claude');
    if (await d.exists(path.join(dir, '.credentials.json'))) return { status: 'ok', text: 'Signed in (Claude Code’s sign-in is on this machine)' };
    // macOS keeps it in the keychain, which isn't looked at: say so rather than call it missing.
    if (d.platform === 'darwin') return { status: 'warn', text: 'Couldn’t tell (macOS keeps the sign-in in the keychain)', fix: 'Run claude once in a terminal and sign in with /login if it asks.' };
    return { status: 'missing', text: 'No Claude Code sign-in found for this Windows user', fix: 'Run claude once in a terminal and sign in (/login), then Re-check.' };
  },
  async studio(d) {
    const m = d.mendix();
    if (m.versions.length) return { status: 'ok', text: `${m.versions.length === 1 ? 'Studio Pro' : `${m.versions.length} versions`}: ${m.versions.slice(0, 4).join(', ')}${m.versions.length > 4 ? '…' : ''}`, path: m.dir };
    return { status: 'missing', text: `No Studio Pro under ${m.dir}`, fix: 'Install Studio Pro (11.12 or the version your projects use); set AGENT_OFFICE_MENDIX_DIR if it isn’t in the usual folder.' };
  },
  async mxcli(d) {
    const p = d.mxcli() ?? (await d.find('mxcli'));
    if (!p || !(await d.exists(p))) return { status: 'missing', text: p ? `mxcli isn’t at ${p}` : 'No mxcli found', fix: 'Download mxcli (see the link) and give its path here.', path: p };
    const r = await d.run(p, ['--version']);
    return { status: 'ok', text: r.code === 0 && firstLine(r.out) ? `${firstLine(r.out)} (${p})` : `mxcli at ${p}`, path: p };
  },
  async jq(d) {
    const dir = d.jqDir();
    const p = (dir && (await d.exists(path.join(dir, 'jq.exe'))) ? path.join(dir, 'jq.exe') : undefined) ?? (await d.find('jq'));
    if (p) return { status: 'ok', text: `jq at ${p}`, path: p };
    return { status: 'missing', text: 'No jq found', fix: 'winget install jqlang.jq, then restart the office (or set AGENT_OFFICE_JQ_DIR).' };
  },
  async toolkit(d) {
    const t = d.toolkit();
    return t.problem ? { status: 'missing', text: t.problem, fix: 'Pick its folder or clone it in the Toolkit step.', path: t.dir } : { status: 'ok', text: `At ${t.dir}`, path: t.dir };
  },
  async postgres(d) {
    const { host, port } = d.db();
    if (await d.reach(host, port, 1500)) return { status: 'ok', text: `Something answers on ${host}:${port}` };
    return { status: 'missing', text: `Nothing answers on ${host}:${port}`, fix: 'Optional: install PostgreSQL for the Live app (user postgres), or point AGENT_OFFICE_LIVE_DB_HOST at one.' };
  },
};

/** The rows to show on this platform, in order. */
export const prereqIdsFor = (platform: NodeJS.Platform): PrereqId[] => PREREQ_IDS.filter((id) => platform === 'win32' || !PREREQ_META[id].windowsOnly);

/** Every check at once; one that throws is a missing row with what it said, never a failed page. */
export async function checkPrereqs(d: CheckDeps): Promise<PrereqResult[]> {
  return Promise.all(
    prereqIdsFor(d.platform).map(async (id) => {
      try {
        return { id, ...(await CHECKS[id](d)) };
      } catch (err) {
        return { id, status: 'missing' as const, text: `The check failed: ${(err as Error).message}` };
      }
    }),
  );
}

/** The real machine's deps, from the office's own settings and the wizard's detection. */
export function machineDeps(o: Omit<CheckDeps, 'platform' | 'env' | 'home' | 'nodeVersion' | 'find' | 'run' | 'exists' | 'reach'>): CheckDeps {
  return { platform: process.platform, env: process.env, home: os.homedir(), nodeVersion: process.versions.node, find: (c) => findOnPath(c), run: (f, a) => runOff(f, a), exists, reach: reachable, ...o };
}
