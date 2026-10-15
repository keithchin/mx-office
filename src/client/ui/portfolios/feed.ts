// The project's company brain cards for Needs you (server/portfolios/), from GET /api/portfolios/changes:
// fetched for the floor on first use, again whenever the audit log says a portfolio.* event happened on
// it, and every five minutes in case a message was missed (the idle-fetch + per-project cache pattern of
// ui/dispatch/feed.ts). A card's buttons post to /api/portfolios/card.

import type { BrainChangeView, BrainAct } from '../../../shared/portfolios';
import type { ServerMsg } from '../../../shared/protocol';

const POLL_MS = 5 * 60_000;

let view: BrainChangeView | undefined;
let asked: string | undefined;
let timer: ReturnType<typeof setTimeout> | undefined;
let polling = false;
const subs = new Set<() => void>();
const changed = () => {
  for (const fn of subs) fn();
};

async function refresh(floor: string) {
  try {
    const res = await fetch(`/api/portfolios/changes?floor=${encodeURIComponent(floor)}`, { credentials: 'same-origin' });
    if (!res.ok || floor !== asked) return;
    const next = (await res.json()) as BrainChangeView;
    if (JSON.stringify(next) === JSON.stringify(view)) return;
    view = next;
    changed();
  } catch {
    // Next time.
  }
}

function refreshSoon() {
  clearTimeout(timer);
  const f = asked;
  if (f) timer = setTimeout(() => void refresh(f), 300);
}

/** The floor's brain cards as last fetched (the first call for a floor starts fetching). */
export function brainNeed(floor: string | null | undefined): BrainChangeView | undefined {
  if (!floor || typeof fetch !== 'function') return undefined;
  if (floor !== asked) {
    asked = floor;
    view = undefined;
    void refresh(floor);
    if (!polling) {
      polling = true;
      setInterval(() => asked && !document.hidden && void refresh(asked), POLL_MS);
    }
  }
  return view && view.floor === floor && (view.change || view.wiring) ? view : undefined;
}

export function onBrainChanged(fn: () => void): () => void {
  subs.add(fn);
  return () => subs.delete(fn);
}

/** Every message from the office: a portfolio event on this floor means its cards may have changed. */
export function brainFeedMessage(msg: ServerMsg) {
  if (asked && msg.t === 'audit.new' && msg.event.action.startsWith('portfolio.') && (msg.floor === asked || msg.event.floor === asked)) refreshSoon();
}

/** A card's button (admins): Rehire for a fresh session, Dismiss, Wire again. Says why not, if it couldn't. */
export async function brainAct(floor: string, act: BrainAct): Promise<string | undefined> {
  try {
    const res = await fetch('/api/portfolios/card', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ floor, act }) });
    const out = (await res.json().catch(() => ({}))) as BrainChangeView & { error?: string };
    if (!res.ok) return out.error ?? `HTTP ${res.status}`;
    if (floor === asked) {
      view = out;
      changed();
    }
    return undefined;
  } catch (err) {
    return (err as Error).message;
  }
}
