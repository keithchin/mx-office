// The one input builder every Needs-you surface goes through (the strip, the Overview card, the lead
// panel's count, the team phone, the phone version and Teams): every source is named, even when a surface
// has nothing for it, so the typecheck catches a surface that forgets one, and they can't drift apart
// again (mobile and Teams used to miss asks, budget and incidents). Pure.

import type { NeedsInput } from '../needsyou.js';

/** Every source Needs you reads: each key required (its value may be undefined). */
export type NeedsSources = { [K in keyof Required<Omit<NeedsInput, 'now'>>]: NeedsInput[K] } & { now?: number };

/** The NeedsInput from every source, with nothing left out by accident. */
export function needsInputOf(s: NeedsSources): NeedsInput {
  return { ...s };
}
