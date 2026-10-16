// The project's design-system ✋ card for Needs you (server/design/), from GET /api/design/needs: fetched for
// the floor on first use and again whenever the audit log says a design.* event happened on it. No polling: a
// proposal only appears through such an event (the wizard's step or Propose adoption).

import type { DesignNeedView } from '../../../shared/design/views';
import type { ServerMsg } from '../../../shared/protocol';
import { designApi } from './api';

let view: DesignNeedView | undefined;
let asked: string | undefined;
let timer: ReturnType<typeof setTimeout> | undefined;
const subs = new Set<() => void>();

async function refresh(floor: string) {
  try {
    const next = await designApi.needs(floor);
    if (floor !== asked || JSON.stringify(next) === JSON.stringify(view)) return;
    view = next;
    for (const fn of subs) fn();
  } catch {
    // Next event.
  }
}

/** The floor's design card as last fetched (the first call for a floor starts fetching). */
export function designNeed(floor: string | null | undefined): DesignNeedView | undefined {
  if (!floor || typeof fetch !== 'function') return undefined;
  if (floor !== asked) {
    asked = floor;
    view = undefined;
    void refresh(floor);
  }
  return view && view.floor === floor && view.proposal ? view : undefined;
}

export function onDesignChanged(fn: () => void): () => void {
  subs.add(fn);
  return () => subs.delete(fn);
}

/** Fetch again now (after a button on the card). */
export function designNeedChanged() {
  if (asked) void refresh(asked);
}

/** Every message from the office: a design event on this floor means its card may have changed. */
export function designFeedMessage(msg: ServerMsg) {
  if (!asked || msg.t !== 'audit.new' || !msg.event.action.startsWith('design.') || (msg.floor !== asked && msg.event.floor !== asked)) return;
  clearTimeout(timer);
  const f = asked;
  timer = setTimeout(() => void refresh(f), 300);
}
