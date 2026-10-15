// "Keep this project off GitHub" under Advanced (ProjectPlan.localOnly, server/wizard/local-only.ts): a new
// project only. Offered and ticked by default for Migrate an app when a source folder is attached, because
// the analysis will quote the client's code; a choice made by hand is kept from then on.
import type { DraftView } from '../../../../shared/brief';
import type { ProjectPlan } from '../../../../shared/wizard';
import { h } from '../../dom';

const byHand = new WeakSet<ProjectPlan>();

/** The default: on for a migration with a source folder attached, unless the person chose. */
export function defaultLocalOnly(plan: ProjectPlan, draft: DraftView | null | undefined) {
  if (byHand.has(plan)) return;
  plan.localOnly = plan.kind === 'new' && plan.entry === 'migration' && !!draft?.source;
}

export const LOCAL_ONLY_WHY = 'The analysis will quote the client’s source code: no GitHub repository, nothing pushed to GitHub, and the Discovery brief is a local file. The repository stays on this machine (add Team Server yourself later if you need it).';

export function localOnlyField(plan: ProjectPlan, redraw: () => void): HTMLElement | null {
  if (plan.kind !== 'new') return null;
  const box = h('input', { type: 'checkbox', id: 'nw-a-local', checked: !!plan.localOnly }) as HTMLInputElement;
  box.addEventListener('change', () => {
    byHand.add(plan);
    plan.localOnly = box.checked;
    redraw();
  });
  return h('div.nw-field.nw-local-only', {}, h('label.nw-check', { for: 'nw-a-local' }, box, h('span', {}, ' Keep this project off GitHub (local / Team Server only)')), h('span.nw-hint', {}, LOCAL_ONLY_WHY));
}
