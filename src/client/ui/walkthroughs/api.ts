// What the Walkthroughs page and the Live app tab's link ask the office (server/walkthroughs/, the routes in
// http/routes/walkthroughs.ts): the project's view, a recording's files, an admin's actions. And the way to
// the 🎬 Walkthroughs page from elsewhere on the 1D view, optionally opening one recording's player there.

import type { WalkCardRecording, WalkView } from '../../../shared/walkthroughs/types';
import { toast } from '../dom';

export const fileUrl = (floor: string, id: string, name: string) => `/api/walkthroughs/file?floor=${encodeURIComponent(floor)}&id=${encodeURIComponent(id)}&name=${encodeURIComponent(name)}`;

export async function loadView(floor: string): Promise<WalkView | undefined> {
  try {
    const res = await fetch(`/api/walkthroughs?floor=${encodeURIComponent(floor)}`, { credentials: 'same-origin' });
    return res.ok ? ((await res.json()) as WalkView) : undefined;
  } catch {
    return undefined;
  }
}

export async function act(body: Record<string, unknown>): Promise<Record<string, unknown> | undefined> {
  try {
    const res = await fetch('/api/walkthroughs/action', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const out = (await res.json().catch(() => ({}))) as Record<string, unknown> & { error?: string };
    if (!res.ok) {
      toast(out.error ?? `HTTP ${res.status}`, 'warn');
      return undefined;
    }
    return out;
  } catch (err) {
    toast((err as Error).message, 'warn');
    return undefined;
  }
}

let pending: string | undefined;

/** The recording the page should open its player on when it shows next (taken once). */
export const takePending = (): string | undefined => {
  const p = pending;
  pending = undefined;
  return p;
};

/** Shows the 🎬 Walkthroughs page (its tab-row button, which every theme has in the page), and opens `rec`'s player there. */
export function openWalkthroughs(rec?: WalkCardRecording['id']) {
  pending = rec;
  const btn = document.getElementById('tab-walkthroughs');
  if (btn) btn.click();
  else location.href = `/lite?tab=walkthroughs`;
}
