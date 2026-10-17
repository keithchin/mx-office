// The live app: each floor's Mendix app, built from the floor's main branch and run on the office's
// machine (server/liveapp/), so people can click through what the agents are building while they
// build it. Browsers only ever ask for start, stop or restart: what runs, where, is the office's.

import type { LiveReadiness } from '../liveapp/readiness.js';

/**
 * Where a floor's live app is. `updating` is a restart because main moved; `failed` keeps the last
 * lines of the log so the page can say why.
 */
export type LiveAppStatus = 'stopped' | 'starting' | 'running' | 'updating' | 'stopping' | 'failed';

export interface LiveAppState {
  floor: string;
  status: LiveAppStatus;
  /** A sentence for people: "Building the web client…", "Updating to 1a2b3c4…", why it failed. */
  message?: string;
  /** The commit of main it runs (or is starting), and that commit's first line. */
  sha?: string;
  subject?: string;
  /** The branch it follows, main as the floor's GitHub repo names it. */
  branch?: string;
  /** Where the app answers on the office's machine; the page builds its URL from its own host name. */
  appPort?: number;
  /** When it last became running, or started starting. */
  since?: number;
  /** Who last started, restarted or stopped it ("auto-refresh" when main moved). */
  by?: string;
  /** The last lines of its log: while it starts, and after it failed. */
  log: string[];
  /** Whether mxcli was found on the office's machine; without it nothing can start. */
  available: boolean;
  /** Whether anyone started it since the office started (else it's "not started", not "stopped"). */
  started?: boolean;
  /** When the commit it runs was made (ms). */
  commitAt?: number;
  /** When the build it runs came up (ms). */
  builtAt?: number;
  /** Why it isn't running when it should be: a build that failed, or an app that stopped by itself. */
  failure?: LiveAppFailure;
  /** The last look for a newer main (fetching the project's folder, then the live checkout from it). */
  refresh?: LiveAppRefresh;
  /** Where the project's main is, against what runs. */
  main?: LiveAppMain;
  /** What the running build has of the plan, milestone by milestone (shared/liveapp/readiness.ts). */
  readiness?: LiveReadiness;
}

export interface LiveAppFailure {
  /** build: it never came up; crash: it was running and stopped by itself; timeout: it never answered. */
  kind: 'build' | 'crash' | 'timeout';
  at: number;
  why: string;
  /** The log's last lines when it happened. */
  lines: string[];
  /** The commit it was running or building. */
  sha?: string;
}

export interface LiveAppRefresh {
  ok: boolean;
  at: number;
  error?: string;
}

export interface LiveAppMain {
  sha: string;
  at?: number;
  /** Commits main has that the running build hasn't. */
  behind: number;
}

export type LiveAppClientMsg =
  /** What your floor's live app is doing right now (answered with liveapp.state). */
  | { t: 'liveapp.status' }
  /** Build your floor's main and run it; nothing when it's already up or on its way. */
  | { t: 'liveapp.start' }
  /** Stop it and start it again, on the newest main. */
  | { t: 'liveapp.restart' }
  | { t: 'liveapp.stop' };

export type LiveAppServerMsg =
  /** A floor's live app changed, to everyone on that floor (and to whoever asked). */
  { t: 'liveapp.state'; state: LiveAppState };
