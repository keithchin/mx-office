// The live app: each floor's Mendix app, built from the floor's main branch and run on the office's
// machine (server/liveapp/), so people can click through what the agents are building while they
// build it. Browsers only ever ask for start, stop or restart: what runs, where, is the office's.

import type { LiveReadiness } from '../liveapp/readiness.js';
import type { LiveLogEntry, LiveNetEntry } from '../liveapp/console.js';

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
  /**
   * Where it is in one go: getting main and building, the runtime starting, running, stopping, stopped,
   * failed. Finer than `status`, which says only whether it's on its way up.
   */
  phase?: LivePhase;
  /**
   * The served revision: the commit actually running and answering. Set only once a build is up and
   * answering on its port, and gone the moment that runtime is stopped or stops by itself. Everything that
   * says or relies on "what's running" (readiness, captures, the labels) reads this, never `target`.
   */
  served?: LiveServed;
  /**
   * The target revision: the commit it's getting, building or starting, while that isn't what serves yet.
   * Kept after a build of it failed (the failure names it); gone once it serves.
   */
  target?: LiveTarget;
  /**
   * The last revision that served, once nothing does (stopped, crashed, the office restarted): what ran
   * last and until when. Never a claim that it runs now; kept across office restarts (<live>/<floor>.served.json).
   */
  lastServed?: LiveServed & { until: number };
  /** The branch it follows, main as the floor's GitHub repo names it. */
  branch?: string;
  /** Where the app answers on the office's machine; the page builds its URL from its own host name. */
  appPort?: number;
  /**
   * Where the office's recording proxy for the app answers (a port of its own, never the office's): the
   * page opens the app through it, so the Console's Network sees its requests (server/liveapp/console/).
   */
  viewPort?: number;
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
  /** Why it isn't running when it should be: a build that failed, or an app that stopped by itself. */
  failure?: LiveAppFailure;
  /** The last look for a newer main (fetching the project's folder, then the live checkout from it). */
  refresh?: LiveAppRefresh;
  /** Where the project's main is, against what runs. */
  main?: LiveAppMain;
  /** What the running build has of the plan, milestone by milestone (shared/liveapp/readiness.ts). */
  readiness?: LiveReadiness;
  /** How the last start, restart or update went, phase by phase, and which way (hot reload or restart, and why). */
  lastUpdate?: LiveUpdate;
  /** This project's live app settings: hot reload, keep warm (server/liveapp/prefs.ts). */
  prefs?: LiveAppPrefs;
  /** How the run under way applies changes (server/liveapp/hot-mode.ts): set as it starts, kept until its next start. */
  hot?: LiveHotMode;
}

/** Whether this run of the live app was started for hot reload (`mxcli run --watch`), and why not when it wasn't. */
export interface LiveHotMode {
  on: boolean;
  /** Why this run restarts for every change: the setting is off, too little memory, an mxcli without --watch, a watch that stopped answering. */
  why?: string;
}

/** A timed phase of a start or an update (LiveUpdate.phases). */
export type LiveTimingPhase = 'fetch' | 'classify' | 'stop' | 'build' | 'apply' | 'start' | 'answer';

/** How one start, restart or update went (shared/liveapp/speed.ts says it in words). */
export interface LiveUpdate {
  /**
   * cold: a start (▶); restart: stop, build, start; hot: applied in place by mxcli's hot reload, the runtime
   * kept; none: no app files changed, so the build that serves is already that commit's.
   */
  mode: 'cold' | 'restart' | 'hot' | 'none';
  /** Why it went this way: "page and logic changes", "domain model changed", "restart asked for". */
  reason: string;
  /** Whether it came up on the new commit. */
  ok: boolean;
  /** When it ended. */
  at: number;
  totalMs: number;
  phases: { name: LiveTimingPhase; ms: number }[];
  from?: string;
  to?: string;
  /** How many commits it brought in (more than one: merges that landed meanwhile, applied once). */
  commits?: number;
  /** Those commits besides `to`, newest first (at most 10). */
  included?: { sha: string; subject?: string }[];
  /** A hot reload that didn't confirm, before it fell back to a restart: why. */
  fallback?: string;
}

/** A project's live app settings (<data>/live/<project>.prefs.json). */
export interface LiveAppPrefs {
  /** Apply page, microflow, nanoflow and theme changes in place (mxcli run --watch); a restart when that fails. */
  hotReload: boolean;
  /** Where hotReload comes from: the default (on), the project's own choice, or the office turning it off for every project. */
  hotReloadFrom?: 'default' | 'project' | 'office';
  /** Start the live app when the office starts (it holds about 2 GB of memory while it runs). */
  keepWarm: boolean;
}

/** Where a live app is in one go (LiveAppState.phase). */
export type LivePhase = 'stopped' | 'building' | 'starting' | 'running' | 'stopping' | 'failed';

/** A commit of the followed branch, as the live app knows it. */
export interface LiveRevision {
  sha: string;
  /** Its first line. */
  subject?: string;
  /** When it was made (ms). */
  commitAt?: number;
}

/** The revision that serves (or served), and when its build came up and answered. */
export interface LiveServed extends LiveRevision {
  builtAt: number;
  /**
   * The commit the running build was built from, when it isn't `sha`: the commits since change no app
   * files (docs, journals and the like), so that build is this commit's app too.
   */
  built?: string;
}

/** The revision it's on its way to, and the served one it replaces (an update or a restart), if any. */
export interface LiveTarget extends LiveRevision {
  from?: string;
}

export interface LiveAppFailure {
  /**
   * build: it never came up; crash: it was running and stopped by itself; timeout: it never answered;
   * update: an update or restart failed before the running app was stopped, so that one still serves.
   */
  kind: 'build' | 'crash' | 'timeout' | 'update';
  at: number;
  why: string;
  /** The log's last lines when it happened. */
  lines: string[];
  /** The commit it was running (a crash) or on its way to (the target). */
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
  | { t: 'liveapp.stop' }
  /** This project's live app settings (admins): hot reload, keep warm. */
  | { t: 'liveapp.prefs'; hotReload?: boolean; keepWarm?: boolean }
  /** The Console is showing (on) or not: the runtime log and the requests are streamed only while it is. */
  | { t: 'liveapp.console'; on: boolean };

export type LiveAppServerMsg =
  /** A floor's live app changed, to everyone on that floor (and to whoever asked). */
  | { t: 'liveapp.state'; state: LiveAppState }
  /**
   * The Console's news, to whoever has it showing: new or grown log entries and requests (by id: one
   * sent again replaces the one before). `reset` starts over (the first answer, or a log that began again).
   */
  | { t: 'liveapp.console'; floor: string; reset?: boolean; log?: LiveLogEntry[]; net?: LiveNetEntry[]; logMissing?: boolean };
