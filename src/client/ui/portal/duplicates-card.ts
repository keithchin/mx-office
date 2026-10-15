// The Overview's clean-up card (shared/decisions/duplicates-card.ts): "Likely duplicates: 9 asks repeat 5
// others", a line per group ("GenAI key ×3 → keep the newest"), and two buttons. Close duplicates asks you
// to confirm first, in the card (no dialog), and only then sends the groups you saw (POST
// /api/decisions/action close-duplicates): each duplicate is closed as superseded by the one kept, audited,
// and nothing is sent to the agents. Review one by one lists each duplicate with a button to its own card.

import type { DecisionCard } from '../../../shared/decisions/types';
import type { DuplicateGroup } from '../../../shared/decisions/duplicates';
import { h } from '../dom';
import { decisionAct } from '../decisions/api';
import { kindTag, type CardCtx } from './decision-card';

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

function groupLine(g: DuplicateGroup): HTMLElement {
  return h('li', {}, h('b', {}, clip(g.keep.title, 80)), ` ×${g.close.length + 1} → keep the newest`, h('small', {}, ` · ${g.kind === 'proposal' ? 'proposals' : 'AWAITING-PM'} from ${g.by}`));
}

/** The clean-up card for `c` (its `duplicates`). */
export function duplicatesCard(c: DecisionCard, x: CardCtx): HTMLElement {
  const groups = c.duplicates ?? [];
  const n = groups.reduce((k, g) => k + g.close.length, 0);
  const list = h('ul.pt-dc-dupes', {}, ...groups.map(groupLine));
  const review = h('div.pt-dc-review', { hidden: true });
  const confirm = h('div.pt-dc-confirm', { hidden: true, role: 'group', 'aria-label': 'Confirm closing the duplicates' });
  const acts = h('div.pt-esc-acts');
  const go = (g: DuplicateGroup, id: string) => x.go(g.kind === 'proposal' ? { to: 'approvals' } : { to: 'escalation', id });
  review.append(
    ...groups.map((g) =>
      h(
        'div.pt-dc-rgroup',
        {},
        h('p.pt-dc-line', {}, h('b', {}, 'Kept: '), clip(g.keep.title, 120), ' ', h('button.pt-link', { type: 'button', onclick: () => go(g, g.keep.id) }, 'Open')),
        h('ul', {}, ...g.close.map((d) => h('li', {}, 'Duplicate: ', clip(d.title, 120), d.gone ? h('small', {}, ' (its line is gone)') : null, ' ', h('button.pt-link', { type: 'button', onclick: () => go(g, d.id) }, 'Open')))),
      ),
    ),
  );
  const openBtn = h('button.btn.small.primary', { type: 'button' }, 'Close duplicates') as HTMLButtonElement;
  const reviewBtn = h('button.btn.small', { type: 'button', 'aria-expanded': 'false' }, 'Review one by one') as HTMLButtonElement;
  const yes = h('button.btn.small.primary', { type: 'button' }, `Yes, close ${n}`) as HTMLButtonElement;
  const no = h('button.btn.small', { type: 'button' }, 'Cancel') as HTMLButtonElement;
  confirm.append(h('p.pt-dc-line', {}, `Close ${n} duplicate${n === 1 ? '' : 's'}? Each is closed as superseded by the newest of its group, and that's recorded in the audit log. Nothing is sent to the agents.`), h('div.pt-esc-acts', {}, yes, no));
  openBtn.addEventListener('click', () => {
    confirm.hidden = false;
    yes.focus();
  });
  no.addEventListener('click', () => {
    confirm.hidden = true;
    openBtn.focus();
  });
  reviewBtn.addEventListener('click', () => {
    review.hidden = !review.hidden;
    reviewBtn.setAttribute('aria-expanded', String(!review.hidden));
  });
  yes.addEventListener('click', async () => {
    yes.disabled = true;
    const ok = await decisionAct(x.floor, { action: 'close-duplicates', groups: groups.map((g) => ({ keep: g.keep.id, close: g.close.map((d) => d.id) })) });
    yes.disabled = false;
    if (ok) x.done(c, `${n} duplicate${n === 1 ? '' : 's'} closed as superseded`);
  });
  if (x.admin) acts.append(openBtn, reviewBtn);
  else acts.append(h('p.pt-esc-meta', {}, 'Only the Project Manager (an admin) can close duplicates.'), reviewBtn);
  return h(
    'article.pt-nitem.pt-esc.pt-dc.pt-dc-dup',
    { 'data-id': c.id, 'data-card': c.id, 'data-kind': c.kind, 'aria-label': `Clean-up: ${c.question}` },
    h('div.pt-esc-h', {}, kindTag(c), h('b.pt-esc-t', {}, c.question)),
    h('p.pt-esc-q', {}, 'The same ask was filed more than once. Close duplicates keeps the newest of each group; nothing closes until you confirm.'),
    list,
    review,
    confirm,
    acts,
  );
}
