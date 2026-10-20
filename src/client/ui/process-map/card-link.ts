import './process-map.css';
// 🗺️ "See where this fits": a decision card whose question or ASSUMED decision is pinned on the toolkit's
// process map gets a line that opens the map at that process (shared/process-map.ts pinForCard; the pins
// from GET /api/process-map/pins, asked once a minute per project). A project with no map gets nothing.
// The map's own deep link is `#/<process>`; it has none for a single step yet, so the line names the step.

import { bestPlace, pinForCard, placeHash, placeWords, type PinsView } from '../../../shared/process-map';
import type { DecisionCard } from '../../../shared/decisions/types';
import { h } from '../dom';
import { openDeliverable } from '../deliverables/viewer';

/** Pins this young aren't asked for again. */
const PINS_FRESH_MS = 60_000;
const kept = new Map<string, { at: number; view?: PinsView; p?: Promise<PinsView | undefined> }>();

type Fetcher = (floor: string) => Promise<PinsView | undefined>;
const httpFetcher: Fetcher = async (floor) => {
  try {
    const r = await fetch(`/api/process-map/pins?${new URLSearchParams({ floor })}`, { credentials: 'same-origin' });
    return r.ok ? ((await r.json()) as PinsView) : undefined;
  } catch {
    return undefined;
  }
};
let fetcher: Fetcher = httpFetcher;

/** Tests: where the pins come from (the office's API when undefined). */
export function setPinsFetcher(f: Fetcher | undefined) {
  fetcher = f ?? httpFetcher;
  kept.clear();
}

/** The floor's pins: the kept ones when young enough (returned at once), else asked for (one request at a time). */
function pinsOf(floor: string): { now?: PinsView; later?: Promise<PinsView | undefined> } {
  const k = kept.get(floor);
  if (k?.p) return { now: k.view, later: k.p };
  if (k && Date.now() - k.at < PINS_FRESH_MS) return { now: k.view };
  const p = fetcher(floor).then((view) => {
    kept.set(floor, { at: Date.now(), view: view ?? k?.view });
    return view;
  });
  kept.set(floor, { at: k?.at ?? 0, view: k?.view, p });
  return { now: k?.view, later: p };
}

function fill(line: HTMLElement, card: DecisionCard, floor: string, view: PinsView | undefined) {
  const map = view?.map;
  const pin = map ? pinForCard({ question: card.question, detail: card.detail, texts: card.sources.map((s) => s.text), questionKey: card.questionKey }, view.pins) : undefined;
  if (!map || !pin) {
    line.hidden = true;
    line.replaceChildren();
    return;
  }
  const place = bestPlace(pin);
  const where = { src: map.src, label: map.label };
  line.hidden = false;
  line.setAttribute('data-pin', pin.id);
  line.replaceChildren(
    'See where this fits → ',
    h(
      'button.pt-link.pm-fits-go',
      { type: 'button', title: `Open ${map.path} ${place.step ? `at ${place.processTitle} (step ${place.n}: ${place.stepTitle})` : 'at its index (whole app)'}`, onclick: () => openDeliverable(floor, { path: map.path, where: [where] }, undefined, where, placeHash(place)) },
      `Process map: ${placeWords(place)}`,
    ),
    ...(place.step ? [h('small', {}, `“${place.stepTitle}”`)] : []),
  );
}

/** The card's "See where this fits" line: hidden until (and unless) the card's item is pinned on the floor's map. */
export function fitsLine(card: DecisionCard, floor: string): HTMLElement {
  const line = h('p.pm-fits', { hidden: true });
  if (!floor) return line;
  const { now, later } = pinsOf(floor);
  fill(line, card, floor, now);
  void later?.then((v) => v && fill(line, card, floor, v));
  return line;
}
