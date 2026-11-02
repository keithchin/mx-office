// The Overview's phase strip (Portal's Progress card, through ui/portal/progress-extras.ts), only for a project
// delivered in phases: the Build stage is widened and named after the phase in progress ("5 Build · Events
// (3 of 8)", "2 phases done · Social design started early"), and under the stages one box says the phase, its
// share of rows done, its spend against the estimate with the soft badge, what overlaps it and when its
// checkpoint is expected, over a chip per phase (click: that phase on the Roadmap). A project without phases
// gets nothing (the card is exactly as before), except an admin at the Build Plan gate: one line offering to set
// phases up from the build plan. It draws from ./state.ts's answer, which the navigation shares.

import { openProjectTab } from '../../tabs/host';
import { h } from '../dom';
import { dayWord } from '../../../shared/phases/timeline';
import { buildHeadline, percentDone, rangeText, usd, type PhasesView } from '../../../shared/phases/view';
import { isFull, pick } from './api';
import { onPhases } from './state';
import './strip.css';

/** The two words under the Build stage: phases done and what started early. */
export function buildDetail(v: Pick<PhasesView, 'phases'>): string {
  const done = v.phases.filter((l) => l.status === 'done').length;
  const early = v.phases.find((l) => l.early && l.status === 'planned');
  return [`${done} phase${done === 1 ? '' : 's'} done`, early ? `${early.name} ${early.early!.what} started early` : ''].filter(Boolean).join(' · ');
}

const css = (s: string) => JSON.stringify(s);

export function phaseStrip(card: HTMLElement): void {
  const box = h('div.ph-strip', { hidden: true, role: 'group', 'aria-label': 'Build phases' });
  card.append(box);
  let drawn = '';

  const off = () => {
    card.classList.remove('ph-phased');
    box.hidden = true;
    box.classList.remove('ph-offer');
    drawn = '';
  };
  /** At the Build Plan gate, for an admin of a project without phases: one quiet line to set them up. */
  function offer(n: number) {
    const key = `offer|${n}`;
    if (key === drawn) return;
    drawn = key;
    card.classList.remove('ph-phased');
    box.classList.add('ph-offer');
    box.replaceChildren(h('div.ph-line1', {}, h('span.ph-muted', {}, `Build Plan gate: Build can be delivered in ${n} phases from the build plan's own headings (a foundation first), each proven by its journeys.`), h('span.ph-grow'), h('button.pt-link.ph-open', { type: 'button', onclick: () => openProjectTab('roadmap') }, 'Set up phases from the build plan →')));
    box.hidden = false;
  }
  onPhases((v) => {
    if (!v) return off();
    if (isFull(v)) return draw(v);
    if ('offer' in v && v.offer && v.admin) return offer(v.offer);
    off();
  });

  function draw(v: PhasesView) {
    if (v.plan.state === 'none' || !v.phases.length) return off();
    const key = JSON.stringify({ ...v, now: 0 });
    if (key === drawn) return;
    drawn = key;
    const head = buildHeadline(v);
    const cur = head.phase;
    card.classList.add('ph-phased');
    card.style.setProperty('--ph-build-n', css(v.plan.state === 'proposed' ? '5 Build · phases proposed' : `5 ${head.text}`));
    card.style.setProperty('--ph-build-d', css(v.plan.state === 'proposed' ? 'waiting for the Build Plan gate' : buildDetail(v)));
    const total = v.phases.reduce((n, l) => n + Math.max(1, l.rows.length), 0);
    card.style.setProperty(
      '--ph-build-bar',
      `linear-gradient(90deg, ${v.phases
        .reduce<{ at: number; parts: string[] }>(
          (acc, l) => {
            const w = (100 * Math.max(1, l.rows.length)) / total;
            const c = l.status === 'done' ? 'var(--good)' : l.status === 'checkpoint' ? 'var(--purple)' : l.status === 'active' ? 'var(--accent)' : l.early ? 'var(--purple-soft)' : 'var(--line)';
            const gap = `var(--card, #fff)`;
            acc.parts.push(`${c} ${acc.at.toFixed(2)}%`, `${c} ${(acc.at + w - 0.6).toFixed(2)}%`, `${gap} ${(acc.at + w - 0.6).toFixed(2)}%`, `${gap} ${(acc.at + w).toFixed(2)}%`);
            acc.at += w;
            return acc;
          },
          { at: 0, parts: [] },
        )
        .parts.join(', ')})`,
    );
    const overl = v.phases.filter((l) => l.early && l.status === 'planned');
    const line1 = h(
      'div.ph-line1',
      {},
      h('b', {}, cur ? `${head.text}` : head.text),
      cur ? h('span.ph-dot', {}, '·') : null,
      cur ? h('span', {}, `${percentDone(cur)}%`) : null,
      cur ? h('span.ph-dot', {}, '·') : null,
      cur ? h('span', {}, `${usd(cur.spend)} of ${rangeText(cur.estimate)}`) : null,
      cur && cur.badge.kind !== 'none' && cur.badge.kind !== 'ok' ? h(`span.ph-badge.${cur.badge.kind === 'over' ? 'bad' : 'warn'}`, { title: 'A soft warning only: the project total keeps its own auto-pause' }, `⚠ ${cur.badge.text}`) : null,
      overl.length ? h('span.ph-badge.ovl', {}, `Overlaps: ${overl.map((l) => `${l.name} ${l.early!.what}`).join(', ')}`) : null,
      h('span.ph-grow'),
      cur && cur.checkpoint && cur.status === 'active' ? h('span.ph-muted', {}, `Checkpoint expected ~${dayWord(cur.span.end)}`) : cur?.status === 'checkpoint' ? h('span.ph-muted', {}, 'At its checkpoint: waiting for you') : null,
      h('button.pt-link.ph-open', { type: 'button', onclick: () => openProjectTab('roadmap') }, 'Open Roadmap →'),
    );
    const chips = h(
      'div.ph-chips',
      { style: `grid-template-columns: repeat(${Math.min(v.phases.length, 8)}, minmax(0, 1fr))` },
      ...v.phases.map((l) => {
        const cls = l.status === 'done' ? 'done' : l.status === 'active' ? 'active' : l.status === 'checkpoint' ? 'cp' : l.early ? 'ovl' : 'plan';
        const sub = l.status === 'done' ? `✓ ${usd(l.spend)}` : l.status === 'active' ? `${percentDone(l)}% · ${usd(l.spend)}` : l.status === 'checkpoint' ? 'At checkpoint' : l.early ? `${l.early.what[0].toUpperCase()}${l.early.what.slice(1)} started` : rangeText(l.estimate);
        return h('button.ph-chip', { type: 'button', class: cls, title: `${l.order} ${l.name}: ${l.status}`, onclick: () => ((pick.phase = l.id), openProjectTab('roadmap')) }, h('span.ph-t', {}, `${l.order} ${l.name}`), h('span.ph-s', {}, sub));
      }),
    );
    box.classList.remove('ph-offer');
    box.replaceChildren(line1, chips);
    box.hidden = false;
  }
}
