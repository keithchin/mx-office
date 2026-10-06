// ▶ Resume / ⏸ Pause project and 🔁 Restart safely: what the page asks the office (server
// http/routes/project-run.ts). Every call says why it failed in a toast and comes back undefined.

import type { Pacing, ProjectRunView, RestartView, ResumeChoice, ResumePreview, RunProgress } from '../../../shared/project-run';
import { toast } from '../dom';

/** Your name as this browser has it, for the record (an account's name wins on the server). */
export function myName(): string | undefined {
  try {
    return JSON.parse(localStorage.getItem('agent-office.profile') ?? 'null')?.name;
  } catch {
    return undefined;
  }
}

async function call<T>(url: string, body?: unknown, quiet = false): Promise<T | undefined> {
  try {
    const res = await fetch(url, body === undefined ? { credentials: 'same-origin' } : { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...(body as object), by: myName() }) });
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);
    return data as T;
  } catch (err) {
    if (!quiet) toast((err as Error).message, 'warn');
    return undefined;
  }
}

const q = (floor: string) => `floor=${encodeURIComponent(floor)}`;

export const runView = (floor: string) => call<ProjectRunView>(`/api/project-run?${q(floor)}`, undefined, true);
export const runPreview = (floor: string) => call<ResumePreview>(`/api/project-run/preview?${q(floor)}`);
export const startResume = (floor: string, choice: ResumeChoice) => call<RunProgress>('/api/project-run', { floor, action: 'resume', choice });
export const startPause = (floor: string) => call<RunProgress>('/api/project-run', { floor, action: 'pause' });
export const runAction = (floor: string, action: 'cancel' | 'hold' | 'continue') => call<unknown>('/api/project-run', { floor, action });
export const savePacing = (floor: string, pacing: Pacing) => call<Pacing>('/api/project-run', { floor, action: 'pacing', pacing });
export const allFloors = (action: 'resume' | 'pause') => call<{ floors: Record<string, RunProgress | string> }>('/api/project-run', { all: true, action, choice: { mode: 'work' } });
export const restartView = () => call<RestartView>('/api/office/restart', undefined, true);
export const restartAction = (action: 'start' | 'wait' | 'anyway' | 'cancel', opts: { build?: boolean; timeoutMin?: number } = {}) => call<RestartView>('/api/office/restart', { action, ...opts });
