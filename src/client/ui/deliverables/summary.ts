// The setup panel's line of 📦 deliverables (ui/setup-panel.ts): per toolkit stage, how many expected
// outputs are on main, only on a branch, or drafts, and a button that opens the floor's whole list.
// Fetched at most every half minute; the panel is drawn far more often.

import { STAGE_TITLE, stageCounts, type DeliverablesView } from '../../../shared/deliverables';
import { h, openModal } from '../dom';
import { deliverablesList } from './panel';

const FRESH_MS = 30_000;
let last: { floor: string; at: number; view?: DeliverablesView; p?: Promise<void> } | undefined;

function load(floor: string, redraw: () => void, fresh = false) {
  if (last?.floor === floor && (last.p || (!fresh && Date.now() - last.at < FRESH_MS))) return;
  const keep = last?.floor === floor ? last.view : undefined;
  const entry: NonNullable<typeof last> = { floor, at: Date.now(), view: keep };
  entry.p = fetch(`/api/deliverables?${new URLSearchParams({ floor, ...(fresh ? { fresh: '1' } : {}) })}`, { credentials: 'same-origin' })
    .then((r) => (r.ok ? (r.json() as Promise<DeliverablesView>) : undefined))
    .then((v) => {
      if (v) entry.view = v;
    })
    .catch(() => undefined)
    .finally(() => {
      entry.p = undefined;
      if (last === entry) redraw();
    });
  last = entry;
}

/** The floor's deliverables in a window, every team's, by stage. */
export function openFloorDeliverables(floor: string, view: DeliverablesView) {
  const body = h('div.dv-win-body', {}, deliverablesList(floor, view, true));
  openModal(h('div.modal.dv-win', { role: 'dialog', 'aria-label': 'Deliverables' }, h('header', {}, h('h2', {}, '📦 Deliverables')), body));
}

/** The line for the setup panel, from what's cached (fetching it when stale; `redraw` draws the panel again). */
export function deliverablesSummary(floor: string, redraw: () => void): HTMLElement | null {
  load(floor, redraw);
  const view = last?.floor === floor ? last.view : undefined;
  if (!view) return null;
  const counts = stageCounts(view.items).filter((c) => c.stage !== 'P');
  return h(
    'div.dv-summary',
    {},
    h('span.dv-summary-h', {}, '📦 Deliverables'),
    ...counts.map((c) =>
      h(
        'span.dv-chip',
        { class: c.present === c.expected ? 'dv-present' : c.branch || c.draft ? 'dv-branch' : 'dv-missing', title: `Stage ${c.stage} · ${STAGE_TITLE[c.stage]}: ${c.present} on main, ${c.branch} on a branch, ${c.draft} draft, ${c.missing} missing of ${c.expected} expected` },
        h('b', {}, c.stage),
        ` ${c.present}/${c.expected}`,
        c.branch ? h('span.dv-chip-b', {}, ` +${c.branch} on branch`) : null,
        c.draft ? h('span.dv-chip-b', {}, ` +${c.draft} draft`) : null,
      ),
    ),
    h('button.btn.small', { type: 'button', onclick: () => openFloorDeliverables(floor, view) }, 'Open deliverables →'),
  );
}
