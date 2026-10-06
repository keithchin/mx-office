// `office-workers tell` between two agents, bounded: two agents that keep telling each other things can
// go back and forth for as long as there's money, each message a turn for both. So each sender→target
// pair gets a few tells in a sliding window, and past that the office refuses with a word on what to do
// instead (the journal, or an escalation when they're stuck). One per office (tellLimitOf), in memory:
// a restart starts every count again.

/** Tells one agent may send another in the window. */
export const TELL_MAX = 5;
export const TELL_WINDOW_MS = 10 * 60_000;

export class TellLimit {
  private sent = new Map<string, number[]>();

  constructor(
    private now: () => number = Date.now,
    private max = TELL_MAX,
    private windowMs = TELL_WINDOW_MS,
  ) {}

  /** Counts a tell from `from` to `to`: undefined when it may go, else why not (for the sender). */
  take(from: { id: string; name: string }, to: { id: string; name: string }): string | undefined {
    const now = this.now();
    const key = `${from.id}>${to.id}`;
    const recent = (this.sent.get(key) ?? []).filter((t) => now - t < this.windowMs);
    if (recent.length >= this.max) {
      this.sent.set(key, recent);
      const wait = Math.max(1, Math.ceil((recent[0] + this.windowMs - now) / 60_000));
      return `You've told ${to.name} ${recent.length} times in the last ${Math.round(this.windowMs / 60_000)} minutes, the most the office allows. Stop the back-and-forth: write what's left in your team journal for ${to.name} to read, or if you're stuck on each other, escalate to the Project Manager (office-workers escalate). You can tell ${to.name} again in about ${wait} minute${wait === 1 ? '' : 's'}.`;
    }
    recent.push(now);
    this.sent.set(key, recent);
    // Forget pairs gone quiet, so the map doesn't grow with every pair that ever talked.
    if (this.sent.size > 500) for (const [k, v] of this.sent) if (!v.some((t) => now - t < this.windowMs)) this.sent.delete(k);
    return undefined;
  }
}

const limits = new WeakMap<object, TellLimit>();

/** The office's tell limit, keyed by its config like the roster. */
export function tellLimitOf(key: object): TellLimit {
  let l = limits.get(key);
  if (!l) {
    l = new TellLimit();
    limits.set(key, l);
  }
  return l;
}
