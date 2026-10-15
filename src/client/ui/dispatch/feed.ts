// The floor's answers whose outcome the office couldn't establish (GET /api/dispatch, server/dispatch/):
// fetched for a floor when the browser is idle after it's first shown (never inside a project switch),
// again when the audit log says a dispatch changed ({t:'audit.new'} with dispatch.*), and every few
// minutes. Each floor's last answer is kept, so switching back fetches nothing, and a fetch that changes
// nothing to draw (none before, none now: the usual case) redraws nothing. The Overview's Needs you card
// draws it (./card.ts). The office never re-sends one of these by itself: a person settles each.

import type { DispatchView } from '../../../shared/dispatch';
import type { ServerMsg } from '../../../shared/protocol';

const POLL_MS = 5 * 60_000;
/** How long after a floor is shown its first fetch may wait for an idle moment. */
const IDLE_MS = 2_000;
const views = new Map<string, DispatchView>();
let asked: string | undefined;
let timer: ReturnType<typeof setTimeout> | undefined;
let polling = false;
const subs = new Set<() => void>();

const drawn = (v: DispatchView | undefined) => !!v && v.unsettled.length > 0;

async function refresh(floor: string) {
  try {
    const res = await fetch(`/api/dispatch?floor=${encodeURIComponent(floor)}`, { credentials: 'same-origin' });
    if (!res.ok) return;
    const next = (await res.json()) as DispatchView;
    const had = views.get(floor);
    if (had && JSON.stringify(next) === JSON.stringify(had)) return;
    views.set(floor, next);
    // Nothing to draw before or after (the usual case): the Needs you card isn't redrawn.
    if (floor === asked && (drawn(had) || drawn(next))) for (const fn of subs) fn();
  } catch {
    // Next time.
  }
}

/** Runs `fn` when the browser is idle, or after IDLE_MS at the latest. */
function whenIdle(fn: () => void) {
  const ric = (globalThis as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => unknown }).requestIdleCallback;
  if (ric) ric(fn, { timeout: IDLE_MS });
  else {
    const t = setTimeout(fn, 0);
    (t as { unref?: () => void }).unref?.();
  }
}

function follow(floor: string | null | undefined) {
  if (!floor || typeof fetch !== 'function' || typeof location === 'undefined' || floor === asked) return;
  asked = floor;
  // A floor seen before is drawn from what it last said; its next look is the audit event or the poll.
  if (!views.has(floor)) whenIdle(() => asked === floor && void refresh(floor));
  if (!polling) {
    polling = true;
    const t = setInterval(() => asked && void refresh(asked), POLL_MS);
    // Never what keeps a process alive (a test's DOM in Node).
    (t as { unref?: () => void }).unref?.();
  }
}

/** The floor's dispatches a person must settle, as last fetched (the first call for a floor starts fetching). */
export function dispatchUnknown(floor: string | null | undefined): DispatchView | undefined {
  follow(floor);
  return floor ? views.get(floor) : undefined;
}

/** Replaces a floor's view with what an action answered. */
export function setDispatchView(v: DispatchView) {
  const had = views.get(v.floor);
  views.set(v.floor, v);
  if (v.floor === asked && (drawn(had) || drawn(v))) for (const fn of subs) fn();
}

export function onDispatchChanged(fn: () => void): () => void {
  subs.add(fn);
  return () => subs.delete(fn);
}

/** Every message from the office: fetched again when the audit log says a dispatch changed. */
export function dispatchFeedMessage(msg: ServerMsg) {
  if (msg.t !== 'audit.new' || !msg.event.action.startsWith('dispatch.')) return;
  const f = msg.event.floor ?? msg.floor;
  if (!f) return;
  // Another floor's change: forget its view, so it's fetched when that floor is next shown.
  if (f !== asked) return void views.delete(f);
  clearTimeout(timer);
  timer = setTimeout(() => void refresh(f), 300);
}
