// What the desktop app is started with: the office checkout it runs, the office home (its data folder is
// <home>/.agent-office, like `npm start`), the port, and anything for the office itself after `--`.
//
//   electron . [--office-dir <checkout>] [--home <office home>] [--port <n>] [--user-data <dir>]
//              [--node <node.exe>] [--attach ask|always|never] [-- <office options…>]
//
// Each also comes from the environment: MX_OFFICE_DIR, AGENT_OFFICE_HOME, MX_OFFICE_PORT (else PORT),
// MX_OFFICE_DESKTOP_DATA, MX_OFFICE_NODE. Anything else on the command line (Chromium's own switches) is
// left alone. Pure: no Electron, no file system.

import path from 'node:path';

export const DEFAULT_PORT = 4600;

export type AttachMode = 'ask' | 'always' | 'never';

export interface DesktopOptions {
  /** The office checkout (the folder with its package.json), when given. */
  officeDir?: string;
  /** The office home: its data is <home>/.agent-office. */
  home: string;
  port: number;
  /** Where the app keeps its own files (window, seen notifications, cookies), when not Electron's default. */
  userData?: string;
  /** The Node to run the office with, when not the one on PATH. */
  node?: string;
  /** What to do when an office already answers on the port. */
  attach: AttachMode;
  /** Passed to the office as they are (after `--`). */
  officeArgs: string[];
}

const FLAGS = new Set(['--office-dir', '--home', '--port', '--user-data', '--node', '--attach']);

function portOf(v: string | undefined): number | undefined {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 && n < 65536 ? n : undefined;
}

/** The options from `argv` (the app's own arguments, without Electron's path and app folder) and `env`. */
export function parseOptions(argv: readonly string[], env: Record<string, string | undefined>, homedir: string): DesktopOptions {
  const given: Record<string, string> = {};
  const officeArgs: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--') {
      officeArgs.push(...argv.slice(i + 1));
      break;
    }
    const eq = a.indexOf('=');
    const name = eq > 0 ? a.slice(0, eq) : a;
    if (!FLAGS.has(name)) continue;
    const value = eq > 0 ? a.slice(eq + 1) : argv[i + 1];
    if (eq < 0) i++;
    if (value !== undefined) given[name] = value;
  }
  const attach = given['--attach'];
  const officeDir = given['--office-dir'] || env.MX_OFFICE_DIR;
  const userData = given['--user-data'] || env.MX_OFFICE_DESKTOP_DATA;
  const node = given['--node'] || env.MX_OFFICE_NODE;
  return {
    ...(officeDir ? { officeDir: path.resolve(officeDir) } : {}),
    home: path.resolve(given['--home'] || env.AGENT_OFFICE_HOME || path.join(homedir, 'agent-office')),
    port: portOf(given['--port']) ?? portOf(env.MX_OFFICE_PORT) ?? portOf(env.PORT) ?? DEFAULT_PORT,
    ...(userData ? { userData: path.resolve(userData) } : {}),
    ...(node ? { node } : {}),
    attach: attach === 'always' || attach === 'never' ? attach : 'ask',
    officeArgs,
  };
}

/** The office's data folder for a home. */
export const dataDirOf = (home: string) => path.join(home, '.agent-office');

/** The office's address in the window (localhost: the sign-in link and the cookies are for it). */
export const officeUrl = (port: number) => `http://localhost:${port}`;

/** Where the app probes it (the office listens on 127.0.0.1 by default). */
export const probeUrl = (port: number) => `http://127.0.0.1:${port}`;

/** The office's arguments: the port always (so a PORT in the environment can't move it), then the rest. */
export function officeArgv(o: Pick<DesktopOptions, 'port' | 'officeArgs'>): string[] {
  const rest = [...o.officeArgs];
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === '--port' || rest[i] === '-p') rest.splice(i--, 2);
    else if (rest[i].startsWith('--port=')) rest.splice(i--, 1);
  }
  return ['--port', String(o.port), ...rest];
}

/**
 * Claude's credential set (the office's shared/claude-auth.ts): a key and the base URL it belongs to. The office
 * decides whether agents get it (🔌 Connections → Claude for agents), so the app passes it on only when that says
 * so; a Windows user variable left over (or a gateway's key without its address) never reaches the agents unasked.
 */
export const CLAUDE_SET = ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_BASE_URL'] as const;

/** Whether the office's settings (office-settings.json's text) say to keep the environment's Claude credentials. */
export function keepsClaudeEnv(settingsText: string | undefined): boolean {
  try {
    return JSON.parse(settingsText ?? '')?.claudeAuth?.mode === 'env';
  } catch {
    return false;
  }
}

/** The log's line about it: names only, never a value. */
export function claudeEnvLine(base: Record<string, string | undefined>, keep: boolean): string {
  const names = CLAUDE_SET.filter((k) => base[k]);
  if (!names.length) return 'Claude for agents: no Claude key in the environment; agents use their Claude login unless Connections says otherwise';
  return keep ? `Claude for agents: passing ${names.join(', ')} to the office (Connections says to use the office’s environment)` : `Claude for agents: not passing ${names.join(', ')} to the office (Connections decides; agents use their Claude login unless it says otherwise)`;
}

/** The office child's environment: the launcher's loop (so 🔁 Restart safely is offered), no terminal welcome, no browser; Claude's set only with `keepClaude`. */
export function officeEnv(base: Record<string, string | undefined>, o: Pick<DesktopOptions, 'home'>, keepClaude = false): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(base)) if (v !== undefined) env[k] = v;
  // Electron's own variables must not reach a plain Node.
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.ELECTRON_NO_ATTACH_CONSOLE;
  const withheld = keepClaude ? [] : CLAUDE_SET.filter((k) => env[k]);
  for (const k of CLAUDE_SET) if (!keepClaude) delete env[k];
  return {
    ...env,
    // Names only, so the office can say what the app held back.
    ...(withheld.length ? { AGENT_OFFICE_CLAUDE_WITHHELD: withheld.join(',') } : {}),
    AGENT_OFFICE_HOME: o.home,
    AGENT_OFFICE_DESKTOP: '1',
    AGENT_OFFICE_LAUNCHER_LOOP: '1',
    AGENT_OFFICE_NO_WELCOME: '1',
    AGENT_OFFICE_NO_OPEN: '1',
  };
}
