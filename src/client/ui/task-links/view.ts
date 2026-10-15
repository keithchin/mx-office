// A decision revision's task links on the page (Slice 1B-4): each link with its strength and its evidence
// levels, worded by shared/task-links.ts (`Task tsk_… "Visitor checkout" (Linus): candidate · acknowledged ·
// associated change PR #98 · checks passed on the associated change @e77a0d3`), a person's acceptance as
// "Implemented as decided", and, when nothing is there, "No links found" or the person's stated "No
// implementation work required", never one for the other. Pure rendering from what the server sent: no
// fetch, nothing worked out per redraw beyond these few strings.

import type { DecisionLinks, TaskLink } from '../../../shared/task-links';
import { implementedWords, linkWords, noneWords } from '../../../shared/task-links';
import { h } from '../dom';
import './task-links.css';

function row(l: TaskLink): HTMLElement {
  return h('li.tl-link', { 'data-strength': l.strength, title: l.via }, h('span.tl-tag', { 'data-strength': l.strength }, l.strength), h('span.tl-words', {}, linkWords(l)));
}

/**
 * The links as a list (at most `max`, then "+n more"), the implemented line, or the none line when there
 * are no links and `others` (the explicit 1B-3 links shown beside them) is 0 too. Null when there's
 * nothing to say and `quiet` (the follow-through line shows nothing rather than "No links found").
 */
export function taskLinksList(d: DecisionLinks | undefined, o: { others?: number; max?: number; quiet?: boolean } = {}): HTMLElement | null {
  const links = d?.links ?? [];
  const max = o.max ?? links.length;
  const shown = links.slice(0, max);
  const parts: (HTMLElement | null)[] = [];
  if (shown.length) parts.push(h('ul.tl-links', {}, ...shown.map(row), links.length > max ? h('li.tl-more', {}, `+${links.length - max} more`) : null));
  if (d?.implemented) parts.push(h('p.tl-implemented', {}, implementedWords(d.implemented)));
  if (!links.length && !(o.others ?? 0)) {
    if (o.quiet && !d?.noWorkRequired) return parts.length ? h('div.tl-box', {}, ...parts) : null;
    parts.push(h('p.tl-none', { 'data-kind': d?.noWorkRequired ? 'no-work' : 'none' }, noneWords(d)));
  }
  return parts.length ? h('div.tl-box', {}, ...parts) : null;
}
