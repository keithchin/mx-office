// The project's review enforcement on the 🔐 Security tab (GET /api/merge-gate/protection): the default
// branch's protection as GitHub reports it, with the verdict Enforced / Weak / None (shared/merge-gate-protection.ts).
// Made once per project and asked once when shown (the server reads GitHub at most every 10 minutes); ↻ asks again.

import type { ProtectionView } from '../../../shared/merge-gate';
import { h } from '../dom';
import { verdictLine } from './panel';

export function protectionCard(floor: string): HTMLElement {
  const el = h('section.sec-card', { 'aria-label': 'Review enforcement' });
  const head = () => h('h3', {}, 'Review enforcement on GitHub');
  const load = async () => {
    el.replaceChildren(head(), h('p.sec-muted', {}, 'Reading the branch protection…'));
    try {
      const res = await fetch(`/api/merge-gate/protection?floor=${encodeURIComponent(floor)}`, { credentials: 'same-origin' });
      const b = (await res.json().catch(() => ({}))) as { protection?: ProtectionView; localOnly?: boolean; error?: string };
      if (!res.ok) throw new Error(b.error ?? `The office said ${res.status}`);
      const again = h('button.btn', { type: 'button' }, '↻ Read again');
      again.addEventListener('click', () => void load());
      if (b.localOnly || !b.protection) return void el.replaceChildren(head(), h('p.sec-muted', {}, 'A local-only project: nothing on GitHub to enforce the review.'));
      el.replaceChildren(head(), h('p', {}, b.protection.text), verdictLine(b.protection), h('p.sec-muted', {}, 'Read only: the office never changes branch protection. See Branch protection in the guide for the setup.'), again);
    } catch (err) {
      el.replaceChildren(head(), h('p.sec-muted', {}, `Couldn’t read it: ${(err as Error).message}`));
    }
  };
  void load();
  return el;
}
