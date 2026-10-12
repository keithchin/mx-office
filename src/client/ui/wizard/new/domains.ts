// The functional domains of the New project plan, drafted by the Chief Analyst once the scope is
// approved: a card per domain (its roles and stories), and a side panel per domain with each story, its id
// (VIS-1) and how many acceptance criteria it has. They go into docs/project-brief.md and the Discovery
// issue, where the Chief Analyst starts the BRDs and the build plan from them. No modules are suggested:
// the office has no real source for that, so the Lead Developer picks them at Stage 3.
import type { Domain } from '../../../../shared/brief';
import { h } from '../../dom';
import { openDialog, type Dialog } from './dialog';
import { draftingCard, icon } from './parts';
import type { Flow } from './index';

export function domainsPanel(flow: Flow) {
  const body = h('div.nw-panel-b', {});
  const el = h('section.nw-panel', { 'aria-label': 'Functional domains', hidden: true }, h('div.nw-panel-h', {}, icon('box'), h('h2', {}, 'Functional domains'), h('span.nw-badge.draft', {}, 'DRAFT'), h('span.nw-grow')), body);
  let side: Dialog | undefined;
  let drawnKey = '';

  function open(d: Domain, card: HTMLElement) {
    side?.close();
    el.querySelectorAll('.nw-dcard').forEach((c) => c.setAttribute('aria-expanded', String(c === card)));
    side = openDialog(
      flow.layer.querySelector('.nw-plan') ?? flow.layer,
      d.name,
      [
        h('div.nw-dmeta', {}, icon('user'), `${d.roles.join(', ')} · ${d.stories.length} user stories`),
        h('p.nw-ddesc', {}, d.description),
        h('h3', {}, 'User stories'),
        ...d.stories.map((s, k) => h('div.nw-story', { style: `animation-delay:${k * 50}ms` }, h('span.nw-sid', {}, s.id), h('b', {}, s.title), h('p', {}, s.text), h('div.nw-ac', {}, icon('list'), `${s.ac} acceptance criteria`))),
        h('p.nw-hint', {}, 'Every story is ASSUMED until the client confirms it in Discovery. The Lead Developer picks the modules at ✋ Stage 3 (Architecture & Design).'),
      ],
      { side: true, opener: card, onClose: () => ((side = undefined), el.querySelectorAll('.nw-dcard').forEach((c) => c.setAttribute('aria-expanded', 'false'))) },
    );
    flow.say(`${d.name}: ${d.stories.length} stories`);
  }

  function update() {
    const d = flow.draft;
    el.hidden = !d?.approved;
    if (!d?.approved) return;
    const key = `${d.domainsStatus}:${d.domains?.domains.length ?? 0}`;
    if (key === drawnKey) return;
    drawnKey = key;
    if (d.domainsStatus === 'mapping') {
      body.replaceChildren(draftingCard('Mapping functional domains from the brief…', 'Tip: domains become the BRD’s chapters, so each one gets its own use cases and tests.'));
      return;
    }
    if (!d.domains) {
      body.replaceChildren(h('p.nw-note', {}, icon('info'), h('span', {}, d.message ?? 'No functional domains were drafted: they’re left to the BRDs at Stage 2.')));
      return;
    }
    const cards = d.domains.domains.map((dm, i) => {
      const card = h('button.nw-dcard', { type: 'button', 'aria-expanded': 'false', 'aria-controls': 'nw-side', style: `animation-delay:${i * 90}ms` }, h('h4', {}, dm.name), h('span.nw-dmeta', {}, icon('user'), `${dm.roles.join(', ')} · ${dm.stories.length} stories`), h('ul.nw-dstories', {}, ...dm.stories.map((s) => h('li', {}, h('span.nw-sq', {}, icon('check')), s.title))));
      card.addEventListener('click', () => open(dm, card));
      return card;
    });
    body.replaceChildren(h('div.nw-domains', {}, ...cards), h('p.nw-note', {}, icon('info'), h('span', {}, `These become the BRD skeleton and the first build-plan items. Click a domain to see its stories.${d.domains.tier ? ` Suggested size tier: ${d.domains.tier}${d.domains.tierWhy ? ` (${d.domains.tierWhy})` : ''}.` : ''}`)));
  }

  return { el, update, closeSide: () => side?.close() };
}
