// The ranking's pieces on a worker: its grade badge, its rank chips, the Details panel with every
// criterion as a bar and the evidence behind it, and the card for a worker that has gone home. The
// little pixel robot in the worker's color is here too, for the cards and the podium. No three.js.

import type { Criterion, Grade } from '../../../shared/ranking/model';
import type { RankedWorker } from '../../../shared/ranking/report';
import { h, timeAgo } from '../dom';

/** A robot on a 9×9 grid: a antenna, h head, e eyes and mouth, b body. */
const ROBOT = ['....a....', '..hhhhh..', '..heheh..', '..hhhhh..', '...heh...', '.bbbbbbb.', 'b.bbbbb.b', '..bbbbb..', '..b...b..'];

export function robot(color: string, size = 28): SVGSVGElement {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 9 9');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('shape-rendering', 'crispEdges');
  svg.setAttribute('aria-hidden', 'true');
  svg.classList.add('rk-robot');
  ROBOT.forEach((row, y) =>
    [...row].forEach((c, x) => {
      if (c === '.') return;
      const r = document.createElementNS(ns, 'rect');
      r.setAttribute('x', String(x));
      r.setAttribute('y', String(y));
      r.setAttribute('width', '1');
      r.setAttribute('height', '1');
      r.setAttribute('fill', c === 'h' || c === 'b' ? color : 'currentColor');
      svg.append(r);
    }),
  );
  return svg;
}

/** A gone-home worker's color isn't kept: one from its name, the same every time. */
export function colorOf(w: Pick<RankedWorker, 'color' | 'name'>): string {
  if (w.color) return w.color;
  let n = 0;
  for (const c of w.name) n = (n * 31 + c.charCodeAt(0)) >>> 0;
  return `hsl(${n % 360} 65% 58%)`;
}

export function gradeBadge(grade: Grade | undefined, score: number | undefined, big = true): HTMLElement {
  const title = grade ? `Grade ${grade}: ${score?.toFixed(0)} of 100` : 'Not graded yet: no finished task to go on';
  return h(`span.rk-grade.g-${grade ?? 'none'}${big ? '.big' : ''}`, { title, 'aria-label': title }, h('b', {}, grade ?? '–'), big && score !== undefined ? h('small', {}, score.toFixed(0)) : null);
}

const ord = (n: number | undefined, of: number) => (n ? `#${n}${of > 1 ? ` of ${of}` : ''}` : undefined);

export function rankChips(r: RankedWorker, scope: 'floor' | 'all'): HTMLElement {
  const k = r.rank;
  const chips = [
    scope === 'all' && k.global ? `${ord(k.global, k.of.global)} overall` : undefined,
    k.floor ? `${ord(k.floor, k.of.floor)} on floor` : undefined,
    k.model ? `${ord(k.model, k.of.model)} ${r.modelLabel}` : undefined,
    k.role ? `${ord(k.role, k.of.role)} ${r.role === 'worker' ? 'workers' : r.roleLabel}` : undefined,
  ].filter((v): v is string => !!v);
  return h(
    'span.rk-chips',
    {},
    ...chips.map((c) => h('span.rk-chip', {}, c)),
    r.trend ? h(`span.rk-trend.${r.trend > 0 ? 'up' : 'down'}`, { title: 'Since its last recorded day' }, `${r.trend > 0 ? '▲' : '▼'} ${Math.abs(r.trend).toFixed(0)}`) : null,
    h(`span.rk-conf.${r.confidence}`, { title: 'How much data is behind the grade' }, `${r.confidence} confidence`),
  );
}

const pct = (w: number) => `${Math.round(w * 100)}%`;

function criterionView(c: Criterion): HTMLElement {
  return h(
    `div.rk-crit${c.score === undefined ? '.missing' : ''}`,
    {},
    h(
      'div.rk-crit-top',
      {},
      h('span.rk-crit-name', {}, c.label),
      h('span.rk-weight', { title: 'Its weight in the score' }, pct(c.weight)),
      c.score !== undefined ? gradeBadge(c.grade, c.score, false) : null,
      h('span.rk-crit-score', {}, c.score !== undefined ? c.score.toFixed(0) : 'n/a'),
      c.confidence && c.score !== undefined ? h(`span.rk-conf.${c.confidence}`, {}, c.confidence) : null,
    ),
    c.score !== undefined ? h('div.rk-meter', { role: 'meter', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(Math.round(c.score)), 'aria-label': c.label }, h(`span.rk-fill.g-${c.grade}`, { style: `width:${Math.max(2, c.score)}%` })) : h('p.rk-missing', {}, `Not enough data: ${c.missing ?? 'nothing to go on yet'}`),
    c.evidence.length ? h('ul.rk-evidence', {}, ...c.evidence.map((e) => h('li', {}, e))) : null,
  );
}

export function details(r: RankedWorker, share: number): HTMLElement {
  return h(
    'div.rk-details',
    {},
    r.highlights.length
      ? h('div.rk-highlights', {}, h('h4', {}, 'Highlights', h('small', {}, r.highlights[0].by === 'ai' ? ' · written by Claude Haiku from the evidence' : ' · from the records')), h('ul', {}, ...r.highlights.map((x) => h('li', {}, `🏆 ${x.text}`))))
      : null,
    h('h4', {}, 'Standard criteria'),
    ...r.standard.map(criterionView),
    r.specialist
      ? h(
          'div.rk-special',
          {},
          h('h4', {}, `🎖 ${r.specialist.label} `, gradeBadge(r.specialist.grade, r.specialist.score, false), h('small', {}, ` · ${pct(share)} of the overall score`)),
          ...r.specialist.criteria.map(criterionView),
        )
      : null,
  );
}

/** Its strip under the card: the rank chips and the Details toggle, and the panel when it's open. */
export function rankFooter(r: RankedWorker, scope: 'floor' | 'all', share: number, open: boolean, toggle: () => void): HTMLElement[] {
  const id = `rk-d-${r.key.replace(/[^A-Za-z0-9_-]/g, '_')}`;
  const foot = h('div.rk-foot', {}, rankChips(r, scope), h('button.btn.rk-toggle', { type: 'button', 'aria-expanded': String(open), 'aria-controls': id, onclick: toggle }, open ? 'Details ▴' : 'Details ▾'));
  if (!open) return [foot];
  const d = details(r, share);
  d.id = id;
  return [foot, d];
}

/** A worker only the records know (gone home, or on another floor). */
export function recordCard(r: RankedWorker, scope: 'floor' | 'all'): HTMLElement {
  const where = [r.roleLabel !== 'Worker' ? `🎖 ${r.roleLabel}` : '👷 Worker', `⚙️ ${r.modelLabel}`, scope === 'all' ? `🏢 ${r.floorName}` : undefined, `${r.tasks} task${r.tasks === 1 ? '' : 's'}`].filter(Boolean).join(' · ');
  return h(
    'div.lite-card.rk-record',
    {},
    h('span.rk-bot', { style: `color:var(--ink)` }, robot(colorOf(r), 22)),
    h('span.lite-info', {}, h('span.lite-name', {}, r.name), h('span.lite-sub', {}, where), h('span.lite-now', {}, r.gone ? `🏠 Gone home · last seen ${timeAgo(r.lastSeen)}` : `On ${r.floorName} now`)),
    h('span.lite-state', {}, h('span.pill', { class: r.gone ? 'exited' : (r.status ?? '') }, r.gone ? 'gone home' : (r.status ?? 'at work'))),
  );
}
