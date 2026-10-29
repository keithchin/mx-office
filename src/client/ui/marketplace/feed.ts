// The project's Marketplace requests for Needs you (server/marketplace/), from GET /api/marketplace: fetched for
// the floor on first use and again whenever the audit log says a marketplace.* event happened on it (a request,
// added, declined, failed). No polling.

import { marketplaceOpen, type MarketplaceView } from '../../../shared/marketplace';
import type { ServerMsg } from '../../../shared/protocol';
import { marketplaceApi } from './api';

let view: MarketplaceView | undefined;
let asked: string | undefined;
let timer: ReturnType<typeof setTimeout> | undefined;
const subs = new Set<() => void>();

async function refresh(floor: string) {
  try {
    const next = await marketplaceApi.view(floor);
    if (floor !== asked || JSON.stringify(next) === JSON.stringify(view)) return;
    view = next;
    for (const fn of subs) fn();
  } catch {
    // Next event.
  }
}

/** The floor's requests as last fetched (the first call for a floor starts fetching); undefined when none waits. */
export function marketplaceNeed(floor: string | null | undefined): MarketplaceView | undefined {
  if (!floor || typeof fetch !== 'function') return undefined;
  if (floor !== asked) {
    asked = floor;
    view = undefined;
    void refresh(floor);
  }
  return view && view.floor === floor && view.requests.some((r) => marketplaceOpen(r.status)) ? view : undefined;
}

export function onMarketplaceChanged(fn: () => void): () => void {
  subs.add(fn);
  return () => subs.delete(fn);
}

/** Takes the view a button's answer carried, so the card changes at once. */
export function setMarketplaceView(v: MarketplaceView) {
  if (v.floor !== asked) return;
  view = v;
  for (const fn of subs) fn();
}

/** Every message from the office: a marketplace event on this floor means its cards may have changed. */
export function marketplaceFeedMessage(msg: ServerMsg) {
  if (!asked || msg.t !== 'audit.new' || !msg.event.action.startsWith('marketplace.') || (msg.floor !== asked && msg.event.floor !== asked)) return;
  clearTimeout(timer);
  const f = asked;
  timer = setTimeout(() => void refresh(f), 300);
}
