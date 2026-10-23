// Which way a live app's run applies page and logic changes, decided as it starts (app.ts spawnApp): hot
// reload (`mxcli run --watch`) when the project's setting is on (the default, ./prefs.ts), this mxcli has
// --watch, its watch answered in this run so far, and the machine has the memory for it; else every change
// restarts, and the Live app tab says why. A run keeps its way until its next start.
//
// Memory: under --watch mxcli keeps its incremental web bundler resident (node and deno, about 1.3 GB of the
// 1.5 to 2 GB a live app holds, the QB0 measurements); without it the bundler runs once per start and exits.
// So a project whose app would start with less free than a hot-reload app needs starts without --watch.

import os from 'node:os';
import type { LiveAppPrefs, LiveHotMode } from '../../shared/protocol.js';

/** What a hot-reload live app holds at most (measured: 1.5–2 GB, the resident bundler included). */
export const HOT_APP_BYTES = 2 * 1024 ** 3;
/** Free memory a hot-reload start wants: the app's, and half a gigabyte to spare. */
export const HOT_FREE_BYTES = HOT_APP_BYTES + 512 * 1024 ** 2;

const gb = (b: number) => `${(b / 1024 ** 3).toFixed(1)} GB`;

export interface HotModeDeps {
  prefs?(): LiveAppPrefs;
  /** Whether this mxcli takes --watch (mxbuild.ts supportsWatch). */
  supportsWatch(mxcli: string): Promise<boolean>;
  /** Memory free now, in bytes (machine.ts availableMemory); none: not looked at (tests). */
  free?(): Promise<number> | number;
  total?(): number;
}

/** How this start runs: hot reload, or restarts and why. `misses`: watch applies in a row nobody answered. */
export async function hotMode(mxcli: string, d: HotModeDeps, misses: number): Promise<LiveHotMode> {
  const p = d.prefs?.();
  if (!p?.hotReload) return { on: false, why: p?.hotReloadFrom === 'office' ? 'hot reload is off for every project on this office' : 'hot reload is off' };
  if (misses >= 2) return { on: false, why: "hot reload is paused: mxcli's watch didn't answer twice in a row" };
  if (!(await d.supportsWatch(mxcli))) return { on: false, why: 'this mxcli has no --watch, so every update restarts' };
  if (d.free) {
    const free = await d.free();
    if (free < HOT_FREE_BYTES) return { on: false, why: `only ${gb(free)} of ${gb(d.total?.() ?? os.totalmem())} memory free, and a hot-reload app needs about ${gb(HOT_APP_BYTES)}: this run restarts for every change` };
  }
  return { on: true };
}
