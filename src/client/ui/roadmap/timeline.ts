// The Roadmap's timeline (shared/phases/timeline.ts the geometry): a lane per phase between Discovery and
// Cutover, each with its name and status, a bar on the date axis (done green, active filled to its share of rows
// done, at checkpoint purple, planned dashed, early work hatched), a diamond where it stops for the Project
// Manager (filled once passed), the today line, the overlap bands with their tag, spend against the estimate
// with the soft badge, and whether it publishes at the end. Clicking a lane selects the phase.

import { bands, dayWord, pct, rangeOf, ticks } from '../../../shared/phases/timeline';
import { percentDone, rangeText, usd, type PhaseLine, type PhasesView } from '../../../shared/phases/view';
import { h } from '../dom';

const STATUS_WORD: Record<PhaseLine['status'], string> = { planned: 'Planned', active: 'Active', checkpoint: 'At checkpoint', done: 'Done', stopped: 'Stopped' };
const STATUS_CLS: Record<PhaseLine['status'], string> = { planned: 'plan', active: 'active', checkpoint: 'cp', done: 'done', stopped: 'bad' };
const BADGE_CLS = { ok: 'ok', pace: 'warn', upper: 'warn', over: 'bad', none: '' } as const;

export const statusBadge = (s: PhaseLine['status']) => h(`span.rm-badge.b-${STATUS_CLS[s]}`, {}, STATUS_WORD[s]);

/** The spend cell: "$65 of $90–130", the badge, and the meter with the range shaded. */
export function spendCell(l: Pick<PhaseLine, 'spend' | 'estimate' | 'badge'>): HTMLElement {
  const scale = Math.max(l.estimate.max * 1.15, l.spend, 1);
  const tone = l.badge.kind === 'over' ? 'bad' : l.badge.kind === 'pace' || l.badge.kind === 'upper' ? 'warn' : '';
  return h(
    'div.rm-spend',
    {},
    h('div.rm-spend-v', {}, h('b', {}, usd(l.spend)), h('span.rm-muted', {}, ` of ${rangeText(l.estimate)}`), l.badge.kind !== 'none' ? h(`span.rm-badge.sm.b-${BADGE_CLS[l.badge.kind]}`, { title: 'A soft warning only: the project total keeps its own auto-pause' }, l.badge.kind === 'over' || l.badge.kind === 'pace' ? `⚠ ${l.badge.text}` : l.badge.text) : null),
    h(
      'div.rm-meter',
      { role: 'img', 'aria-label': `${usd(l.spend)} spent of ${rangeText(l.estimate)}` },
      l.estimate.max > 0 ? h('i.rm-rng', { style: `left:${(100 * l.estimate.min) / scale}%;width:${(100 * (l.estimate.max - l.estimate.min)) / scale}%` }) : null,
      h(`i.rm-sp${tone ? `.${tone}` : ''}`, { style: `width:${Math.min(100, (100 * l.spend) / scale)}%` }),
    ),
  );
}

/** The published cell: when it was published (part 2 records it), "Phase end" ahead, or — without publish. */
function publishCell(l: PhaseLine): HTMLElement {
  if (l.deploy?.state === 'published' && l.deploy.at) return h('span.rm-dep', { title: `Published ${l.deploy.revision ? `@${l.deploy.revision.slice(0, 7)}` : ''}` }, `🚀 ${dayWord(l.deploy.at)}`);
  if (!l.publish) return h('span.rm-muted', {}, '—');
  if (l.status === 'done') return h('span.rm-muted', { title: 'Publishing at phase end comes with part 2: the office prepares it, one click in Studio Pro' }, 'To publish');
  return h('span.rm-muted', {}, 'Phase end');
}

