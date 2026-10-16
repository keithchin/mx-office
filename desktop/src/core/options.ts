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

/** The office child's environment: the launcher's loop (so 🔁 Restart safely is offered), no terminal welcome, no browser. */
export function officeEnv(base: Record<string, string | undefined>, o: Pick<DesktopOptions, 'home'>): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(base)) if (v !== undefined) env[k] = v;
  // Electron's own variables must not reach a plain Node.
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.ELECTRON_NO_ATTACH_CONSOLE;
  return {
    ...env,
    AGENT_OFFICE_HOME: o.home,
    AGENT_OFFICE_DESKTOP: '1',
    AGENT_OFFICE_LAUNCHER_LOOP: '1',
    AGENT_OFFICE_NO_WELCOME: '1',
    AGENT_OFFICE_NO_OPEN: '1',
  };
}
