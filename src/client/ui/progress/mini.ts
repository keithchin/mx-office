// The progress bar's mini version on Home's project cards: the same coloured segments without words,
// and the one line (where the project is, or "v1 accepted · date"). Home draws its cards again whenever
// a floor changes, so each floor's answer is kept a minute and drawn from that at once; a stale or
// missing one is asked for (`mini=1`: no deliverables scan) when a card is drawn, never on a timer.

import { progressLabel, type ProjectProgress } from '../../../shared/progress';
import { getProgress } from './api';
import { segments } from './bar';
import './progress.css';

const FRESH_MS = 60_000;
const kept = new Map<string, { at: number; p?: ProjectProgress; asking?: Promise<void> }>();

function fill(el: HTMLElement, p: ProjectProgress | undefined) {
  if (!p) return;
  const line = document.createElement('span');
  line.className = 'pg-mini-label';
  line.textContent = progressLabel(p);
  const track = document.createElement('span');
  track.className = 'pg-mini-track';
  track.setAttribute('aria-hidden', 'true');
  track.append(...segments(p, false));
  el.replaceChildren(track, line);
  el.title = `${progressLabel(p)}${p.note ? ` — ${p.note}` : ''}`;
}

/** The mini bar for `floor`'s card: drawn now from what's kept, and again when a fresh answer comes. */
export function miniProgress(floor: string): HTMLElement {
  const el = document.createElement('div');
  el.className = 'pg-mini';
  const k = kept.get(floor) ?? { at: 0 };
  kept.set(floor, k);
  fill(el, k.p);
  if (Date.now() - k.at > FRESH_MS && !k.asking) {
    k.asking = getProgress(floor, true).then((p) => {
      k.asking = undefined;
      k.at = Date.now();
      if (p) k.p = p;
    });
  }
  void k.asking?.then(() => el.isConnected && fill(el, k.p));
  return el;
}
