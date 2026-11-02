// The Roadmap's calls (server/http/routes/phases.ts): the view (GET /api/phases; `lite` for the Overview's
// strip, which a project without phases answers without reading git) and the Project Manager's actions (POST).

import type { PhasesView } from '../../../shared/phases/view';
import { toast } from '../dom';

export type LiteView = Pick<PhasesView, 'floor' | 'admin' | 'now' | 'plan' | 'phases' | 'proposals' | 'changes'> & { lite: true };

export async function getPhases(floor: string, lite = false): Promise<PhasesView | LiteView | undefined> {
  try {
    const res = await fetch(`/api/phases?floor=${encodeURIComponent(floor)}${lite ? '&lite=1' : ''}`, { credentials: 'same-origin' });
    return res.ok ? ((await res.json()) as PhasesView | LiteView) : undefined;
  } catch {
    return undefined;
  }
}

export const isFull = (v: PhasesView | LiteView | undefined): v is PhasesView => !!v && !('lite' in v);

/** A Project Manager's action; the answer, or undefined after saying why it was refused. */
export async function actOnPhases(body: Record<string, unknown>, quiet = false): Promise<{ ok: true; change?: string; proposal?: string; note?: string } | { ok: false; error: string }> {
  try {
    const res = await fetch('/api/phases', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const out = (await res.json().catch(() => ({}))) as { error?: string; change?: string; proposal?: string; note?: string };
    if (!res.ok) {
      const error = out.error ?? `HTTP ${res.status}`;
      if (!quiet) toast(error, 'warn');
      return { ok: false, error };
    }
    return { ok: true, ...out };
  } catch (err) {
    if (!quiet) toast((err as Error).message, 'warn');
    return { ok: false, error: (err as Error).message };
  }
}

/** The phase to select when the Roadmap shows next (the Overview strip's chips set it). */
export const pick: { phase?: string } = {};
