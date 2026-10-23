// A project's live app settings, in <live dir>/<project>.prefs.json: hot reload (page and logic changes
// applied in place by `mxcli run --watch`, a restart when that fails) and keep warm (started with the
// office). Admins change them on the Live app tab; each change is audited (ws/handlers/liveapp.ts). Hot
// reload's default is the office's (live-app.json `hotReload`, AGENT_OFFICE_LIVE_HOT_RELOAD); keep warm is
// off unless a project turns it on. Small, rare writes through a temporary file.

import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { LiveAppPrefs } from '../../shared/protocol.js';

const fileOf = (liveDir: string, floorId: string) => path.join(liveDir, `${floorId}.prefs.json`);

/** The project's settings, its own file over the office's defaults. */
export function readPrefs(liveDir: string, floorId: string, defaults: { hotReload: boolean }): LiveAppPrefs {
  let o: Partial<LiveAppPrefs> = {};
  try {
    o = JSON.parse(readFileSync(fileOf(liveDir, floorId), 'utf8')) ?? {};
  } catch {
    // None yet (the usual case): the defaults.
  }
  return { hotReload: typeof o.hotReload === 'boolean' ? o.hotReload : defaults.hotReload, keepWarm: o.keepWarm === true };
}

/** Saves a change (only the booleans it names); gives back the settings now. */
export function writePrefs(liveDir: string, floorId: string, patch: Partial<LiveAppPrefs>, defaults: { hotReload: boolean }): LiveAppPrefs {
  const now = readPrefs(liveDir, floorId, defaults);
  const next: LiveAppPrefs = { hotReload: typeof patch.hotReload === 'boolean' ? patch.hotReload : now.hotReload, keepWarm: typeof patch.keepWarm === 'boolean' ? patch.keepWarm : now.keepWarm };
  mkdirSync(liveDir, { recursive: true });
  const file = fileOf(liveDir, floorId);
  writeFileSync(`${file}.tmp`, JSON.stringify(next));
  renameSync(`${file}.tmp`, file);
  return next;
}

/** A deleted project's settings go with it. */
export function forgetPrefs(liveDir: string, floorId: string): void {
  rmSync(fileOf(liveDir, floorId), { force: true });
}
