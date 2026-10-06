// A floor's own reason not to hire: its team's daily cost cap is reached (see the roster's costCaps).
// The roster sets it; the floor's worker manager, queue and meetings see it through floorLedger, the
// office's Ledger with hiringPaused widened to this floor's cap, so every way of hiring stops.

import type { Ledger } from '../usage.js';

const paused = new Map<string, string>();

export function setFloorPause(floorId: string, why: string | undefined) {
  if (why) paused.set(floorId, why);
  else paused.delete(floorId);
}

export const floorPause = (floorId: string): string | undefined => paused.get(floorId);

/**
 * Other holds on a floor, by who set them (the project's budget at 100 %, budget/pause.ts): they stop
 * hiring and the office's own prompts the same way the cap does, and the cap's updates never clear them.
 */
const holds = new Map<string, Map<string, string>>();

export function setFloorHold(floorId: string, source: string, why: string | undefined) {
  const m = holds.get(floorId) ?? new Map<string, string>();
  if (why) m.set(source, why);
  else m.delete(source);
  if (m.size) holds.set(floorId, m);
  else holds.delete(floorId);
}

/** The first hold on a floor, if any. */
export const floorHold = (floorId: string): string | undefined => holds.get(floorId)?.values().next().value;

/** The office's ledger as one floor sees it: paused when the office's budget is spent or this floor's cap is. */
export function floorLedger(ledger: Ledger, floorId: string): Ledger {
  return new Proxy(ledger, {
    get(target, prop) {
      if (prop === 'hiringPaused') return target.hiringPaused ?? paused.get(floorId) ?? floorHold(floorId);
      const v = Reflect.get(target, prop, target);
      return typeof v === 'function' ? v.bind(target) : v;
    },
  });
}
