// The Teams cards' Open buttons (notify-teams' publicUrl) follow the tunnel: when it comes up, its address
// goes in, unless someone typed another address there by hand (that one is theirs and stays). A quick
// tunnel's address dies with it, so it comes out again when that tunnel stops; a Dev Tunnel's or named
// Cloudflare tunnel's is the same next time, so it stays.

export interface PublicUrlSlot {
  get(): string | undefined;
  /** Sets it ('' clears it); why not, if it couldn't. */
  set(url: string): string | undefined;
}

/** The tunnel is up at `url`: returns the address phone access now owns there (to remember), if it put one in. */
export function linkTeams(slot: PublicUrlSlot, url: string, lastAuto: string | undefined): string | undefined {
  const now = slot.get();
  if (now && now !== lastAuto && now !== url) return lastAuto;
  if (now !== url && slot.set(url)) return lastAuto;
  return url;
}

/** The tunnel stopped for good: a quick tunnel's address comes out (if it's still the one phone access put in). */
export function unlinkTeams(slot: PublicUrlSlot, url: string | undefined, lastAuto: string | undefined, ephemeral: boolean): string | undefined {
  if (!ephemeral || !url || slot.get() !== url || lastAuto !== url) return lastAuto;
  slot.set('');
  return undefined;
}
