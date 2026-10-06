// Jeff, the Router, in the 1D view: his portrait (the 2D view's pixel character, cropped to head and
// shoulders), his status pill, and his section on the Analysis tab: per judgement its mode, how often
// he agrees with the office's own rule, Jev vs Haiku, latency, agreement by day, and the latest
// disagreements, so after a week the Project Manager can judge where to switch him to On. It asks
// GET /api/judge. No three.js here.

import type { JeffMode, JeffStatus, JudgeKind, JudgeKindSummary, JudgeRow, JudgeSummary } from '../../shared/judge';
import { JEFF_LOOK, standing } from '../pixel/chars';
import { h, timeAgo } from './dom';
import './jeff.css';

export const JEFF_MODE_LABEL: Record<JeffMode, string> = { off: 'Off', shadow: 'Shadow: watch, don’t act', on: 'On: act' };
const MODE_CHIP: Record<JeffMode, string> = { off: 'Off', shadow: 'Shadow', on: 'On' };
export const KIND_LABEL: Record<JudgeKind, string> = { waiting: '🙋 Waiting on you', triage: '🏷️ Issue triage', priority: '🔢 Escalation priority' };
const KIND_WHAT: Record<JudgeKind, string> = {
  waiting: 'When an agent ends its turn: is it waiting on you? The office’s rule: it has an open escalation that isn’t an FYI.',
  triage: 'When a new issue appears: which team is it for? The office’s rule: its team: label, if it has one.',
  priority: 'When an escalation is raised: how soon should you resolve it? The lists show his order. The office’s rule: loudest, then newest.',
};
const KIND_WORD: Record<JudgeKind, string> = { waiting: 'waiting', triage: 'triage', priority: 'priority' };
export const STATUS_WORDS: Record<JeffStatus['state'], string> = { jev: 'Jev live', haiku: 'on Haiku', unavailable: 'unavailable' };

/** What he's called right now: Jeff (Jev), or Jeff (on Haiku) on the fallback. */
export const jeffName = (s?: JeffStatus) => (s?.state === 'haiku' ? 'Jeff (on Haiku)' : 'Jeff (Jev)');

/** His portrait: the 2D view's Jeff from the waist up, `size` CSS pixels tall, pixels kept square. */
export function jeffPortrait(size = 32): HTMLCanvasElement {
  const src = standing(JEFF_LOOK, 'front', false, 0);
  const c = h('canvas.jeff-portrait', { width: 24, height: 24, role: 'img', 'aria-label': 'Jeff, the Router', style: `width:${size}px;height:${size}px` });
  c.getContext('2d')!.drawImage(src, 0, 0, 24, 24, 0, 0, 24, 24);
  return c;
}

export function statusPill(s: JeffStatus): HTMLElement {
  return h(`span.jf-pill.${s.state}`, { title: s.detail }, STATUS_WORDS[s.state]);
}

export async function fetchJudge(floor: string): Promise<JudgeSummary> {
  const res = await fetch(`/api/judge?${new URLSearchParams({ floor })}`, { credentials: 'same-origin' });
  if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? `HTTP ${res.status}`);
  return (await res.json()) as JudgeSummary;
}

export const rateOf = (k: JudgeKindSummary) => (k.compared ? k.agreed / k.compared : undefined);
const pct = (v: number | undefined) => (v === undefined ? '–' : `${Math.round(v * 100)}%`);
const tone = (v: number | undefined) => (v === undefined ? 'none' : v >= 0.85 ? 'good' : v >= 0.65 ? 'mid' : 'low');

/** The Analysis tab's Jeff section for a floor: filled in once GET /api/judge answers; never throws. */
export function jeffSection(floor: string | undefined): HTMLElement {
  const el = h('section.an-card.jf', { id: 'jeff', 'aria-label': 'Jeff, the Router' }, h('p.an-empty', {}, floor ? 'Asking Jeff…' : 'Jeff works per project: open a floor to see his judgements.'));
  if (floor)
    void fetchJudge(floor)
      .then((s) => el.replaceChildren(...jeffBody(s)))
      .catch((err: Error) => el.replaceChildren(h('p.an-error', {}, `Couldn't ask Jeff: ${err.message}`)));
  return el;
}

function jeffBody(s: JudgeSummary): Node[] {
  const modes = s.kinds.map((k) => k.mode);
  const lead = modes.includes('shadow') ? 'Jeff is watching, not acting. Switch to On where he agrees with you.' : modes.every((m) => m === 'off') ? 'Jeff is off on this floor: turn him on in ⚙️ Settings › ⚖️ Jeff · Router.' : 'Jeff is acting on his verdicts.';
  const disagreements = s.rows.filter((r) => r.agree === false);
  return [
    h(
      'header.an-h.jf-h',
      {},
      h('div.jf-who', {}, jeffPortrait(36), h('div', {}, h('h3', {}, 'Jeff · Router'), h('span.jf-sub', {}, `${jeffName(s.status)} · the office’s quick judge`)), statusPill(s.status)),
      h('span.an-hint.jf-lead', {}, lead),
    ),
    h('div.jf-kinds', {}, ...s.kinds.map(kindCard)),
    disagreements.length
      ? h(
          'div.jf-dis',
          {},
          h('h4', {}, `Recent disagreements (${disagreements.length})`),
          h(
            'div.an-scroll',
            {},
            h(
              'table.an-table.jf-table',
              {},
              h('thead', {}, h('tr', {}, ...['When', 'Judgement', 'Subject', 'Jeff said', 'Rule said', 'By'].map((t) => h('th', { scope: 'col' }, t)))),
              h('tbody', {}, ...disagreements.map(row)),
            ),
          ),
        )
      : h('p.an-empty.jf-none', {}, s.rows.length ? 'No disagreements in his latest judgements.' : 'No judgements yet: they appear as agents end their turns and new issues come in.'),
  ];
}

