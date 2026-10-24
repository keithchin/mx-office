// Project Management's view of the Developer changes, on Approvals: the same record the Developer view reads
// (./feed.ts, GET /api/dev-changes), never a copy — the change with the team and the queue behind it, with the
// revision strip and Cancel for a change that hasn't started. Hidden while nothing is in flight. Approvals is
// drawn again on every roster update: the card draws from what the feed holds and redraws itself when it answers.

import { h } from '../dom';
import type { DevChangesView } from '../../../shared/dev-changes';
import { devFeed } from './feed';
import { changeRow, revisionStrip } from './view';

let last: { el: HTMLElement; floor: string } | undefined;
let listening = false;
let asked = 0;

function fill(el: HTMLElement, floor: string, v: DevChangesView | undefined) {
  const live = (v?.changes ?? []).filter((c) => c.queue === 'active' || c.queue === 'queued' || c.queue === 'clarify');
  el.hidden = !live.length;
  if (!live.length) return void el.replaceChildren();
  const queued = live.filter((c) => c.queue === 'queued').length;
  el.replaceChildren(
    h('h4', {}, 'Developer changes'),
    h('p.dc-small', {}, `One change is worked on at a time${queued ? `; ${queued} queued behind it` : ''}. The same record as the Developer view’s Requests.`),
    revisionStrip(v),
    h('ul.dc-list', {}, ...live.map((c) => h('li', {}, changeRow(floor, c)))),
  );
}

/** The Approvals card for this project's Developer changes (empty and hidden while none is in flight). */
export function devChangesCard(floor: string): HTMLElement {
  const el = h('section.dc-pm', { 'aria-label': 'Developer changes', hidden: true });
  last = { el, floor };
  if (!listening) {
    listening = true;
    devFeed.on(() => last && last.el.isConnected && fill(last.el, last.floor, devFeed.get(last.floor)));
  }
  fill(el, floor, devFeed.get(floor));
  // The team moved (that's what redraws Approvals): ask again, at most every 10 s.
  const now = Date.now();
  if (!devFeed.get(floor)) devFeed.want(floor);
  else if (now - asked > 10_000) devFeed.again(floor);
  if (now - asked > 10_000) asked = now;
  return el;
}
