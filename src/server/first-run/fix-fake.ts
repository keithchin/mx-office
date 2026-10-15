// First-run setup's fixes, scripted (a test office started with AGENT_OFFICE_FAKE_SETUP=1, and the
// tests): every program "runs" by printing what the real one would, a beat apart, and nothing on the
// machine is started, downloaded, signed in or saved. gh prints a made-up one-time code and waits
// AGENT_OFFICE_FAKE_SETUP_WAIT ms (default 20 s) before saying yes, so the code panel can be seen.

import { EventEmitter } from 'node:events';
import type { PrereqId, PrereqResult } from '../../shared/first-run.js';
import { FIX_FOR } from '../../shared/first-run-fix.js';
import type { FixChild, FixDeps } from './fixes.js';

/** A child that prints `lines` (stdout) a beat apart, then exits with `code`. */
export function scriptedChild(lines: string[], code = 0, gapMs = 150, holdMs = 0): FixChild {
  const ee = new EventEmitter();
  let killed = false;
  const timers: ReturnType<typeof setTimeout>[] = [];
  lines.forEach((l, i) => timers.push(setTimeout(() => !killed && ee.emit('stdout', `${l}\n`), gapMs * (i + 1))));
  timers.push(setTimeout(() => !killed && ee.emit('close', code), gapMs * (lines.length + 1) + holdMs));
  return Object.assign(ee, {
    write: () => undefined,
    kill: () => {
      if (killed) return;
      killed = true;
      timers.forEach(clearTimeout);
      setTimeout(() => ee.emit('close', null), 0);
    },
  }) as unknown as FixChild;
}

/** What each fake program prints for `args`. */
function script(file: string, args: string[], holdMs: number): FixChild {
  const name = file.replace(/^.*[\\/]/, '').replace(/\.(exe|cmd)$/i, '');
  if (name === 'winget') {
    const id = args[args.indexOf('--id') + 1];
    return scriptedChild([`Found ${id} [${id}] Version 1.0.0 (test office: nothing is installed)`, 'This application is licensed to you by its owner.', 'Downloading …', 'Successfully verified installer hash', 'Starting package install...', 'Successfully installed']);
  }
  if (name === 'gh' && args[1] === 'login')
    return scriptedChild(['! First copy your one-time code: 4F2A-9C1D', 'Open this URL to continue in your web browser: https://github.com/login/device', '(test office: nothing is signed in)', '✓ Authentication complete.', '✓ Logged in as octo-test'], 0, 400, holdMs);
  if (name === 'powershell' || name === 'npm') return scriptedChild(['Setting up Claude Code... (test office: nothing is installed)', '✔ Claude Code successfully installed!', 'Location: ~\\.local\\bin\\claude.exe']);
  return scriptedChild([`${name} ${args.join(' ')} (test office)`]);
}

/** The scripted office's machine: a fresh Windows laptop with Node and nothing else (a fix turns its rows green). */
const FRESH: Partial<Record<PrereqId, Omit<PrereqResult, 'id'>>> = {
  git: { status: 'missing', text: 'git isn’t installed (or not on the office’s PATH)', fix: 'Press Fix to install it with winget.' },
  gitbash: { status: 'missing', text: 'Git Bash isn’t at C:\\Program Files\\Git\\bin\\bash.exe', fix: 'It comes with Git for Windows: press Fix.' },
  longpaths: { status: 'warn', text: 'Needs git first' },
  gh: { status: 'missing', text: 'gh (the GitHub CLI) isn’t installed (or not on the office’s PATH)', fix: 'Press Fix to install it with winget.' },
  'gh-auth': { status: 'missing', text: 'Needs gh first' },
  claude: { status: 'missing', text: 'Claude Code (claude) isn’t installed (or not on the office’s PATH)', fix: 'Press Fix to install it with its official installer.' },
  'claude-auth': { status: 'missing', text: 'No Claude Code sign-in found for this Windows user', fix: 'Sign in with your Claude account, or use an API key.' },
  studio: { status: 'missing', text: 'No Studio Pro under C:\\Program Files\\Mendix', fix: 'Install Studio Pro 11.12 (see the link).' },
  mxcli: { status: 'missing', text: 'No mxcli found', fix: 'Press Fix to download the newest release, or give its path.' },
  jq: { status: 'missing', text: 'No jq found', fix: 'Press Fix to install it with winget.' },
  toolkit: { status: 'missing', text: 'No toolkit folder picked yet', fix: 'Press Fix to clone it, or pick its folder in the Toolkit step.' },
  postgres: { status: 'missing', text: 'Nothing answers on localhost:5432', fix: 'Optional: install PostgreSQL for the Live app.' },
};
const fakeState = new Map<PrereqId, Omit<PrereqResult, 'id'>>(Object.entries(FRESH) as [PrereqId, Omit<PrereqResult, 'id'>][]);

export function fakeFixDeps(o: { holdMs?: number; checks?: Partial<Record<PrereqId, 'ok' | 'missing'>> } = {}): FixDeps {
  const holdMs = o.holdMs ?? (Number(process.env.AGENT_OFFICE_FAKE_SETUP_WAIT) || 20_000);
  return {
    platform: 'win32',
    arch: 'x64',
    env: {},
    find: async (cmd) => (['winget', 'git', 'gh', 'powershell', 'claude', 'reg'].includes(cmd) ? `C:\\fake\\${cmd}.exe` : undefined),
    spawn: (file, args) => script(file, args, holdMs),
    // A made-up token for `gh auth token` (the fake saveAgentToken keeps nothing).
    run: async (file, args) => ({ code: 0, out: args[0] === '--version' ? 'mxcli v0.26.0 (test office)' : args[1] === 'token' ? `gho_${'F'.repeat(36)}` : 'ok (test office)' }),
    openTerminal: async () => undefined,
    refreshPath: async () => ['C:\\fake\\new-program'],
    download: async (url, dest, line) => (line(`(test office) would download ${url} to ${dest}`), undefined),
    check: async (id) => {
      if (o.checks) return { id, status: o.checks[id] ?? 'ok', text: 'test office' };
      return { id, ...(fakeState.get(id) ?? { status: 'ok', text: id === 'node' ? 'Node.js 22.11.0' : 'Fine (test office)' }) };
    },
    fixed: (fix) => {
      if (o.checks) return;
      for (const [row, f] of Object.entries(FIX_FOR)) if (f === fix) fakeState.set(row as PrereqId, { status: 'ok', text: 'Fixed (test office: nothing was installed)' });
    },
    saveAgentToken: async () => undefined,
    hasAgentToken: () => false,
    mxcliDest: () => 'C:\\office\\tools\\mxcli\\mxcli.exe',
    setMxcli: () => undefined,
    toolkit: () => ({ url: 'https://github.com/MendixMau/mxcli-project-toolkit.git', dir: 'C:\\Users\\you\\mendix-toolkit' }),
    cloneToolkit: async (line) => (line('Cloning into … (test office: nothing is cloned)'), undefined),
    sleep: (ms) => new Promise((r) => setTimeout(r, Math.min(ms, 50))),
    waitMs: 60_000,
  };
}
