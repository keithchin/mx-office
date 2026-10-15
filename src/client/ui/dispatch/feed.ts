// The floor's answers whose outcome the office couldn't establish (GET /api/dispatch, server/dispatch/):
// fetched for the floor on first use, again when the audit log says a dispatch changed ({t:'audit.new'}
// with dispatch.*), and every few minutes. One small view per floor; the Overview's Needs you card draws
// it (./card.ts). The office never re-sends one of these by itself: a person settles each.

import type { DispatchView } from '../../../shared/dispatch';
import type { ServerMsg } from '../../../shared/protocol';

const POLL_MS = 5 * 60_000;
let view: DispatchView | undefined;
let asked: string | undefined;
let timer: ReturnType<typeof setTimeout> | undefined;
let polling = false;
const subs = new Set<() => void>();

async function refresh(floor: string) {
  try {
    const res = await fetch(`/api/dispatch?floor=${encodeURIComponent(floor)}`, { credentials: 'same-origin' });
    if (!res.ok || floor !== asked) return;
    const next = (await res.json()) as DispatchView;
    if (JSON.stringify(next) === JSON.stringify(view)) return;
    setDispatchView(next);
  } catch {
    // Next time.
  }
}

function follow(floor: string | null | undefined) {
  if (!floor || typeof fetch !== 'function' || floor === asked) return;
  asked = floor;
  view = undefined;
  void refresh(floor);
  if (!polling) {
    polling = true;
    setInterval(() => asked && void refresh(asked), POLL_MS);
  }
}

/** The floor's dispatches a person must settle, as last fetched (the first call for a floor starts fetching). */
export function dispatchUnknown(floor: string | null | undefined): DispatchView | undefined {
  follow(floor);
  return view && view.floor === floor ? view : undefined;
}

/** Replaces the view with what an action answered. */
export function setDispatchView(v: DispatchView) {
  if (asked && v.floor !== asked) return;
  view = v;
  for (const fn of subs) fn();
}

export function onDispatchChanged(fn: () => void): () => void {
  subs.add(fn);
  return () => subs.delete(fn);
}

/** Every message from the office: fetched again when the audit log says a dispatch changed. */
export function dispatchFeedMessage(msg: ServerMsg) {
  if (!asked || msg.t !== 'audit.new' || !msg.event.action.startsWith('dispatch.') || (msg.floor !== asked && msg.event.floor !== asked)) return;
  clearTimeout(timer);
  const f = asked;
  timer = setTimeout(() => void refresh(f), 300);
}
