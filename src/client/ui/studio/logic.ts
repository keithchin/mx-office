// What "Edit in Studio Pro" says at each step, without the page (./index.ts draws it; the tests read
// these): before the office brings the floor's folder up to date with GitHub, and after. It never says
// only "no .mpr found": the reason comes with it (behind GitHub with local changes, on another branch,
// Studio Pro open, nothing on GitHub either).

import type { FloorSyncState, StudioInfo, StudioSyncResult } from '../../../shared/studio';

export const STUDIO_OPEN_TEXT = "Studio Pro already has the project open: the agents' mxcli writes are paused until it's closed";
export const ADMINS_ONLY_TEXT = 'Only admins can open the project in Studio Pro';

/** "386 commits". */
export const commits = (n: number) => `${n} commit${n === 1 ? '' : 's'}`;

/** A call to the office that didn't bring what it asked for, and the real reason why (never only "couldn't reach the office"). */
export interface Failed {
  failed: string;
}

export const isFailed = (x: unknown): x is Failed => !!x && typeof (x as Failed).failed === 'string';

/** How long the page waits for the folder to be brought up to date (a long fast-forward on Windows is minutes, not more). */
export const SYNC_WAIT_MS = 4 * 60_000;

/** A request that never got an answer: what the browser said, by its error's name (TypeError, AbortError, TimeoutError…). */
export function unreachedText(err: unknown): string {
  const e = err as { name?: unknown; message?: unknown } | null;
  const name = typeof e?.name === 'string' && e.name ? e.name : 'Error';
  const message = typeof e?.message === 'string' ? e.message : String(err);
  if (name === 'TimeoutError') return `The office didn't answer in time (${name}: ${message})`;
  return `The request didn't reach the office (${name}${message ? `: ${message}` : ''})`;
}

/** What an answer means: its JSON when it's a success, else the reason the office gave (or what came back, when it gave none). */
export function answerOf<T>(status: number, statusText: string, text: string): T | Failed {
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    body = undefined;
  }
  const error = (body as { error?: unknown } | undefined)?.error;
  const ok = status >= 200 && status < 300;
  if (ok && body !== undefined && !(typeof error === 'string' && (body as { ok?: unknown }).ok === false)) return body as T;
  if (typeof error === 'string' && error) return { failed: error };
  const said = text.trim().replace(/\s+/g, ' ').slice(0, 160);
  const code = `HTTP ${status}${statusText ? ` ${statusText}` : ''}`;
  return { failed: ok ? `The office's answer wasn't readable (${code}${said ? `: ${said}` : ''})` : `The office answered ${code} without a reason${said ? ` (${said})` : ''}` };
}

/** A call to the office: its JSON answer, or why there isn't one. Never throws. */
export async function askOffice<T>(url: string, init: RequestInit = {}, timeoutMs?: number): Promise<T | Failed> {
  try {
    const res = await fetch(url, { credentials: 'same-origin', ...init, ...(timeoutMs ? { signal: AbortSignal.timeout(timeoutMs) } : {}) });
    return answerOf<T>(res.status, res.statusText, await res.text());
  } catch (err) {
    return { failed: unreachedText(err) };
  }
}

/** Why it stops before asking the office to bring the folder up to date, if it does. */
export function stopBeforeSync(i: StudioInfo | Failed | null): string | undefined {
  if (isFailed(i)) return `Couldn't ask the office about the project: ${i.failed}`;
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
export function afterSync(r: StudioSyncResult | Failed): { stop: string; failed?: true } | { note?: string; moved: boolean } {
  if (isFailed(r)) return { stop: `Couldn't bring the project folder up to date: ${r.failed}`, failed: true };
  const i = r.info;
  if (!i.hasMpr) return { stop: i.error ?? (r.sync?.state === 'refused' ? `No Mendix project (.mpr) in the project folder yet. ${r.sync.message}` : 'No Mendix project (.mpr) in the project folder, on GitHub either') };
  if (i.state?.open) return { stop: STUDIO_OPEN_TEXT };
  if (!i.available) return { stop: i.error ?? "Studio Pro can't be opened from here" };
  return { note: syncLine(r.sync), moved: r.sync?.state === 'moved' };
}
