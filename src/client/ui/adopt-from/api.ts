// Start from another app's calls (server/http/routes/adopt-from.ts): the apps a new project of a client can start
// from, and what a project adopted. Each list is asked once per client (and per "other clients too") and kept for
// the page's life: the wizard redraws often and must not ask the office each time.

import type { AdoptRecord, AdoptSourcesView } from '../../../shared/adopt-from';

async function get<T>(url: string): Promise<T> {
  const res = await fetch(url, { credentials: 'same-origin' });
  const out = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(out.error ?? `HTTP ${res.status}`);
  return out;
}

const lists = new Map<string, Promise<AdoptSourcesView>>();

export const adoptApi = {
  sources(client: string, all = false): Promise<AdoptSourcesView> {
    const key = `${client}|${all ? 1 : 0}`;
    let p = lists.get(key);
    if (!p) {
      p = get<AdoptSourcesView>(`/api/adopt-from/sources?client=${encodeURIComponent(client)}${all ? '&all=1' : ''}`);
      p.catch(() => lists.delete(key));
      lists.set(key, p);
    }
    return p;
  },
  record: (floor: string) => get<{ record: AdoptRecord | null }>(`/api/adopt-from/record?floor=${encodeURIComponent(floor)}`).then((r) => r.record ?? undefined),
};
