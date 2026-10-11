// The setup panel's line of 📄 documents (ui/setup-panel.ts): per toolkit stage, how many expected
// outputs are on main, only on a branch, or drafts, and a button to the Documents page (page.ts).
// Asked for through store.ts (one request at a time, at most every half minute); the panel is drawn far
// more often.

import { STAGE_TITLE, stageCounts } from '../../../shared/deliverables';
import { h } from '../dom';
import { openDocuments } from './open';
import { cachedDocs, docsLoading, loadDocs, onDocs } from './store';

let redrawFor: { floor: string; redraw: () => void } | undefined;
onDocs((floor) => {
  if (redrawFor?.floor === floor && !docsLoading(floor)) redrawFor.redraw();
});

/** The line for the setup panel, from what's kept (asking again when it's old; `redraw` draws the panel again). */
export function deliverablesSummary(floor: string, redraw: () => void): HTMLElement | null {
  redrawFor = { floor, redraw };
  void loadDocs(floor);
  const view = cachedDocs(floor)?.view;
  if (!view) return null;
  const counts = stageCounts(view.items).filter((c) => c.stage !== 'P');
  return h(
    'div.dv-summary',
    {},
    h('span.dv-summary-h', {}, '📄 Documents'),
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
    h('button.btn.small', { type: 'button', onclick: () => openDocuments(floor) }, 'Open documents →'),
  );
}
