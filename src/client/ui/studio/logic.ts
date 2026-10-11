// What "Edit in Studio Pro" says at each step, without the page (./index.ts draws it; the tests read
// these): before the office brings the floor's folder up to date with GitHub, and after. It never says
// only "no .mpr found": the reason comes with it (behind GitHub with local changes, on another branch,
// Studio Pro open, nothing on GitHub either).

import type { FloorSyncState, StudioInfo, StudioSyncResult } from '../../../shared/studio';

export const STUDIO_OPEN_TEXT = "Studio Pro already has the project open: the agents' mxcli writes are paused until it's closed";
export const ADMINS_ONLY_TEXT = 'Only admins can open the project in Studio Pro';

/** "386 commits". */
export const commits = (n: number) => `${n} commit${n === 1 ? '' : 's'}`;

/** Why it stops before asking the office to bring the folder up to date, if it does. */
export function stopBeforeSync(i: StudioInfo | null): string | undefined {
  if (!i) return "Couldn't ask the office about the project";
  if (i.state?.open) return STUDIO_OPEN_TEXT;
  if (!i.admin) return ADMINS_ONLY_TEXT;
  if (!i.available && i.problem !== 'no-mpr') return i.error ?? "Studio Pro can't be opened from here";
  if (i.problem === 'no-mpr' && i.machine) return i.machine.error;
  return undefined;
}

/** A line about what the folder's look against GitHub did, for a toast or the confirm. */
export function syncLine(s: FloorSyncState | undefined): string | undefined {
  if (!s) return undefined;
  if (s.state === 'moved') return `Brought the project folder up to date with GitHub (${commits(s.commits ?? 0)} from origin/${s.branch ?? 'main'})`;
  if (s.state === 'refused' && s.behind > 0) return `It opens the folder as it is, ${commits(s.behind)} behind GitHub: ${s.message}`;
  if (s.state === 'refused') return s.message;
  return undefined;
}

/** After the office looked: stop (and why), or go on to the confirm with what to tell. */
export function afterSync(r: StudioSyncResult | null): { stop: string } | { note?: string; moved: boolean } {
  if (!r) return { stop: "Couldn't reach the office to bring the project folder up to date" };
  const i = r.info;
  if (!i.hasMpr) return { stop: i.error ?? (r.sync?.state === 'refused' ? `No Mendix project (.mpr) in the project folder yet. ${r.sync.message}` : 'No Mendix project (.mpr) in the project folder, on GitHub either') };
  if (i.state?.open) return { stop: STUDIO_OPEN_TEXT };
  if (!i.available) return { stop: i.error ?? "Studio Pro can't be opened from here" };
  return { note: syncLine(r.sync), moved: r.sync?.state === 'moved' };
}
