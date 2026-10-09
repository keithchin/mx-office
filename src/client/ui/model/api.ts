// The Model tab's requests (server: http/routes/model.ts). Each answer is per commit on the server,
// so asking again is cheap; a newer request of the same kind makes the page ignore an older one.

import type { ModelChanges, ModelDocResponse, ModelRefs, ModelTree } from '../../../shared/model';

async function get<T>(path: string, q: Record<string, string | undefined>, signal?: AbortSignal): Promise<T> {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) if (v) params.set(k, v);
  const res = await fetch(`${path}?${params.toString()}`, { credentials: 'same-origin', signal });
  const body = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(body.error || `${res.status} ${res.statusText}`);
  return body;
}

export const modelApi = {
  refs: (floor: string, signal?: AbortSignal) => get<ModelRefs>('/api/model/refs', { floor }, signal),
  tree: (floor: string, ref: string, signal?: AbortSignal) => get<ModelTree>('/api/model/tree', { floor, ref }, signal),
  doc: (floor: string, ref: string, type: string, name: string, compare: boolean, signal?: AbortSignal) =>
    get<ModelDocResponse>('/api/model/doc', { floor, ref, type, name, compare: compare ? '1' : undefined }, signal),
  changes: (floor: string, ref: string, signal?: AbortSignal) => get<ModelChanges>('/api/model/changes', { floor, ref }, signal),
};
