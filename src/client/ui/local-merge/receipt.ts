// "Review and merge @C" on a Developer change's receipt (app-workspace/dock/cards.ts), for a local-only project:
// the commit goes through the same confirm step and server path as the merge panel (./confirm.ts,
// server/local-merge/): your approval of exactly that commit, then a --no-ff merge of it, so the PM doesn't have
// to go to Project Management. Admins only (the view's mayMerge), at any autonomy level (the confirm step says
// whose merges they are).
//
// Which commit: the server's merge targets (shared/merge-target.ts, server/local-merge/targets.ts), the branch
// that actually carries the change (the one an agent asked to merge for it, or the only one with model or code
// work and no failed gate), never `dev/DC-n` just by its name: a notes-only journal or a script draft that
// failed the mxbuild gate is never offered. When it isn't clear, "Choose what to merge…" lists every branch
// with what it is and its gate state, nothing chosen until the PM picks one. A candidate seen after cancel or
// supersede ("late") never offers anything.

import type { DevChangeView } from '../../../shared/dev-changes';
import type { MergeOption } from '../../../shared/merge-target';
import { h, openModal } from '../dom';
import { openMergeConfirm } from './confirm';
import { devFeed } from '../dev-changes/feed';
import './panel.css';

const short = (sha: string) => sha.slice(0, 7);

/** The commit a receipt may merge at once: the server's pick, while the change is on a candidate. */
export function mergeCandidate(c: Pick<DevChangeView, 'state' | 'mergeTargets'>): { sha: string; branch: string } | undefined {
  if (c.state !== 'candidate') return undefined;
  return c.mergeTargets?.pick;
}

/** The options the PM may choose from when there's no clear pick (some may merge, or none can and they say why). */
export function mergeChoices(c: Pick<DevChangeView, 'state' | 'mergeTargets'>): MergeOption[] {
  if (c.state !== 'candidate' || c.mergeTargets?.pick) return [];
  return c.mergeTargets?.options ?? [];
}

const KIND: Record<MergeOption['kind'], string> = { change: 'model or code changes', script: 'script draft only', notes: 'notes only' };

/** The chooser: every branch with what it is and its gate state; nothing chosen until the PM picks one that may merge. ✕ and Esc give focus back. */
export function openMergeChooser(floor: string, c: Pick<DevChangeView, 'id' | 'mergeTargets'>, opener: HTMLElement): void {
  const options = c.mergeTargets?.options ?? [];
  let picked: MergeOption | undefined;
  const go = h('button.btn.primary', { type: 'button', 'data-act': 'choose-merge', disabled: true }, 'Review and merge…') as HTMLButtonElement;
  const cancel = h('button.btn', { type: 'button' }, 'Cancel') as HTMLButtonElement;
  const rows = options.map((o, i) => {
    const radio = h('input', { type: 'radio', name: 'mt-pick', value: String(i), disabled: !o.ok }) as HTMLInputElement;
    radio.addEventListener('change', () => {
      picked = o;
      go.disabled = false;
      go.textContent = `Review and merge @${short(o.sha)}`;
    });
    return h(
      'label.mt-opt',
      { 'data-branch': o.branch, 'data-ok': String(o.ok) },
      radio,
      h(
        'span.mt-txt',
        {},
        h('span.mt-what', {}, h('b', {}, `${o.branch} @${short(o.sha)}`), o.owner ? ` · ${o.owner}’s` : '', ` · ${KIND[o.kind]}`, o.asked ? ` · ${o.asked.by} asked to merge it` : ''),
        h('small.mt-gate', { 'data-gate': o.ok ? 'ok' : 'no' }, o.ok ? o.gate : `Not offered: ${o.why}`),
        o.subject ? h('small.mt-subj', {}, `“${o.subject}”`) : '',
      ),
    );
  });
  const box = h(
    'div.modal.mt-dlg',
    { role: 'dialog', 'aria-modal': 'true', 'aria-label': `What to merge for ${c.id}` },
    h('header', {}, h('h2', {}, `What to merge for ${c.id}?`)),
    h('div.body', {}, h('p', {}, c.mergeTargets?.words ?? ''), h('div.mt-opts', { role: 'radiogroup' }, ...rows), h('p.lmc-small', {}, 'Nothing is chosen for you: pick the branch that has the change. A notes-only branch, a script draft or a commit whose gate failed can’t be merged from here.')),
    h('footer', {}, h('span.grow'), cancel, go),
  );
  const modal = openModal(box, { onClose: () => opener.focus?.() });
  cancel.addEventListener('click', () => modal.close());
  go.addEventListener('click', () => {
    if (!picked) return;
    const p = picked;
    modal.close();
    void openMergeConfirm({ floor, branch: p.branch, sha: p.sha, opener, reviewFirst: true, onDone: () => devFeed.now(floor) });
  });
}

/** The receipt's button, or nothing. */
export function receiptMergeButton(floor: string, c: DevChangeView, mayMerge: boolean | undefined): HTMLElement | '' {
  if (!mayMerge) return '';
  const cand = mergeCandidate(c);
  if (cand) {
    const btn = h('button.aw-btn.dk-merge', { type: 'button', 'data-act': 'review-merge', 'data-sha': cand.sha, 'data-branch': cand.branch, title: `${c.mergeTargets?.words ?? ''}. Review exactly @${short(cand.sha)} of ${cand.branch} and merge it into main, after a confirm step` }, `Review and merge @${short(cand.sha)}`) as HTMLButtonElement;
    btn.addEventListener('click', () => void openMergeConfirm({ floor, branch: cand.branch, sha: cand.sha, opener: btn, reviewFirst: true, onDone: () => devFeed.now(floor) }));
    return btn;
  }
  const choices = mergeChoices(c);
  if (!choices.length) return '';
  const btn = h('button.aw-btn.dk-merge', { type: 'button', 'data-act': 'choose-merge', title: c.mergeTargets?.words ?? '' }, choices.some((o) => o.ok) ? 'Choose what to merge…' : 'Why nothing to merge…') as HTMLButtonElement;
  btn.addEventListener('click', () => openMergeChooser(floor, c, btn));
  return btn;
}
