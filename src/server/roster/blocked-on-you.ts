// The standup page's "Blocked on you" (standup.ts compilePage): what the office's stuck detection
// (server/stuck/) has standing for the Project Manager on a floor, one line each, then what the other
// sources add (the surfaced asks, server/asks/: the lead's newest standup still on its branch). Each sets
// its source when the office makes it; without them (tests, an office that never made them) there is none.

type Source = (floorId: string) => Promise<string[]>;

let source: Source | undefined;
const extra = new Set<Source>();

export function setBlockedOnYou(fn: Source | undefined): void {
  source = fn;
}

/** Another source of lines, after stuck detection's. */
export function addBlockedOnYou(fn: Source): () => void {
  extra.add(fn);
  return () => extra.delete(fn);
}

/** The floor's standing items, one line each; [] when there's no source, and a source that fails adds nothing. */
export async function blockedOnYou(floorId: string): Promise<string[]> {
  const all = await Promise.all([source, ...extra].map(async (fn) => {
    try {
      return fn ? await fn(floorId) : [];
    } catch {
      return [];
    }
  }));
  return all.flat();
}
