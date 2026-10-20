import './process-map.css';
// 🗺️ What a process map file says beside its name (shared/process-map.ts factNotes): its pass, and
// "Stale: older than its model…" by the toolkit gate's rule; the BRD report that opens with the pass-1 map.

import { factNotes, type ProcessMapFacts } from '../../../shared/process-map';
import { h } from '../dom';

/** The badges for `facts`, or null when there's nothing to say. */
export function factBadges(facts: ProcessMapFacts | undefined): HTMLElement | null {
  const notes = factNotes(facts);
  if (!notes.length) return null;
  return h('span.pm-notes', {}, ...notes.map((n) => h('span.pm-note', { class: `pm-${n.tone}`, ...(n.title ? { title: n.title } : {}) }, n.text)));
}
