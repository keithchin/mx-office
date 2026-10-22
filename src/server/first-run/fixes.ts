// First-run setup's one-click fixes (shared/first-run-fix.ts says what each is): a missing row's Fix,
// and Set up everything, which runs every fix the check asks for in order and stops at the first that
// fails, saying why. Planning runs nothing: it says which commands would run and where each program
// comes from, the page shows that and asks, and only a confirmed plan runs (the route keeps the plan;
// the page only ever sends back its confirm token). Installs are winget on Windows, Homebrew on macOS
// (when brew is there; elsewhere the brew/apt line to type), Claude Code is its official installer, gh signs in with a one-time code
// (gh-login.ts), and mxcli is the newest release's binary. Everything it touches comes in through
// FixDeps, like CheckDeps for the checks, so the tests run every fix against fakes; a test office's
// deps refuse to run anything real (fix-machine.ts).

import path from 'node:path';
import type { PrereqId, PrereqResult } from '../../shared/first-run.js';
import { BREW_FORMULAE, BREW_LINK, CLAUDE_INSTALL, FIX_FOR, FIX_IDS, MANUAL_INSTALL, WINGET_LINK, WINGET_PACKAGES, isWingetFix, mxcliAsset, mxcliUrl, type FixEvent, type FixId, type FixManual, type FixStep, type WingetFix } from '../../shared/first-run-fix.js';
import type { Ran } from './checks.js';
import { ghSignIn, ghToken } from './gh-login.js';

/** A program the office started, its output as it comes (offloop/exec.ts spawnOff's shape). */
export interface FixChild {
  on(ev: 'stdout' | 'stderr', fn: (chunk: string) => void): unknown;
  on(ev: 'close', fn: (code: number | null) => void): unknown;
  on(ev: 'error', fn: (err: Error) => void): unknown;
  write(data: string): void;
  kill(): void;
}

export interface FixDeps {
  platform: NodeJS.Platform;
  arch: string;
  env: NodeJS.ProcessEnv;
  /** Why nothing may run here (a test office), or undefined. */
  refuse?: string;
  find(cmd: string): Promise<string | undefined>;
  /** Starts a program (a .cmd through cmd.exe), its output as it comes. */
  spawn(file: string, args: string[], env?: NodeJS.ProcessEnv): FixChild;
  /** Runs a short program to the end. */
  run(file: string, args: string[], env?: NodeJS.ProcessEnv): Promise<Ran>;
  /** Opens a terminal window of its own running `cmd args` (found on `env`'s PATH). Returns why it couldn't. */
  openTerminal(cmd: string, args: string[], env: NodeJS.ProcessEnv): Promise<string | undefined>;
  /** Reads PATH again from where Windows keeps it, into the office's own: the folders it added, or undefined when it can't. */
  refreshPath(): Promise<string[] | undefined>;
  /** Downloads `url` to `dest` (replacing it once complete). Returns why it couldn't. */
  download(url: string, dest: string, line: (text: string) => void): Promise<string | undefined>;
  /** One prerequisite check, as the page's Re-check runs it. */
  check(id: PrereqId): Promise<PrereqResult>;
  /** Saves a token straight into 🔌 Connections as the agents' GitHub token (audited, never shown). Returns why it couldn't. */
  saveAgentToken(token: string): Promise<string | undefined>;
  hasAgentToken(): boolean;
  /** Where a downloaded mxcli goes (the office's tools folder), and pointing the office at it. */
  mxcliDest(): string;
  setMxcli(file: string): string | undefined;
  /** The toolkit clone (first-run/clone.ts) from the saved or upstream URL into the usual folder. */
  toolkit(): { url: string; dir: string };
  cloneToolkit(line: (text: string) => void): Promise<string | undefined>;
  sleep(ms: number): Promise<void>;
  /** How long a sign-in waits for the person (GitHub's codes last 15 minutes). */
  waitMs: number;
  /** Hears each fix that worked (the scripted test office turns its rows green). */
  fixed?(id: FixId): void;
}

