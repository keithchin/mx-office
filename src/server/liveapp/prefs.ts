// A project's live app settings, in <live dir>/<project>.prefs.json: hot reload (page and logic changes
// applied in place by `mxcli run --watch`, a restart when that fails) and keep warm (started with the
// office). Admins change them on the Live app tab; each change is audited (ws/handlers/liveapp.ts).
//
// Hot reload is on unless something says off: the project's own stored choice (an explicit false stays off,
// whenever it was stored), or the office turning it off for every project (live-app.json `hotReload: false`,
// AGENT_OFFICE_LIVE_HOT_RELOAD=0), which wins over a project's on. So a project that never chose, new or
// from before hot reload was on by default, gets it at its next start. Only what an admin names is stored,
// so turning keep warm on doesn't pin hot reload. Keep warm is off unless a project turns it on. Small, rare
// writes through a temporary file.

import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { LiveAppPrefs } from '../../shared/protocol.js';

const fileOf = (liveDir: string, floorId: string) => path.join(liveDir, `${floorId}.prefs.json`);

type Stored = { hotReload?: boolean; keepWarm?: boolean };

function stored(liveDir: string, floorId: string): Stored {
  try {
    const o = JSON.parse(readFileSync(fileOf(liveDir, floorId), 'utf8')) ?? {};
    return { ...(typeof o.hotReload === 'boolean' ? { hotReload: o.hotReload } : {}), ...(typeof o.keepWarm === 'boolean' ? { keepWarm: o.keepWarm } : {}) };
  } catch {
    // None yet (the usual case): nothing chosen.
    return {};
  }
}

/** The project's settings: its own choices, the office's off over them, else the defaults (hot reload on, keep warm off). */
export function readPrefs(liveDir: string, floorId: string, office: { hotReload: boolean }): LiveAppPrefs {
  const o = stored(liveDir, floorId);
  const hot: Pick<LiveAppPrefs, 'hotReload' | 'hotReloadFrom'> = !office.hotReload ? { hotReload: false, hotReloadFrom: 'office' } : o.hotReload !== undefined ? { hotReload: o.hotReload, hotReloadFrom: 'project' } : { hotReload: true, hotReloadFrom: 'default' };
  return { ...hot, keepWarm: o.keepWarm === true };
}

/** Saves a change (only the booleans it names, beside what was chosen before); gives back the settings now. */
export function writePrefs(liveDir: string, floorId: string, patch: Partial<LiveAppPrefs>, office: { hotReload: boolean }): LiveAppPrefs {
  const next: Stored = { ...stored(liveDir, floorId) };
  if (typeof patch.hotReload === 'boolean') next.hotReload = patch.hotReload;
  if (typeof patch.keepWarm === 'boolean') next.keepWarm = patch.keepWarm;
  mkdirSync(liveDir, { recursive: true });
  const file = fileOf(liveDir, floorId);
  writeFileSync(`${file}.tmp`, JSON.stringify(next));
  renameSync(`${file}.tmp`, file);
  return readPrefs(liveDir, floorId, office);
}

/** A deleted project's settings go with it. */
export function forgetPrefs(liveDir: string, floorId: string): void {
  rmSync(fileOf(liveDir, floorId), { force: true });
}
