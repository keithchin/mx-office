// The floor's stuck items for Needs you (the Command Center's strip, the team phone, the Overview), from
// GET /api/stuck: fetched for the floor on first use, again whenever the audit log says a stuck item
// changed ({t:'audit.new'} with a stuck.* action, server/stuck/service.ts), and every few minutes in
// case a message was missed.

import type { StuckNeed } from '../../../shared/needsyou';
import type { ServerMsg } from '../../../shared/protocol';
import type { StuckFloorView } from '../../../shared/stuck';

const POLL_MS = 5 * 60_000;

let view: StuckFloorView | undefined;
let asked: string | undefined;
let timer: ReturnType<typeof setTimeout> | undefined;
let polling = false;
const subs = new Set<() => void>();

async function refresh(floor: string) {
  try {
    const res = await fetch(`/api/stuck?floor=${encodeURIComponent(floor)}`, { credentials: 'same-origin' });
    if (!res.ok || floor !== asked) return;
    const next = (await res.json()) as StuckFloorView;
    if (JSON.stringify(next) === JSON.stringify(view)) return;
    view = next;
    for (const fn of subs) fn();
  } catch {
    // Next time.
  }
}

/** Looks again soon (several changes at once are one look). */
export function refreshStuck() {
  clearTimeout(timer);
  const f = asked;
  if (f) timer = setTimeout(() => void refresh(f), 300);
}

/** The floor's stuck items as last fetched, for collectNeeds (the first call for a floor starts fetching). */
export function stuckNeed(floor: string | null | undefined): StuckNeed | undefined {
  if (!floor || typeof fetch !== 'function') return undefined;
  if (floor !== asked) {
    asked = floor;
    view = undefined;
    void refresh(floor);
    if (!polling) {
      polling = true;
      setInterval(() => asked && void refresh(asked), POLL_MS);
    }
  }
  return view && view.floor === floor && view.items.length ? { floor, items: view.items } : undefined;
}

/** The whole view (the lead's state, whether you may act), for the item's card. */
export const stuckView = (): StuckFloorView | undefined => view;

/** Replaces the view with what an action answered. */
export function setStuckView(v: StuckFloorView) {
  if (v.floor !== asked) return;
  view = v;
  for (const fn of subs) fn();
}

export function onStuckChanged(fn: () => void): () => void {
  subs.add(fn);
  return () => subs.delete(fn);
}

/** Every message from the office: a stuck item changed when the audit log says so. */
export function stuckFeedMessage(msg: ServerMsg) {
  if (asked && msg.t === 'audit.new' && msg.event.action.startsWith('stuck.') && (msg.floor === asked || msg.event.floor === asked)) refreshStuck();
}
