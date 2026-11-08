// Expert mode's calls (server/http/routes/expert.ts): the session screen's header and loop timer, the
// preview's pages and roles, starting the session, checking and opening a folder; and the background proof strip's
// source, which another module answers (GET /api/expert/proof): until it does, a 404 says "coming soon".

import type { ExpertView, PreviewChoices } from '../../../shared/expert';
import type { ExpertProof } from '../../../shared/expert-proof';
import type { ReadyFixId, ReadyReport } from '../../../shared/expert-ready';

const q = (floor: string) => `floor=${encodeURIComponent(floor)}`;

async function getJson<T>(url: string): Promise<T | undefined> {
  try {
    const res = await fetch(url, { credentials: 'same-origin' });
    return res.ok ? ((await res.json()) as T) : undefined;
  } catch {
    return undefined;
  }
}

async function post<T>(url: string, body: unknown): Promise<T | { error: string }> {
  try {
    const res = await fetch(url, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const out = (await res.json().catch(() => ({}))) as T & { error?: string };
    return res.ok ? out : { error: out.error ?? `HTTP ${res.status}` };
  } catch (err) {
    return { error: (err as Error).message };
  }
}

export const getExpert = (floor: string) => getJson<ExpertView>(`/api/expert?${q(floor)}`);
export const getChoices = (floor: string, rev: string) => getJson<PreviewChoices>(`/api/expert/choices?${q(floor)}&rev=${encodeURIComponent(rev)}`);
export const startSession = (floor: string) => post<{ workerId: string }>('/api/expert/session', { floor });
export const openFolder = (path: string) => post<{ floor: string }>('/api/expert/open', { path });
/** The readiness check of a folder (cached a minute; `fresh` is Check again). */
export const checkReady = (path: string, fresh = false) => post<ReadyReport>('/api/expert/ready', { path, fresh });
/** One readiness fix, clicked by the person. */
export const fixReady = (path: string, fix: ReadyFixId, more: { total?: number; projectId?: string; name?: string } = {}) => post<{ message: string; report: ReadyReport }>('/api/expert/ready/fix', { path, fix, ...more });

/** The proof strip's answer: the proof, 'missing' while no module answers the route, or undefined when it couldn't be read. */
export async function getProof(floor: string): Promise<ExpertProof | 'missing' | undefined> {
  try {
    const res = await fetch(`/api/expert/proof?${q(floor)}`, { credentials: 'same-origin' });
    if (res.status === 404) return 'missing';
    return res.ok ? ((await res.json()) as ExpertProof) : undefined;
  } catch {
    return undefined;
  }
}

/** "Send to session": fills the session's input with `text`, never submitting it (server/expert-checks/send.ts). */
export const sendToSession = (floor: string, text: string) => post<{ ok: true }>('/api/expert/send', { floor, text });
