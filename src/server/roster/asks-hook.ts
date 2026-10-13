// A look at a floor's surfaced asks soon (server/asks/): after a member is benched or paused (its handoff
// may end AWAITING-PM) and after a turn ends. The asks service sets the hook when the office makes it;
// without it (tests, an office that never made it) nothing happens.

let hook: ((floorId: string, why: string) => void) | undefined;

export function setAsksSoon(fn: ((floorId: string, why: string) => void) | undefined): void {
  hook = fn;
}

/** Asks for a look at the floor's asks soon (a burst is one look). Never throws. */
export function asksSoon(floorId: string, why: string): void {
  try {
    hook?.(floorId, why);
  } catch {
    // The next regular look sees it.
  }
}
