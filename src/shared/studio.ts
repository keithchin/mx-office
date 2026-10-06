// "Open in Studio Pro" on the floor page (server/studio/): what the office says about a floor's Mendix
// project before anyone opens it, and what opening it answers.

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
}

/** POST /api/studio/open {floor}: what happened. */
export type StudioOpenResult = { ok: true; mpr: string; version?: string } | { ok: false; error: string; problem?: StudioProblem };
