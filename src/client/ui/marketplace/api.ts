// The Marketplace action's routes (server/marketplace/, http/routes/marketplace.ts) for the Needs-you card:
// the project's requests, and the PM's buttons (Download and add, a package file by upload or by path, Decline).

import type { MarketplaceRequest, MarketplaceView } from '../../../shared/marketplace';

export type ActResult = { ok: true; request: MarketplaceRequest; view: MarketplaceView } | { ok: false; error: string };

async function answer(res: Response): Promise<ActResult> {
  const out = (await res.json().catch(() => ({}))) as { error?: string; request?: MarketplaceRequest; view?: MarketplaceView };
  return res.ok && out.request && out.view ? { ok: true, request: out.request, view: out.view } : { ok: false, error: out.error ?? `The office said no (${res.status})` };
}

const offline = (err: unknown): ActResult => ({ ok: false, error: `The office could not be reached (${(err as Error).message})` });

export const marketplaceApi = {
  async view(floor: string): Promise<MarketplaceView> {
    const res = await fetch(`/api/marketplace?floor=${encodeURIComponent(floor)}`, { credentials: 'same-origin' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as MarketplaceView;
  },
  async act(floor: string, rid: string, action: 'approve' | 'decline' | 'path', extra: { words?: string; path?: string } = {}): Promise<ActResult> {
    try {
      return await answer(await fetch('/api/marketplace/action', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ floor, rid, action, ...extra }) }));
    } catch (err) {
      return offline(err);
    }
  },
  async upload(floor: string, rid: string, file: File): Promise<ActResult> {
    try {
      const q = new URLSearchParams({ floor, rid, name: file.name });
      return await answer(await fetch(`/api/marketplace/upload?${q}`, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/octet-stream' }, body: file }));
    } catch (err) {
      return offline(err);
    }
  },
};
