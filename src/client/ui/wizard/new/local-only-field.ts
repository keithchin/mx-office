// "Keep this project off GitHub" under Advanced (ProjectPlan.localOnly, server/wizard/local-only.ts): a new
// project only, and off by default: a private GitHub repository is the usual home even for a migration with a
// source folder (sources/legacy/ is git-ignored, so the code itself is never pushed). A choice made by hand is kept.
import type { DraftView } from '../../../../shared/brief';
import type { ProjectPlan } from '../../../../shared/wizard';
import { h } from '../../dom';

const byHand = new WeakSet<ProjectPlan>();

/** The default: off (a private GitHub repository), unless the person chose. A source folder makes the repository private. */
export function defaultLocalOnly(plan: ProjectPlan, draft: DraftView | null | undefined) {
  if (draft?.source) plan.private = true;
  if (byHand.has(plan)) return;
  plan.localOnly = false;
}

export const LOCAL_ONLY_WHY = 'Only when the client won’t allow a private GitHub repository. No GitHub repository, nothing pushed to GitHub, and the Discovery brief is a local file; pull requests, PR checks and PR-based task outcomes aren’t available, and the only copy is on this machine.';

export function localOnlyField(plan: ProjectPlan, redraw: () => void): HTMLElement | null {
  if (plan.kind !== 'new') return null;
  const box = h('input', { type: 'checkbox', id: 'nw-a-local', checked: !!plan.localOnly }) as HTMLInputElement;
  box.addEventListener('change', () => {
    byHand.add(plan);
    plan.localOnly = box.checked;
    redraw();
  });
  return h('div.nw-adv-group.nw-local-only', {}, h('label.nw-check', { for: 'nw-a-local' }, box, h('span', {}, ' Keep this project off GitHub (local / Team Server only)')), h('span.nw-hint', {}, LOCAL_ONLY_WHY));
}
