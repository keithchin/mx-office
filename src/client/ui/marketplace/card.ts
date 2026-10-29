// A Mendix Marketplace request's card in the Overview's Needs you (shared/decisions/marketplace.ts): what is
// asked (item, version, publisher, licence, who asked, why, which branch), then its buttons:
//   Download and add     the office downloads it with its own Mendix credential (off, with why, when it has none);
//   Use a package file…  a .mpk the PM downloaded from the Marketplace website (./dialog.ts), always there;
//   Decline              with the note typed in the card's words field (portal/card-words.ts).
// Only the Project Manager (an admin) acts; everyone else reads it.

import type { DecisionCard } from '../../../shared/decisions/types';
import { h, toast } from '../dom';
import { cardExtras, kindTag, type CardCtx } from '../portal/decision-card';
import { cardWords } from '../portal/card-words';
import { marketplaceApi, type ActResult } from './api';
import { setMarketplaceView } from './feed';
import { openPackageDialog } from './dialog';
import './marketplace.css';

export function marketplaceCard(c: DecisionCard, x: CardCtx): HTMLElement {
  const m = c.marketplace!;
  const r = m.request;
  const msg = h('p.mk-msg', { role: 'status', 'aria-live': 'polite' }, r.status === 'failed' && r.note ? `Last try failed: ${r.note}` : r.status === 'working' ? 'The office is adding it now…' : r.status === 'waiting' ? `Approved: waiting for ${r.by.name} to commit its work (the app has uncommitted changes). The office adds it by itself once it can.` : '');
  const words = x.admin ? cardWords(r.by.name) : undefined;
  const buttons: HTMLButtonElement[] = [];
  const btn = (cls: string, text: string, run: () => Promise<ActResult | undefined>, opts: { disabled?: boolean; title?: string; keep?: boolean } = {}) => {
    const b = h(`button.btn.small${cls}`, { type: 'button', ...(opts.title ? { title: opts.title } : {}) }, text) as HTMLButtonElement;
    // Waiting for a clean app: only Decline is left (the office adds it by itself).
    b.disabled = !!opts.disabled || r.status === 'working' || (r.status === 'waiting' && !cls.includes('mk-decline'));
    b.addEventListener('click', async () => {
      // A dialog keeps its opener enabled, so ✕ / Esc can give it focus back.
      const was = buttons.map((y) => y.disabled);
      if (!opts.keep) buttons.forEach((y) => (y.disabled = true));
      const out = await run();
      buttons.forEach((y, i) => (y.disabled = was[i]));
      if (!out) return;
      if (!out.ok) {
        msg.textContent = out.error;
        msg.classList.add('bad');
        return;
      }
      words?.clear();
      setMarketplaceView(out.view);
      if (out.request.status === 'waiting') {
        msg.textContent = `Approved: ${r.by.name}’s app has uncommitted changes, so ${r.by.name} is asked to commit; the office adds it by itself once the app is clean.`;
        msg.classList.remove('bad');
        toast(`Approved: it goes in once ${r.by.name} commits`);
        return;
      }
      const done = out.request.status === 'added' ? `Added · commit ${out.request.added?.commit?.slice(0, 7) ?? ''}` : 'Declined';
      toast(out.request.status === 'added' ? `Added to ${r.branch ?? `${r.by.name}’s folder`}: ${r.by.name} is told` : `${r.by.name} is told you declined`);
      x.done(c, done);
    });
    buttons.push(b);
    return b;
  };
  const acts = !x.admin
    ? h('p.pt-esc-meta', {}, 'Only the Project Manager (an admin) can act on it.')
    : h(
        'div.pt-esc-acts',
        {},
        btn('.primary.mk-download', 'Download and add', async () => ((msg.textContent = 'Downloading and checking…'), msg.classList.remove('bad'), marketplaceApi.act(x.floor, r.rid, 'approve')), {
          disabled: !m.canDownload,
          title: m.canDownload ? 'The office downloads it with its own Mendix credential, checks it and commits it to the branch' : (m.noDownload ?? 'The office has no Mendix token it may use'),
        }),
        btn('.mk-file', 'Use a package file…', async () => openPackageDialog(x.floor, r, buttons[1]), { keep: true }),
        btn('.mk-decline', `Decline: tell ${r.by.name}`, async () => marketplaceApi.act(x.floor, r.rid, 'decline', { words: words?.value() ?? '' })),
      );
  return h(
    'article.pt-nitem.pt-esc.pt-dc.mk-card',
    { 'data-card': c.id, 'data-kind': c.kind, 'data-rid': r.rid, 'aria-label': `Decision: ${c.question}` },
    h('div.pt-esc-h', {}, kindTag(c), h('b.pt-esc-t', {}, c.question)),
    h('p.pt-esc-meta.pt-esc-by', {}, `from ${c.owner}`),
    c.detail ? h('p.pt-esc-q', {}, c.detail) : null,
    h('ul.mk-facts', {}, ...c.evidence.map((e) => h('li', {}, e.label, e.where ? h('small', {}, ` · ${e.where}`) : null))),
    !m.canDownload && m.noDownload ? h('p.pt-dc-small.mk-nodl', {}, m.noDownload) : null,
    ...cardExtras({ ...c, evidence: [], notes: c.notes.filter((n) => n !== m.noDownload) }, x),
    words?.el ?? null,
    msg,
    acts,
  );
}
