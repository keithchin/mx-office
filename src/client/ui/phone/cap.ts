// How much of a chat log the team phone and the phone page draw (screens.ts): pure, so a test can hold it.

/**
 * A log draws at most this many of its newest messages at first: a floor keeps a thousand, and drawing
 * them all (and comparing them all to what was there) on every paint made opening the phone hang on a
 * busy floor (the performance guard, 2026-10-07). Load older adds this many again.
 */
export const STREAM_CAP = 150;

/** The newest `limit` items, oldest first: what a log draws. */
export function newest<T extends { at: number }>(items: T[], limit: number): T[] {
  const sorted = items.sort((a, b) => a.at - b.at);
  return sorted.length > limit ? sorted.slice(-limit) : sorted;
}
