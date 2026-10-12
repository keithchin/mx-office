// The standup page's "Blocked on you" (standup.ts compilePage): what the office's stuck detection
// (server/stuck/) has standing for the Project Manager on a floor, one line each. Stuck detection sets the
// source when the office makes it; without it (tests, an office that never made it) there is none.

let source: ((floorId: string) => Promise<string[]>) | undefined;

export function setBlockedOnYou(fn: ((floorId: string) => Promise<string[]>) | undefined): void {
  source = fn;
}

/** The floor's standing stuck items, one line each; [] when there's no source or it fails. */
export async function blockedOnYou(floorId: string): Promise<string[]> {
  try {
    return source ? await source(floorId) : [];
  } catch {
    return [];
  }
}
