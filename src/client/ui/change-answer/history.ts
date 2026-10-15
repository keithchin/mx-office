// A decision's revision history (Slice 1B-3): a small "History (3 revisions)" fold on a resolved
// escalation's card, a follow-through item and a sent question's card. Nothing is fetched when the card is
// drawn: the first time it's opened it asks for the decision's detail (api.ts, once per revision), read from
// the answer store, so every revision shows with its full text even after the escalation's or the book's
// bounded copies rolled over. Admins only (the server checks too).

import type { AnswerDetail, HistoryRev } from '../../../shared/change-answer';
import { historyTitle, KIND_WORDS, revDispatchWords, revOutcomeWords } from '../../../shared/change-answer';
import { h, timeAgo } from '../dom';
import { loadDetail } from './api';

/** One revision's row: rev, kind, the full text, who and when, how it was handed on, and what came of it. */
export function revRow(r: HistoryRev, current: number): HTMLElement {
  const text = [r.option && !r.text.includes(r.option) ? r.option : '', r.text].filter(Boolean).join(': ');
  return h(
    'li.ca-rev',
    { 'data-rev': String(r.rev), class: r.rev === current ? 'ca-current' : '' },
    h('p.ca-rev-h', {}, h('b', {}, `rev ${r.rev}`), ` · ${KIND_WORDS[r.kind]}`, r.supersedes ? ` · replaces rev ${r.supersedes}` : '', r.rev === current ? h('span.ca-now', {}, 'current') : null),
    text ? h('p.ca-rev-text', {}, text) : null,
    h('p.ca-rev-meta', {}, `${r.by} · ${new Date(r.at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })} (${timeAgo(r.at)})`),
    h('p.ca-rev-meta', {}, h('span', {}, 'Sent: '), revDispatchWords(r), h('span', {}, ' · Follow-through: '), revOutcomeWords(r)),
  );
}

/** The rows, newest first. */
export const historyList = (d: AnswerDetail) => h('ol.ca-revs', { reversed: true }, ...[...d.revs].reverse().map((r) => revRow(r, d.rev)));

/** The fold: drawn closed with its count, filled the first time it's opened. */
export function historyFold(floor: string, decision: string, rev: number): HTMLElement {
  const body = h('div.ca-hist-body', {}, h('p.ca-rev-meta', {}, 'Loading…'));
  let asked = false;
  const fold = h('details.ca-hist', { 'data-decision': decision }, h('summary', {}, historyTitle(rev)), body) as HTMLDetailsElement;
  fold.addEventListener('toggle', () => {
    if (!fold.open || asked) return;
    asked = true;
    void loadDetail(floor, decision, rev).then((d) => {
      if (typeof d === 'string') {
        asked = false;
        return void body.replaceChildren(h('p.ca-rev-meta', {}, d));
      }
      (fold.querySelector('summary') as HTMLElement).textContent = historyTitle(d.revs.length);
      body.replaceChildren(historyList(d));
    });
  });
  return fold;
}
