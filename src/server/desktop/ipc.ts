// The desktop app (desktop/, docs/site/administration/desktop-app.md) starts the office as a child of its
// own, with the system Node and an IPC channel, and AGENT_OFFICE_DESKTOP=1. Over that channel only (never
// HTTP, never the log) the office hands it a one-time sign-in link, so its window opens signed in like a
// browser started from a terminal does, and takes two requests: stop (what Ctrl+C does in a terminal: the
// office closes and its agents stop) and restart now (the restart exit, workers' terminals kept, code 75,
// which the app starts again like the launcher's loop does). On Windows a parent can't send a child a
// signal it can catch, hence the channel. Without the env or the channel, nothing here runs.

import { RESTART_EXIT_CODE } from '../../shared/project-run.js';
import { exitOffice } from '../restart/exit.js';

export const DESKTOP_ENV = 'AGENT_OFFICE_DESKTOP';

/** What the app sends the office. */
export type DesktopRequest = { t: 'stop' } | { t: 'restart-now' };
/** What the office sends the app. */
export type DesktopNote = { t: 'ready'; signIn?: string };

/** Whether the desktop app started this office (its env, and the channel it opened). */
export const fromDesktop = (env: NodeJS.ProcessEnv = process.env, proc: Pick<NodeJS.Process, 'send'> = process) => env[DESKTOP_ENV] === '1' && typeof proc.send === 'function';

export interface DesktopWiring {
  /** A sign-in link's path (/login#key=…), when the office signs in with its password. */
  signIn?: () => string;
  /** Close the office and stop its agents (cli.ts's Ctrl+C). */
  stop: () => void;
  /** Exit for a restart (default: exitOffice with RESTART_EXIT_CODE). */
  restart?: () => void;
}

/** What one request from the app does; unknown ones do nothing. */
export function handleDesktopRequest(msg: unknown, w: DesktopWiring): boolean {
  const t = msg && typeof msg === 'object' ? (msg as { t?: unknown }).t : undefined;
  if (t === 'stop') {
    w.stop();
    return true;
  }
  if (t === 'restart-now') {
    (w.restart ?? (() => exitOffice(RESTART_EXIT_CODE)))();
    return true;
  }
  return false;
}

/** cli.ts, once the office listens: tell the app it's up, and listen for its requests. */
export function wireDesktop(w: DesktopWiring, proc: NodeJS.Process = process): boolean {
  if (!fromDesktop(proc.env, proc)) return false;
  const note: DesktopNote = { t: 'ready', ...(w.signIn ? { signIn: w.signIn() } : {}) };
  try {
    proc.send!(note);
  } catch {
    // the app went away: the office carries on by itself
  }
  proc.on('message', (m) => void handleDesktopRequest(m, w));
  // The app quitting without a word (a crash) must not take the office and its agents with it.
  proc.on('disconnect', () => console.log('agent-office: the desktop app went away; the office keeps running'));
  // The channel alone mustn't keep a stopped office's process alive.
  (proc.channel as { unref?: () => void } | undefined)?.unref?.();
  return true;
}