/** winget's answers that mean "it's there already", as signed or unsigned exit codes. */
const WINGET_ALREADY = new Set([0x8a150061, 0x8a15002b]);
export const wingetOk = (code: number | null) => code === 0 || (code !== null && WINGET_ALREADY.has(code >>> 0));

/** The command a winget fix runs: the exact package from winget's own source, agreements accepted (only ever after the page's confirm). */
export const wingetArgs = (fix: WingetFix): string[] => ['install', '--id', WINGET_PACKAGES[fix].id, '--exact', '--source', 'winget', '--accept-package-agreements', '--accept-source-agreements', '--silent'];

/** The command a Homebrew fix runs (macOS, only ever after the page's confirm). */
export const brewArgs = (fix: WingetFix): string[] => ['install', BREW_FORMULAE[fix].formula];

/** brew without its questions (NONINTERACTIVE) and without updating every formula first. */
const brewEnv = (env: NodeJS.ProcessEnv): NodeJS.ProcessEnv => ({ ...env, NONINTERACTIVE: '1', HOMEBREW_NO_AUTO_UPDATE: '1', HOMEBREW_NO_ENV_HINTS: '1' });

/** gh, signed in with your own login: the office's agents' token taken out of its environment, or gh would use that instead. */
export function ghEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = { ...env, BROWSER: 'true', GH_BROWSER: 'true', GH_PROMPT_DISABLED: '1' };
  for (const k of ['GH_TOKEN', 'GITHUB_TOKEN', 'GH_ENTERPRISE_TOKEN', 'GITHUB_ENTERPRISE_TOKEN']) delete out[k];
  return out;
}

