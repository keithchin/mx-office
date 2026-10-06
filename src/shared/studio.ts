// "Open in Studio Pro" on the floor page (server/studio/): what the office says about a floor's Mendix
// project before anyone opens it, and what opening it answers. And Studio mode: whether Studio Pro
// has the project open right now (detected, not remembered), which pauses the agents' mxcli writes.

/** Why the project can't be opened from here. */
export type StudioProblem = 'no-desktop' | 'not-windows' | 'no-mpr' | 'not-installed';

/** Someone opened a floor's project in Studio Pro. */
export interface StudioOpen {
  floor: string;
  by: string;
  at: number;
  mpr: string;
  version?: string;
}

/** GET /api/studio?floor=<id>: whether the floor page offers the button, and what its confirm says. */
export interface StudioInfo {
  hasMpr: boolean;
  /** The project, relative to the floor's checkout. */
  mpr?: string;
  /** The Mendix version it was saved in ("11.6.4"), when the office could read it. */
  version?: string;
  /** Whether it can be opened from here (a desktop, Windows, Studio Pro installed). */
  available: boolean;
  problem?: StudioProblem;
  error?: string;
  /** Whether you may open it (admins only). */
  admin: boolean;
  /** The agents on the floor in the middle of a turn, who may be about to run mxcli exec. */
  busy: string[];
  /** Who last opened it in Studio Pro since the office started. */
  last?: StudioOpen;
  /** Studio mode: whether Studio Pro has the project open right now. */
  state?: StudioState;
}

/** How the office knows Studio Pro has the project open. */
export type StudioVia = 'process' | 'lock';

/**
 * Studio mode for one floor (server/studio/watch.ts): Studio Pro is open on the floor's project when a
 * studiopro.exe names the .mpr on its command line, or the .mpr.lock is there while a studiopro.exe
 * that names no other project runs. A lock with no Studio Pro running at all is a stale lock: shown,
 * not enforced. While `open`, the agents' mxcli writes are paused (the PreToolUse guard).
 */
export interface StudioState {
  floor: string;
  open: boolean;
  /** Since when it has been open (or closed). */
  since: number;
  /** The studiopro.exe that has it open. */
  pid?: number;
  via?: StudioVia;
  /** The .mpr.lock is there with no Studio Pro running: since when. */
  staleLock?: { since: number };
  /** Studio Pro's own MCP server (11.10 and up), while it's open: whether it answers. */
  mcp?: { url: string; available: boolean };
  /** Studio Pro closed with model changes nobody has committed yet. */
  uncommitted?: { since: number; files: number };
}

/** One change of a floor's Studio mode, kept in the floor's data folder. */
export interface StudioTransition {
  at: number;
  event: 'opened' | 'closed' | 'stale-lock' | 'lock-cleared';
  pid?: number;
  via?: StudioVia;
}

/** The marker the office writes in `<floor>/.agent-office/` while Studio Pro is open; the guard reads it. */
export const STUDIO_MARKER = 'studio-open.json';

export interface StudioMarker {
  floor: string;
  /** The project's name ("Shop App"), for the guard's message. */
  app: string;
  mpr: string;
  since: number;
  pid?: number;
  /** Studio Pro's MCP server when it answers: mxcli --mcp <url> routes writes through it. */
  mcp?: string;
}

/** A Mendix version is 11.10 or newer: Studio Pro has an MCP server. */
export function hasStudioMcp(version: string | undefined): boolean {
  const [a = 0, b = 0] = (version ?? '').split('.').map(Number);
  return a > 11 || (a === 11 && b >= 10);
}

/** POST /api/studio/open {floor}: what happened. */
export type StudioOpenResult = { ok: true; mpr: string; version?: string } | { ok: false; error: string; problem?: StudioProblem };
