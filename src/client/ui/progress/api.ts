// The progress bar's and the acceptance record's calls (server http/routes/progress.ts). A failed GET
// comes back undefined (the bar keeps what it had); a failed POST says why in a toast.

import type { AcceptanceDraft, AcceptanceRecord, AcceptanceView, Exception, Reopen } from '../../../shared/acceptance';
import type { ProjectProgress } from '../../../shared/progress';
import { myName } from '../project-run/api';
import { toast } from '../dom';

async function get<T>(url: string): Promise<T | undefined> {
  try {
    const res = await fetch(url, { credentials: 'same-origin' });
    return res.ok ? ((await res.json()) as T) : undefined;
  } catch {
    return undefined;
  }
}

/** A failed POST toasts why and comes back undefined, except a stale review (409 { stale }), handed back to re-review. */
async function post<T>(body: object): Promise<T | { stale: string } | undefined> {
  try {
    const res = await fetch('/api/acceptance', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...body, by: myName() }) });
    const data = await res.json().catch(() => null);
    if (res.status === 409 && data?.stale === true) return { stale: String(data.error ?? 'The evidence changed: review it again') };
    if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);
    return data as T;
  } catch (err) {
    toast((err as Error).message, 'warn');
    return undefined;
  }
}

const q = (floor: string, more: Record<string, string> = {}) => new URLSearchParams({ floor, ...more }).toString();

export const getProgress = (floor: string, mini = false) => get<ProjectProgress>(`/api/progress?${q(floor, mini ? { mini: '1' } : {})}`);
export const getAcceptance = (floor: string) => get<AcceptanceView>(`/api/acceptance?${q(floor)}`);
export const getDraft = (floor: string) => get<AcceptanceDraft>(`/api/acceptance/draft?${q(floor)}`);

export interface AcceptInput {
  reviewToken: string;
  version: string;
  scopeNote?: string;
  exceptions: Exception[];
  build?: string;
  deploy?: string;
}

export const postAccept = (floor: string, a: AcceptInput) => post<{ record: AcceptanceRecord }>({ floor, action: 'accept', confirm: true, ...a });
export const postReopen = (floor: string, version: string, scopeNote: string) => post<{ reopen: Reopen }>({ floor, action: 'reopen', version, scopeNote }) as Promise<{ reopen: Reopen } | undefined>;
