// The live app: each floor's Mendix app, built from the floor's main branch and run on the office's
// machine (server/liveapp/), so people can click through what the agents are building while they
// build it. Browsers only ever ask for start, stop or restart: what runs, where, is the office's.

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
