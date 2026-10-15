// The floor's answered decisions still being followed through (GET /api/followthrough, server/followthrough/):
// fetched for a floor when the browser is idle after it's first shown (never inside a project switch),
// again when the audit log says a record, an answer or a Send changed (followthrough.*, questions.*,
// escalation.answer), and every few minutes. Each floor's last answer is kept, so switching back fetches
// nothing, and a fetch that changes nothing to draw redraws nothing. One request per floor: the Needs you
// card (./card.ts) and the Questions page read the same copy, never a fetch per card.

import type { FollowAction, FollowView } from '../../../shared/followthrough';
import type { ServerMsg } from '../../../shared/protocol';
import { toast } from '../dom';

const POLL_MS = 5 * 60_000;
/** How long after a floor is shown its first fetch may wait for an idle moment. */
const IDLE_MS = 2_000;
const views = new Map<string, FollowView>();
let asked: string | undefined;
let timer: ReturnType<typeof setTimeout> | undefined;
let polling = false;
const subs = new Set<() => void>();

const drawn = (v: FollowView | undefined) => !!v && v.items.length > 0;
const tell = (floor: string, had: FollowView | undefined, next: FollowView) => {
  if (floor === asked && (drawn(had) || drawn(next))) for (const fn of subs) fn();
};

async function refresh(floor: string) {
  try {
    const res = await fetch(`/api/followthrough?floor=${encodeURIComponent(floor)}`, { credentials: 'same-origin' });
    if (!res.ok) return;
    const next = (await res.json()) as FollowView;
    const had = views.get(floor);
    if (had && JSON.stringify(next) === JSON.stringify(had)) return;
    views.set(floor, next);
    tell(floor, had, next);
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
    (t as { unref?: () => void }).unref?.();
  }
}

/** The floor's follow-through as last fetched (the first call for a floor starts fetching). */
export function followView(floor: string | null | undefined): FollowView | undefined {
  follow(floor);
  return floor ? views.get(floor) : undefined;
}

export function onFollowChanged(fn: () => void): () => void {
  subs.add(fn);
  return () => subs.delete(fn);
}

/** Accept as recorded, Send correction or Dismiss (admins only; the server checks too): true when done. */
export async function followAct(floor: string, decision: string, action: FollowAction, expectedRev: number): Promise<boolean> {
  try {
    const res = await fetch('/api/followthrough/action', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ floor, decision, action, expectedRev }) });
    const out = (await res.json().catch(() => ({}))) as Partial<FollowView> & { error?: string; note?: string };
    if (!res.ok) {
      toast(out.error ?? 'The office could not do that just now', 'warn');
      if (res.status === 409) void refresh(floor);
      return false;
    }
    if (out.note) toast(out.note);
    if (out.floor && out.items) {
      const had = views.get(out.floor);
      const next = { floor: out.floor, admin: !!out.admin, items: out.items };
      views.set(out.floor, next);
      tell(out.floor, had, next);
    }
    return true;
  } catch {
    toast('The office could not be reached', 'warn');
    return false;
  }
}

const WATCH = /^(followthrough\.|questions\.(sent|recorded|answer)|escalation\.answer|dispatch\.)/;

/** Every message from the office: fetched again when the audit log says something it shows changed. */
export function followFeedMessage(msg: ServerMsg) {
  if (msg.t !== 'audit.new' || !WATCH.test(msg.event.action)) return;
  const f = msg.event.floor ?? msg.floor;
  if (!f) return;
  // Another floor's change: forget its view, so it's fetched when that floor is next shown.
  if (f !== asked) return void views.delete(f);
  clearTimeout(timer);
  timer = setTimeout(() => void refresh(f), 400);
}