export function timeline(v: PhasesView, selected: string | undefined, select: (id: string) => void): HTMLElement {
  const r = rangeOf(v);
  const at = (t: number) => `${pct(r, t).toFixed(2)}%`;
  const width = (a: number, b: number) => `${Math.max(0.8, pct(r, b) - pct(r, a)).toFixed(2)}%`;
  const grid = () => ticks(r).map((t) => h('i.rm-gridline', { style: `left:${at(t.at)}` }));
  const head = h('div.rm-tl-head', {}, h('div', {}, 'Phase'), h('div.rm-axis', {}, ...ticks(r).map((t) => h('span', { style: `left:${at(t.at)}` }, t.label))), h('div', {}, 'Spend vs estimate'), h('div', {}, 'Published'));

  const sub = (name: string, word: string, from: number | undefined, to: number | undefined, money: string, cls: string) =>
    h(
      'div.rm-lane.sub',
      {},
      h('div.rm-lname', {}, h('span.rm-n', {}, '·'), h('span.rm-t', {}, name), h('span.rm-badge.b-plan', {}, word)),
      h('div.rm-track', {}, ...grid(), from !== undefined && to !== undefined && to > from ? h(`span.rm-bar.${cls}`, { style: `left:${at(from)};width:${width(from, to)}` }, cls === 'disc' ? '◀ P–4' : '') : null),
      h('div.rm-spend', {}, h('span.rm-muted', {}, money)),
      h('div', {}, h('span.rm-muted', {}, '—')),
    );

  const lanes = v.phases.map((l) => {
    const s = l.span;
    const p = percentDone(l);
    const cls = l.status === 'done' ? 'done' : l.status === 'active' ? 'active' : l.status === 'checkpoint' ? 'cp' : l.status === 'stopped' ? 'stop' : 'plan';
    const bar = h(`span.rm-bar.${cls}`, { style: `left:${at(s.start)};width:${width(s.start, s.end)};--p:${p}%`, title: `${dayWord(s.start)} – ${dayWord(s.end)}${s.actual ? '' : ' (forecast)'}` }, l.status === 'active' ? `${p}%` : '');
    const early = s.earlyFrom !== undefined ? h('span.rm-bar.design', { style: `left:${at(s.earlyFrom)};width:${width(s.earlyFrom, s.start)}`, title: `${l.early?.what ?? 'Early work'} since ${dayWord(s.earlyFrom)}` }, l.early?.what ?? 'early') : null;
    const dia = l.checkpoint ? h(`i.rm-cp${l.status === 'done' ? '.ok' : l.status === 'checkpoint' ? '.now' : ''}`, { style: `left:${at(s.end)}`, title: l.status === 'done' ? 'Checkpoint passed' : 'Stops for your review here' }) : null;
    return h(
      'div.rm-lane',
      { class: `s-${cls}${l.id === selected ? ' sel' : ''}`, role: 'button', tabindex: 0, 'aria-pressed': String(l.id === selected), 'data-phase': l.id, 'aria-label': `Phase ${l.order}, ${l.name}: ${STATUS_WORD[l.status]}`, onclick: () => select(l.id), onkeydown: (e: Event) => ((e as KeyboardEvent).key === 'Enter' || (e as KeyboardEvent).key === ' ') && (e.preventDefault(), select(l.id)) },
      h('div.rm-lname', {}, h('span.rm-n', {}, String(l.order)), h('span.rm-t', { title: l.name }, l.name), l.overlaps.length && l.early ? h('span.rm-badge.b-overlap', {}, `Overlaps ${l.overlaps.join(', ')}`) : statusBadge(l.status), l.foundation ? h('span.rm-badge.b-found', { title: 'Foundation phase' }, 'F') : null),
      h('div.rm-track', {}, ...grid(), early, bar, dia),
      spendCell(l),
      h('div', {}, publishCell(l)),
    );
  });

  const lanesEl = h(
    'div.rm-tl-body',
    {},
    sub('Discovery', v.discovery.done ? 'Done' : 'In progress', v.discovery.start ?? (v.discovery.end ? v.discovery.end - 7 * 86_400_000 : undefined), v.discovery.end, `${usd(v.discovery.spend)} spent`, 'disc'),
    ...lanes,
    sub('Cutover', 'Later', v.cutover.start, v.cutover.end, v.cutover.estimate ? `${rangeText(v.cutover.estimate)} est.` : v.cutover.spend ? `${usd(v.cutover.spend)} spent` : '—', 'plan'),
  );
  // The today line and the overlaps, over the tracks' column (laid out by CSS: the overlay sits in the track column).
  const over = h('div.rm-overlay', { 'aria-hidden': 'true' }, h('i.rm-today', { style: `left:${at(v.now)}` }), h('span.rm-today-l', { style: `left:${at(v.now)}` }, `Today ${dayWord(v.now)}`));
  const n = v.phases.length + 2;
  for (const b of bands(v.phases)) {
    const top = `${(100 * b.a) / n}%`;
    const height = `${(100 * (b.b - b.a + 1)) / n}%`;
    over.append(h('i.rm-band', { style: `left:${at(b.from)};width:${width(b.from, b.to)};top:${top};height:${height}` }), h('span.rm-band-tag', { style: `${pct(r, b.to) > 55 ? `left:calc(${at(b.from)} - 6px);transform:translateX(-100%)` : `left:calc(${at(b.to)} + 6px)`};top:calc(${(100 * (b.a + 0.5)) / n}% - 9px)`, title: b.label }, `Overlap ${b.a} ↔ ${b.b}`));
  }
  lanesEl.append(over);

  const legend = h(
    'div.rm-legend',
    {},
    ...(
      [
        ['done', 'Done'],
        ['active', 'Active (filled = rows done)'],
        ['cp', 'At checkpoint'],
        ['plan', 'Planned'],
        ['design', 'Started early / overlap'],
      ] as const
    ).map(([c, t]) => h('span', {}, h(`i.rm-key.${c}`), t)),
    h('span', {}, h('i.rm-key-cp'), 'Checkpoint (filled = passed)'),
    h('span', {}, h('i.rm-key-today'), 'Today'),
    h('span.rm-legend-un', {}, `Not tied to a phase (coordination, reviews): ${usd(v.unassigned)}`),
  );
  return h('div.rm-tl', { role: 'group', 'aria-label': 'Phases on a timeline' }, h('div.rm-tl-scroll', { tabindex: 0, 'aria-label': 'Timeline (scrolls sideways when narrow)' }, h('div.rm-tl-inner', {}, head, lanesEl)), legend);
}