/** The command as the PM reads it. The program's name is cut from its path with the target platform's rules, not the host's: a Windows path (C:\…\powershell.exe) planned on Linux (CI, tests) keeps no folder. */
const show = (platform: NodeJS.Platform, file: string, args: string[]) => [(platform === 'win32' ? path.win32 : path.posix).basename(file).replace(/\.(exe|cmd)$/i, ''), ...args.map((a) => (/[\s|"]/.test(a) ? `"${a}"` : a))].join(' ');

/** How Claude Code is installed here: its official installer, or npm when that can't run. */
async function claudeInstaller(d: FixDeps): Promise<{ file: string; args: string[]; source: string } | undefined> {
  if (d.platform === 'win32') {
    const ps = (await d.find('powershell')) ?? (await d.find('pwsh'));
    if (ps) return { file: ps, args: ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', `irm ${CLAUDE_INSTALL.ps1} | iex`], source: CLAUDE_INSTALL.ps1 };
  } else {
    const [bash, curl] = [await d.find('bash'), await d.find('curl')];
    if (bash && curl) return { file: bash, args: ['-c', `curl -fsSL ${CLAUDE_INSTALL.sh} | bash`], source: CLAUDE_INSTALL.sh };
  }
  const npm = await d.find('npm');
  return npm ? { file: npm, args: ['install', '-g', CLAUDE_INSTALL.npm], source: `npm registry (${CLAUDE_INSTALL.npm})` } : undefined;
}

const TITLE: Record<FixId, string> = {
  node: `Install ${WINGET_PACKAGES.node.name}`,
  git: `Install ${WINGET_PACKAGES.git.name}`,
  longpaths: 'Turn on long paths in git’s user config',
  gh: `Install the ${WINGET_PACKAGES.gh.name}`,
  'gh-auth': 'Sign gh in to GitHub (one-time code in your browser)',
  'gh-token': 'Save the agents’ GitHub token from that sign-in',
  jq: `Install ${WINGET_PACKAGES.jq.name}`,
  claude: 'Install Claude Code',
  'claude-auth': 'Sign in to Claude Code (in a terminal window of its own)',
  mxcli: 'Download mxcli (the newest release)',
  toolkit: 'Clone the mxcli project toolkit',
};

/** One fix's step, or what to do by hand when the office can't do it here. */
export async function planFix(id: FixId, d: FixDeps): Promise<FixStep | FixManual> {
  const title = TITLE[id];
  const manual = (why: string, links: string[], commands: string[] = []): FixManual => ({ id, title, why, links, commands });
  if (isWingetFix(id)) {
    const m = MANUAL_INSTALL[id];
    if (d.platform === 'darwin') {
      const macTitle = `Install ${BREW_FORMULAE[id].name}`;
      if (!(await d.find('brew'))) return { id, title: macTitle, why: 'Homebrew isn’t on this Mac: install it from brew.sh (or install this from the link), then press Re-check.', links: [BREW_LINK, m.link], commands: [m.brew] };
      const note = id === 'node' ? 'The office keeps running on the Node it started with: restart it afterwards.' : undefined;
      return { id, title: macTitle, commands: [`brew ${brewArgs(id).join(' ')}`], sources: [`Homebrew, formula ${BREW_FORMULAE[id].formula} (formulae.brew.sh)`], note };
    }
    if (d.platform !== 'win32') return manual('The office only installs programs itself on Windows (with winget): type one of these.', [m.link], [`macOS: ${m.brew}`, `Linux: ${m.apt}`]);
    if (!(await d.find('winget'))) return manual('winget (App Installer) isn’t on this machine: download it from the link, or install winget first.', [m.link, WINGET_LINK]);
    const note = id === 'node' ? 'The office keeps running on the Node it started with: restart it afterwards.' : id === 'git' ? 'Brings Git Bash too.' : undefined;
    return { id, title, commands: [`winget ${wingetArgs(id).join(' ')}`], sources: [`winget’s source “winget”, package ${WINGET_PACKAGES[id].id}`], note };
  }
  switch (id) {
    case 'longpaths':
      return { id, title, commands: ['git config --global core.longpaths true'], sources: ['Your own git config (never the registry)'] };
    case 'gh-auth':
      return { id, title, commands: ['gh auth login --web --git-protocol https --hostname github.com', 'gh auth setup-git --hostname github.com'], sources: ['github.com/login/device, in your browser'], note: 'The page shows a one-time code to type on GitHub. The office never sees your password.' };
    case 'gh-token':
      return { id, title, commands: ['gh auth token  →  🔌 Connections › GitHub token for agents'], sources: ['Your gh sign-in'], note: 'The token goes straight from gh into Connections: never shown, never logged. It’s your own sign-in’s, so agents act on GitHub as you; swap in a fine-grained token in Connections any time.', optional: true };
    case 'claude': {
      const how = await claudeInstaller(d);
      if (!how) return manual('Neither Claude Code’s installer nor npm can run here: install it from the docs.', [CLAUDE_INSTALL.docs]);
      return { id, title, commands: [show(d.platform, how.file, how.args)], sources: [how.source], note: 'Claude Code’s official installer (code.claude.com/docs/en/setup), for your user only.' };
    }
    case 'claude-auth':
      if (d.platform === 'linux') return manual('Open a terminal and run claude there: it signs you in.', [CLAUDE_INSTALL.docs], ['claude']);
      return { id, title, commands: ['claude   (in a new terminal window)'], sources: ['Claude Code’s own sign-in, in that window'], note: 'Sign in there; the office never sees your credentials. It waits for the sign-in (Stop any time). Or use an API key instead, in the row.' };
    case 'mxcli': {
      const asset = mxcliAsset(d.platform, d.arch);
      if (!asset) return manual('There’s no mxcli release for this machine’s system.', [`${'https://github.com/mendixlabs/mxcli'}/releases`]);
      return { id, title, commands: [`download ${mxcliUrl(asset)}`, `save as ${d.mxcliDest()} and use it`], sources: [mxcliUrl(asset)] };
    }
    case 'toolkit': {
      const t = d.toolkit();
      return { id, title, commands: [`git clone --progress -- ${t.url} ${t.dir}`], sources: [t.url] };
    }
  }
  return manual('No fix for this one', []);
}

const isStep = (p: FixStep | FixManual): p is FixStep => 'sources' in p;

/** The fixes the check's rows ask for, in Set up everything's order (gh's token offered when the agents have none). */
export function fixesFor(rows: readonly PrereqResult[], hasAgentToken: boolean): FixId[] {
  const want = new Set<FixId>();
  for (const r of rows) if (r.status !== 'ok' && FIX_FOR[r.id]) want.add(FIX_FOR[r.id]!);
  const ghSigned = rows.some((r) => r.id === 'gh-auth' && r.status === 'ok');
  if (!hasAgentToken && (want.has('gh-auth') || ghSigned)) want.add('gh-token');
  return FIX_IDS.filter((id) => want.has(id));
}

/** A plan for `ids`: the steps the office can run, and what's left for the person. */
export async function planFixes(ids: readonly FixId[], d: FixDeps): Promise<{ steps: FixStep[]; manual: FixManual[] }> {
  const steps: FixStep[] = [];
  const manual: FixManual[] = [];
  for (const id of FIX_IDS.filter((f) => ids.includes(f))) {
    const p = await planFix(id, d);
    if (isStep(p)) steps.push(p);
    else manual.push(p);
  }
  return { steps, manual };
}

/** Runs a program to the end, every line it prints to `line`. Resolves with its exit code (null: stopped). */
function stream(d: FixDeps, file: string, args: string[], line: (t: string) => void, signal: AbortSignal, env?: NodeJS.ProcessEnv): Promise<number | null> {
  return new Promise((resolve) => {
    let tail = '';
    let child: FixChild;
    try {
      child = d.spawn(file, args, env);
    } catch (err) {
      line((err as Error).message);
      return resolve(null);
    }
    const take = (chunk: string) => {
      tail += chunk;
      const parts = tail.split(/\r\n|\r|\n/);
      tail = parts.pop() ?? '';
      for (const p of parts) if (p.trim()) line(p.trim().slice(0, 300));
    };
    const stop = () => child.kill();
    signal.addEventListener('abort', stop, { once: true });
    child.on('stdout', take);
    child.on('stderr', take);
    child.on('error', (e) => line(e.message));
    child.on('close', (code) => {
      signal.removeEventListener('abort', stop);
      if (tail.trim()) line(tail.trim().slice(0, 300));
      resolve(code);
    });
  });
}

/** After an install: the office's PATH read again, or a restart asked for. */
async function afterInstall(d: FixDeps, emit: (e: FixEvent) => void): Promise<boolean> {
  const added = await d.refreshPath().catch(() => undefined);
  emit({ t: 'path', refreshed: !!added, added: added ?? [] });
  if (!added) emit({ t: 'line', text: 'Couldn’t read the new PATH: restart the office so it sees the new program.' });
  return !!added;
}

/** Waits until `check` says yes, or the person stops, or `waitMs` runs out. Returns why it stopped waiting. */
export async function waitFor(d: FixDeps, check: () => Promise<boolean>, signal: AbortSignal, what: string): Promise<string | undefined> {
  const until = Date.now() + d.waitMs;
  while (Date.now() < until) {
    if (signal.aborted) return 'Stopped';
    if (await check()) return undefined;
    await d.sleep(3000);
  }
  return `Gave up waiting for ${what} (Re-check once you’ve finished)`;
}

export interface RunResult {
  error?: string;
  /** A restart the office needs for what was installed to count. */
  restart?: string;
}

/** Runs one step. */
async function runStep(step: FixStep, d: FixDeps, emit: (e: FixEvent) => void, signal: AbortSignal, out: RunResult): Promise<string | undefined> {
  const line = (text: string) => emit({ t: 'line', text });
  const id = step.id;
  if (isWingetFix(id) && d.platform === 'darwin') {
    const brew = await d.find('brew');
    if (!brew) return 'Homebrew (brew) isn’t on this Mac';
    const code = await stream(d, brew, brewArgs(id), line, signal, brewEnv(d.env));
    if (code !== 0) return `brew couldn’t install ${BREW_FORMULAE[id].formula} (${code === null ? 'stopped' : `exit ${code}`})`;
    if (!(await afterInstall(d, emit)) || id === 'node') out.restart = id === 'node' ? 'Restart the office so it runs on the new Node.js.' : 'Restart the office so it sees what was installed.';
    return undefined;
  }
  if (isWingetFix(id)) {
    const winget = await d.find('winget');
    if (!winget) return 'winget isn’t on this machine';
    const code = await stream(d, winget, wingetArgs(id), line, signal);
    if (!wingetOk(code)) return `winget couldn’t install ${WINGET_PACKAGES[id].id} (${code === null ? 'stopped' : `exit ${code}`})`;
    if (!(await afterInstall(d, emit)) || id === 'node') out.restart = id === 'node' ? 'Restart the office so it runs on the new Node.js.' : 'Restart the office so it sees what was installed.';
    return undefined;
  }
  switch (id) {
    case 'longpaths': {
      const git = await d.find('git');
      if (!git) return 'git isn’t on the office’s PATH (restart the office after installing it)';
      const r = await d.run(git, ['config', '--global', 'core.longpaths', 'true']);
      return r.code === 0 ? undefined : `git couldn’t set it: ${r.out.split(/\r?\n/)[0] || `exit ${r.code}`}`;
    }
    case 'gh-auth':
      return ghSignIn(d, emit, signal);
    case 'gh-token':
      return ghToken(d, line);
    case 'claude': {
      const how = await claudeInstaller(d);
      if (!how) return 'Neither Claude Code’s installer nor npm can run here';
      const code = await stream(d, how.file, how.args, line, signal);
      if (code !== 0) return `Claude Code’s installer stopped (${code === null ? 'stopped' : `exit ${code}`})`;
      if (!(await afterInstall(d, emit))) out.restart = 'Restart the office so it sees Claude Code.';
      return undefined;
    }
    case 'claude-auth': {
      const claude = await d.find('claude');
      if (!claude) return 'Claude Code isn’t on the office’s PATH yet (restart the office after installing it)';
      const dir = path.dirname(claude);
      const pathKey = Object.keys(d.env).find((k) => k.toUpperCase() === 'PATH') ?? 'PATH';
      const env = { ...d.env, [pathKey]: [dir, d.env[pathKey]].filter(Boolean).join(path.delimiter) };
      const why = await d.openTerminal('claude', [], env);
      if (why) return why;
      line('A terminal window is running claude: sign in there (the office never sees it). Waiting for the sign-in…');
      return waitFor(d, async () => (await d.check('claude-auth')).status === 'ok', signal, 'Claude Code’s sign-in');
    }
    case 'mxcli': {
      const asset = mxcliAsset(d.platform, d.arch);
      if (!asset) return 'No mxcli release for this system';
      const dest = d.mxcliDest();
      line(`Downloading ${mxcliUrl(asset)}`);
      const why = await d.download(mxcliUrl(asset), dest, line);
      if (why) return why;
      const r = await d.run(dest, ['--version']);
      if (r.code !== 0) return `The downloaded mxcli didn’t run (${r.out.split(/\r?\n/)[0] || `exit ${r.code}`})`;
      line(r.out.split(/\r?\n/)[0] ?? '');
      return d.setMxcli(dest);
    }
    case 'toolkit':
      return d.cloneToolkit(line);
  }
  return 'No fix for this one';
}

let busy = false;

/**
 * Runs confirmed steps in order, stopping at the first that fails (saying which and why). One run at a
 * time; a test office's deps refuse before anything starts.
 */
export async function runFixes(steps: readonly FixStep[], d: FixDeps, emit: (e: FixEvent) => void, signal: AbortSignal): Promise<RunResult> {
  const fail = (error: string, id?: FixId): RunResult => (emit({ t: 'done', ok: false, id, error }), { error });
  if (d.refuse) return fail(d.refuse);
  if (busy) return fail('Setup is already running something: wait for it to finish');
  busy = true;
  const out: RunResult = {};
  try {
    for (const step of steps) {
      if (signal.aborted) return fail('Stopped', step.id);
      emit({ t: 'step', id: step.id, title: step.title });
      let why: string | undefined;
      try {
        why = await runStep(step, d, emit, signal, out);
      } catch (err) {
        why = (err as Error).message;
      }
      emit({ t: 'step-done', id: step.id, ok: !why, error: why });
      if (!why) d.fixed?.(step.id);
      if (why) return { ...fail(`${step.title}: ${why}`, step.id), restart: out.restart };
    }
    emit({ t: 'done', ok: true, restart: out.restart });
    return out;
  } finally {
    busy = false;
  }
}
