// `office-workers tell` between two agents, bounded: two agents that keep telling each other things can
// go back and forth for as long as there's money, each message a turn for both. So each sender→target
// pair gets a few tells in a sliding window, and past that the office refuses with a word on what to do
// instead (the journal, or an escalation when they're stuck). One per office (tellLimitOf). The window is
// kept in <data>/tell-limit.json (written off the event loop, offloop/save.ts), so a restart doesn't hand
// every pair a fresh allowance; a missing or unreadable file starts empty.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { BackgroundFile } from '../offloop/save.js';

/** Tells one agent may send another in the window. */
export const TELL_MAX = 5;
export const TELL_WINDOW_MS = 10 * 60_000;
export const TELL_LIMIT_FILE = 'tell-limit.json';

export class TellLimit {
  private sent = new Map<string, number[]>();
  private save?: BackgroundFile;

  constructor(
    private now: () => number = Date.now,
    private max = TELL_MAX,
    private windowMs = TELL_WINDOW_MS,
    /** Where the window is kept between restarts; none keeps it in memory only. */
    file?: string,
  ) {
    if (!file) return;
    this.save = new BackgroundFile(file, { mkdir: true });
    try {
      const raw = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
      const at = this.now();
      for (const [k, v] of Object.entries(raw ?? {})) {
        const ts = Array.isArray(v) ? v.filter((t): t is number => typeof t === 'number' && at - t < this.windowMs && t <= at) : [];
        if (ts.length) this.sent.set(k, ts.slice(-this.max));
      }
    } catch {
      // No file yet, or not readable: start empty.
    }
  }

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
    // Forget pairs gone quiet, so neither the map nor the file grows with every pair that ever talked.
    for (const [k, v] of this.sent) if (!v.some((t) => now - t < this.windowMs)) this.sent.delete(k);
    void this.save?.write(JSON.stringify(Object.fromEntries(this.sent))).catch(() => undefined);
    return undefined;
  }

  /** Writes what's still due now (the office's exit, tests). */
  flush() {
    this.save?.flush();
  }
}

const limits = new WeakMap<object, TellLimit>();

/** The office's tell limit, keyed by its config like the roster, kept in its data folder when it has one. */
export function tellLimitOf(key: object & { dataDir?: string }): TellLimit {
  let l = limits.get(key);
  if (!l) {
    l = new TellLimit(Date.now, TELL_MAX, TELL_WINDOW_MS, key.dataDir ? path.join(key.dataDir, TELL_LIMIT_FILE) : undefined);
    limits.set(key, l);
  }
  return l;
}
