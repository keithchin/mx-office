// The session screen's phase strip: the project's phases from the Roadmap's data (ui/roadmap/state.ts, the
// same answer the navigation and the Overview's strip use), only for a phased project: the phase in progress,
// its rows done and spend against its estimate, the next checkpoint, and a chip per phase. A click opens the
// Roadmap (on that phase for a chip). Hidden for a project delivered in one go.

import { openProjectTab } from '../../tabs/host';
import { h } from '../dom';
import { dayWord } from '../../../shared/phases/timeline';
import { buildHeadline, percentDone, rangeText, usd, type PhasesView } from '../../../shared/phases/view';
import { isFull, pick } from '../roadmap/api';
import { onPhases } from '../roadmap/state';
import '../roadmap/strip.css';

export function phaseBar(): HTMLElement {
  const el = h('div.xs-phases', { hidden: true, role: 'group', 'aria-label': 'Build phases' });
  let drawn = '';
  onPhases((v) => {
    if (!v || !isFull(v) || v.plan.state === 'none' || !v.phases.length) {
      el.hidden = true;
      drawn = '';
      return;
    }
    draw(v);
  });
  function draw(v: PhasesView) {
    const key = JSON.stringify({ ...v, now: 0 });
    if (key === drawn) return;
    drawn = key;
    const head = buildHeadline(v);
    const cur = head.phase;
    const ok = !cur || cur.badge.kind === 'ok' || cur.badge.kind === 'none';
    const info = h(
      'button.xs-ph-info',
      { type: 'button', title: 'Open the Roadmap', onclick: () => openProjectTab('roadmap') },
      h('span.xs-ph-t', {}, h('b', {}, cur ? `Phase ${cur.order} of ${v.phases.length} · ${cur.name}` : head.text), cur ? h('span.ph-badge.xs-ph-pct', {}, `${percentDone(cur)}% · ${cur.rowsDone} of ${cur.rows.length} rows`) : null),
      cur
        ? h(
            'span.xs-ph-s',
            {},
            `${usd(cur.spend)} of ${rangeText(cur.estimate)} `,
            ok ? h('span.ph-badge.xs-ok', {}, 'on budget') : h(`span.ph-badge.${cur.badge.kind === 'over' ? 'bad' : 'warn'}`, {}, cur.badge.text),
            cur.checkpoint && cur.status === 'active' ? ` · Checkpoint ~${dayWord(cur.span.end)}` : '',
          )
        : null,
    );
    const chips = h(
      'div.ph-chips.xs-ph-chips',
      { style: `grid-template-columns: repeat(${Math.min(v.phases.length, 8)}, minmax(0, 1fr))` },
      ...v.phases.map((l) => {
        const cls = l.status === 'done' ? 'done' : l.status === 'active' ? 'active' : l.status === 'checkpoint' ? 'cp' : l.early ? 'ovl' : 'plan';
        const sub = l.status === 'done' ? `✓ ${usd(l.spend)}` : l.status === 'active' ? `${percentDone(l)}% · ${usd(l.spend)}` : l.status === 'checkpoint' ? 'At checkpoint' : `est. ${rangeText(l.estimate)}`;
        return h('button.ph-chip', { type: 'button', class: cls, title: `${l.order} ${l.name}: ${l.status}`, onclick: () => ((pick.phase = l.id), openProjectTab('roadmap')) }, h('span.ph-t', {}, `${l.order} ${l.name}`), h('span.ph-s', {}, sub));
      }),
    );
    el.replaceChildren(info, chips);
    el.hidden = false;
  }
  return el;
}
