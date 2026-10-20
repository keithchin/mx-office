// What a project was set up with from another app (server/adopt-from/), in ⚙️ Settings › 🗂️ Client: "Adopted from
// Fleet Tracker on 20 Oct 2026", each item available to agents or not (and why), and the honest line: adopting
// offers material, it doesn't prove agents use it. Nothing is shown for a project that didn't start from one.

import { ADOPT_HONESTY, KIND_LABEL, LESSONS_DOC, recordHeadline, type AdoptRecord } from '../../../shared/adopt-from';
import { h } from '../dom';
import { adoptApi } from './api';
import './record.css';

export function recordView(r: AdoptRecord): HTMLElement {
  return h(
    'div.ad-rec',
    {},
    h('p.ad-rec-h', {}, h('strong', {}, `${recordHeadline(r)}`), r.by ? ` by ${r.by}` : ''),
    h('ul.ad-rec-items', {}, ...r.items.map((i) => h('li', { 'data-status': i.status }, h('span.ad-rec-k', {}, `${i.status === 'available' ? '✓' : '⚠️'} ${KIND_LABEL[i.kind]}`), h('span', {}, i.text)))),
    h('p.setting-note', {}, `${ADOPT_HONESTY} Project knowledge of the source app wasn’t copied: `, h('a', { href: LESSONS_DOC, target: '_blank', rel: 'noopener' }, 'how lessons are shared'), '.'),
  );
}

/** The part, filled once the office answers; empty (and hidden) for a project that didn't start from another app. */
export function adoptedPart(floor: string, gone: () => boolean): HTMLElement {
  const box = h('div.ad-part', { hidden: true });
  adoptApi.record(floor).then(
    (r) => {
      if (gone() || !r) return;
      box.replaceChildren(h('h3', {}, 'Started from another app'), recordView(r));
      box.hidden = false;
    },
    () => undefined,
  );
  return box;
}
