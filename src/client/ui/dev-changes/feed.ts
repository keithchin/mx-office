// The page's one feed of Developer changes (GET /api/dev-changes, server/dev-changes/): the project's changes with
// their state and the revision strip. The Developer view (app-workspace/data.ts) and Project Management's
// Approvals (./pm.ts) read the same answer, never a copy. Asked when someone wants it and again when something it
// hangs on moved (the callers say when: the PR list, the team, the business status, the live app's served
// revision): moves together are one ask, one ask is in flight at a time. No timer of its own.

import type { DevChange, DevChangesView } from '../../../shared/dev-changes';

type Mine = { floor: string; v?: DevChangesView; asking?: boolean; dirty?: boolean };

let mine: Mine | undefined;
let queued = false;
const subs = new Set<() => void>();
const emit = () => subs.forEach((fn) => fn());

function ask(floor: string) {
  const cur = mine?.floor === floor ? mine : (mine = { floor });
  if (cur.asking) return void (cur.dirty = true);
  cur.asking = true;
  void fetch(`/api/dev-changes?floor=${encodeURIComponent(floor)}`, { credentials: 'same-origin' })
    .then((r) => (r.ok ? (r.json() as Promise<DevChangesView>) : undefined))
    .catch(() => undefined)
    .then((v) => {
      cur.asking = false;
      if (mine !== cur) return;
      if (v) cur.v = v;
      emit();
      if (cur.dirty) {
        cur.dirty = false;
        ask(floor);
      }
    });
}

export const devFeed = {
  /** Shows this project: asks once if it isn't known yet. */
  want(floor: string | null) {
    if (floor && (mine?.floor !== floor || (!mine.v && !mine.asking))) ask(floor);
  },
  /** Something it hangs on moved: asks again for the project it holds (a burst is one ask). */
  again(floor: string | null) {
    if (!floor || mine?.floor !== floor || queued) return;
    queued = true;
    queueMicrotask(() => ((queued = false), ask(floor)));
  },
  /** Now (after a change was made or cancelled). */
  now: (floor: string) => ask(floor),
  get: (floor: string | null): DevChangesView | undefined => (floor && mine?.floor === floor ? mine.v : undefined),
  /** Calls `fn` on every answer; gives back the way to stop. */
  on(fn: () => void): () => void {
    subs.add(fn);
    return () => void subs.delete(fn);
  },
  /** Tests: forget everything. */
  reset() {
    mine = undefined;
    subs.clear();
  },
};

/** A fresh idempotency key for one request dialog: a retry of the same request sends the same key. */
export function draftKey(): string {
  const c = globalThis.crypto as Crypto | undefined;
  return c?.randomUUID ? c.randomUUID().replace(/-/g, '') : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
}

export type CancelSent = { ok: true; change: DevChange } | { ok: false; error: string };

/** The lifecycle's actions on one change (http/routes/dev-changes.ts). */
export type ChangeAct = 'cancel' | 'supersede' | 'retry' | 'link';

/** POST /api/dev-changes/cancel: the change as it stands after, or why not. */
export const cancelChange = (floor: string, id: string) => changeAct('cancel', { floor, id });

/** POST /api/dev-changes/<act>: the change as it stands after, or why not; the feed asks again on success. */
export async function changeAct(act: ChangeAct, body: { floor: string; id: string; sha?: string; verdict?: 'confirmed' | 'dismissed' }): Promise<CancelSent> {
  const floor = body.floor;
  try {
    const res = await fetch(`/api/dev-changes/${act}`, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const out = (await res.json().catch(() => ({}))) as { error?: string; change?: DevChange };
    if (res.ok && out.change) {
      devFeed.now(floor);
      return { ok: true, change: out.change };
    }
    return { ok: false, error: out.error ?? 'The office couldn’t do that just now. Try again.' };
  } catch {
    return { ok: false, error: 'The office couldn’t be reached. Try again.' };
  }
}