function kindCard(k: JudgeKindSummary): HTMLElement {
  const rate = rateOf(k);
  const most = Math.max(1, ...k.days.map((d) => d.n));
  const bars = h(
    'div.jf-days',
    { role: 'img', 'aria-label': `Agreement by day, last 14 days` },
    ...k.days.map((d) => {
      const r = d.compared ? d.agreed / d.compared : undefined;
      return h('span.jf-day', { title: `${d.day}: ${d.n} judged${d.compared ? `, agreed ${d.agreed} of ${d.compared}` : ''}` }, h(`span.jf-bar.${tone(r)}`, { style: `height:${d.n ? Math.max(12, Math.round((d.n / most) * 100)) : 0}%` }));
    }),
  );
  return h(
    'div.jf-kind',
    {},
    h('div.jf-kind-top', {}, h('b', {}, KIND_LABEL[k.kind]), h(`span.jf-mode.${k.mode}`, {}, MODE_CHIP[k.mode])),
    h('p.jf-what', {}, KIND_WHAT[k.kind]),
    h(
      'div.jf-stats',
      {},
      h(`span.jf-rate.${tone(rate)}`, { title: 'How often Jeff and the office’s rule said the same' }, pct(rate)),
      h('span.jf-facts', {}, h('span', {}, `agree · ${k.agreed}/${k.compared} compared`), h('span', {}, `${k.total} judged · ${k.acted} acted on`), h('span', {}, `Jev ${k.byJev} · Haiku ${k.byHaiku} · avg ${k.avgMs < 1000 ? `${k.avgMs} ms` : `${(k.avgMs / 1000).toFixed(1)} s`}`)),
    ),
    bars,
    h('div.jf-days-l', {}, h('span', {}, '14 days ago'), h('span', {}, 'today')),
  );
}

function row(r: JudgeRow): HTMLElement {
  return h(
    'tr',
    {},
    h('td', { title: new Date(r.at).toLocaleString() }, timeAgo(r.at)),
    h('td', {}, KIND_LABEL[r.kind]),
    h('td.jf-subj', { title: r.text ?? '' }, r.subject),
    h('td', { title: r.detail }, h('b', {}, r.jeff), r.held ? h('small', {}, r.held === 'no-ask' ? ' · held: no real ask' : ' · held: raised already') : null),
    h('td', {}, r.rule),
    h('td', { title: r.model }, `${r.by === 'jev' ? 'Jev' : 'Haiku'} · ${r.ms} ms`),
  );
}

/** Today's judgements and agreement, in a line (the org chart's card, his desk in the 2D view). */
export function todayLine(s: JudgeSummary): string {
  const today = s.kinds.map((k) => k.days[k.days.length - 1]);
  const n = today.reduce((a, d) => a + d.n, 0);
  const compared = today.reduce((a, d) => a + d.compared, 0);
  const agreed = today.reduce((a, d) => a + d.agreed, 0);
  return `${n} judgement${n === 1 ? '' : 's'} today${compared ? ` · agrees ${Math.round((agreed / compared) * 100)}%` : ''}`;
}

/**
 * His card on the org chart, beside the Project Coordinator: staff, not an agent, so no hire, bench
 * or model controls; his status, today's numbers and each judgement's mode, filled in from GET /api/judge.
 */
export function jeffCard(floor: string): HTMLElement {
  const facts = h('p.ro-facts', {}, 'Asking Jeff…');
  const pill = h('span.ro-pill.jf-pill.unavailable', {}, '…');
  const card = h(
    'article.ro-card.jf-card',
    { 'data-role': 'jeff' },
    h('header.ro-card-h', {}, jeffPortrait(30), h('span.ro-who', {}, h('span.ro-name', {}, 'Jeff · Router (Jev)'), h('span.ro-title', {}, 'Staff · the office’s quick judge, not an agent')), pill),
    h('p.ro-subs', {}, 'Routes: what goes to you, and which team an issue goes to.'),
    facts,
    h('div.ro-actions', {}, h('a.btn.small', { href: `/lite?${new URLSearchParams({ tab: 'analysis', floor })}#jeff` }, '📊 His judgements')),
  );
  void fetchJudge(floor)
    .then((s) => {
      pill.replaceWith(statusPill(s.status));
      card.querySelector('.ro-name')!.textContent = `Jeff · Router (${s.status.state === 'haiku' ? 'on Haiku' : 'Jev'})`;
      facts.textContent = `${todayLine(s)} · ${s.kinds.map((k) => `${KIND_WORD[k.kind]}: ${MODE_CHIP[k.mode]}`).join(' · ')}`;
    })
    .catch(() => (facts.textContent = 'Couldn’t reach Jeff'));
  return card;
}
