// The design-system routes (server/design/, http/routes/design.ts) for the pages: the Clients page's Design
// system part, the wizard's design line, the Design gallery tab and its Needs-you card.

import type { ClientDesignView, DesignChoicesView, DesignNeedView, ProjectDesignView } from '../../../shared/design/views';

async function get<T>(url: string): Promise<T> {
  const res = await fetch(url, { credentials: 'same-origin' });
  const out = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(out.error ?? `HTTP ${res.status}`);
  return out;
}

export const designApi = {
  client: (client: string) => get<ClientDesignView>(`/api/design?client=${encodeURIComponent(client)}`),
  project: (floor: string) => get<ProjectDesignView>(`/api/design?floor=${encodeURIComponent(floor)}`),
  choices: (client: string) => get<DesignChoicesView>(`/api/design/choices?client=${encodeURIComponent(client)}`),
  needs: (floor: string) => get<DesignNeedView>(`/api/design/needs?floor=${encodeURIComponent(floor)}`),
  /** An action; the error in words, or undefined when it worked (with what it answered). */
  async act(body: Record<string, unknown>): Promise<{ error?: string; out?: Record<string, unknown> }> {
    try {
      const res = await fetch('/api/design/action', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      const out = (await res.json().catch(() => ({}))) as Record<string, unknown> & { error?: string };
      return res.ok ? { out } : { error: out.error ?? `HTTP ${res.status}` };
    } catch (err) {
      return { error: (err as Error).message };
    }
  },
  fileUrl: (system: string, n: number, file: string) => `/api/design/file?system=${encodeURIComponent(system)}&n=${n}&file=${encodeURIComponent(file)}`,
  captureUrl: (floor: string, id: string) => `/api/design/file?floor=${encodeURIComponent(floor)}&capture=${encodeURIComponent(id)}`,
};
