// The Team tab's Standup view: Run standup, when the next scheduled one is (and whether it'll run:
// only with activity since the last), the standups so far, and the picked one's page with its
// proposals as cards to decide. openStandupWindow shows the latest in a window of its own, for the
// meeting room.

import type { RosterView, Standup } from '../../../shared/roster/types';
import { h, openModal, timeAgo } from '../dom';
import { markdownFile } from '../markdown';
import { act, fetchStandup } from './api';
import { proposalCard } from './proposals';

let picked: string | undefined;

const when = (at: number) => new Date(at).toLocaleString([], { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

export function standupView(v: RosterView, redraw: (v: RosterView) => void): HTMLElement {
  const root = h('section.ro-standup', { 'aria-label': 'Standup' });
  const sched = v.settings.schedule;
  const next = v.nextStandupAt
    ? `Next: ${when(v.nextStandupAt)} (${sched.time} ${sched.timeZone})${v.activitySinceStandup ? '' : ' · skipped unless the floor gets busy first'}`
    : 'The daily standup is off: turn it on in ⚙️ Settings';
  const list = v.standups;
  if (!picked || !list.some((s) => s.id === picked)) picked = list[0]?.id;
  const page = h('div.ro-page', {}, list.length ? h('p.ro-dim', {}, 'Loading the standup…') : h('p.ro-dim', {}, 'No standup yet. Run one: each Lead at its desk posts done / next / blockers / proposals; the others are read from their journals.'));
  root.append(
    h(
      'div.ro-bar',
      {},
      h('div', {}, h('h3', {}, '📋 Standup'), h('p.ro-sub', {}, next, v.lastStandupAt ? ` · last ${timeAgo(v.lastStandupAt)}` : '')),
      h('button.btn.primary', { type: 'button', id: 'ro-run-standup', disabled: list.some((s) => s.status === 'collecting'), onclick: () => void act(v.floor, 'standup').then((r) => r && ((picked = r.standups[0]?.id), redraw(r))) }, list.some((s) => s.status === 'collecting') ? '⏳ Collecting…' : '▶️ Run standup'),
    ),
    list.length > 1
      ? h('div.ro-tabs', { role: 'tablist' }, ...list.map((s) => h(`button.btn.small${s.id === picked ? '.on' : ''}`, { type: 'button', onclick: () => ((picked = s.id), redraw(v)) }, s.id, s.status === 'collecting' ? ' ⏳' : '')))
      : '',
    page,
  );
  const meta = list.find((s) => s.id === picked);
  if (meta) void fetchStandup(v.floor, meta.id).then((s) => page.replaceChildren(...standupBody(v, s, redraw)), (err) => page.replaceChildren(h('p.ro-dim', {}, `Couldn't load it: ${(err as Error).message}`)));
  return root;
}

function standupBody(v: RosterView, s: Standup, redraw: (v: RosterView) => void): HTMLElement[] {
  const props = v.proposals.filter((p) => s.proposalIds.includes(p.id));
  const head = h(
    'p.ro-sub',
    {},
    s.status === 'collecting' ? `⏳ Waiting on ${s.waiting.length} Lead${s.waiting.length === 1 ? '' : 's'} (up to 20 min) · ` : '',
    `Run by ${s.by} ${timeAgo(s.startedAt)}`,
    s.savedTo ? ` · handed to the PM as ${s.savedTo}` : s.status === 'compiled' ? ' · kept in the office (no PM at work to commit it)' : '',
  );
  return [
    head,
    props.length ? h('div.ro-props', {}, h('h4', {}, `Proposals (${props.filter((p) => p.status === 'pending').length} awaiting you)`), ...props.map((p) => proposalCard(v, p, redraw))) : h('span'),
    s.page ? h('div.ro-md', {}, markdownFile(s.page)) : h('p.ro-dim', {}, 'The page is compiled once every Lead asked has answered.'),
  ];
}

/** The latest standup in a window (the meeting room's 📋 Standup). */
export async function openStandupWindow(floor: string) {
  const body = h('div.body.ro-window-body', {}, h('p.ro-dim', {}, 'Loading…'));
  openModal(h('div.modal.ro-window', { role: 'dialog', 'aria-label': 'Latest standup' }, h('header', {}, h('h2', {}, '📋 Latest standup')), body));
  try {
    const s = await fetchStandup(floor);
    body.replaceChildren(s.page ? markdownFile(s.page) : h('p.ro-dim', {}, `Standup ${s.id} is still being collected.`));
  } catch (err) {
    body.replaceChildren(h('p.ro-dim', {}, (err as Error).message));
  }
}
