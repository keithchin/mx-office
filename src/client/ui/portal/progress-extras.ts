// What features add to the Portal Overview's Progress card (./overview.ts calls mountProgressExtras once, with
// the card): each registers a function that gets the card and puts its own part in it, drawing only when it has
// something to show (phased delivery's phase strip, ui/roadmap/strip.ts). The list a feature joins, so the
// Overview's own file never names one.

type Extra = (card: HTMLElement) => void;
const extras: Extra[] = [];
let mounted: HTMLElement | undefined;

/** Adds a part to the Progress card (mounted at once when the card is already there). */
export function registerProgressExtra(fn: Extra): void {
  extras.push(fn);
  if (mounted) fn(mounted);
}

/** The Overview's Progress card is made: every registered part goes in. */
export function mountProgressExtras(card: HTMLElement): void {
  mounted = card;
  for (const fn of extras) fn(card);
}
