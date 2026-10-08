// The Toolkit line's and Update toolkit's calls (server http/routes/toolkit.ts). A failed GET comes back
// undefined (the line keeps what it had); a failed POST says why in a toast.

import type { ToolkitJobView, ToolkitStatus } from '../../../shared/toolkit';
import { myName } from '../project-run/api';
import { toast } from '../dom';

const q = (floor: string) => `floor=${encodeURIComponent(floor)}`;

async function get<T>(url: string): Promise<T | undefined> {
  try {
    const res = await fetch(url, { credentials: 'same-origin' });
    return res.ok ? ((await res.json()) as T) : undefined;
  } catch {
    return undefined;
  }
}

async function post<T>(url: string, body: object = {}): Promise<T | undefined> {
  try {
    const res = await fetch(url, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...body, by: myName() }) });
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);
    return data as T;
  } catch (err) {
    toast((err as Error).message, 'warn');
    return undefined;
  }
}

export const getToolkit = (floor: string) => get<ToolkitStatus>(`/api/toolkit?${q(floor)}`);
export const getToolkitJob = (id: string) => get<ToolkitJobView>(`/api/toolkit/job?id=${encodeURIComponent(id)}`);
export const checkToolkit = (floor: string) => post<{ fetching: boolean }>(`/api/toolkit/check?${q(floor)}`);
export const previewToolkit = (floor: string, to: string) => post<ToolkitJobView>(`/api/toolkit/preview?${q(floor)}`, { to });
export const applyToolkit = (floor: string, to: string) => post<ToolkitJobView>(`/api/toolkit/apply?${q(floor)}`, { to });
