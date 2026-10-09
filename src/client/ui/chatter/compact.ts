// The team chatter on a team's page (ui/teams/panels.ts): the chatter itself lives in the team phone now
// (ui/phone/), so the page has a link that opens it filtered to the team, and says how much the team has
// said today. One element per floor and team, kept across the page's redraws.

import { isGroup, type ChatterMessage } from '../../../shared/chatter';
import type { TeamId } from '../../../shared/roster/roles';
import { store } from '../../state';
import { h } from '../dom';
import { openPhone } from '../phone/api';
import { messages, onFeed } from './feed';
import './chatter.css';

const made = new Map<string, HTMLElement>();

/** Whether a member of `team` is in it, saying or being told. */
export const inTeam = (m: ChatterMessage, team: TeamId) => m.from.team === team || (!isGroup(m.to) && m.to.team === team);

export function teamChatter(team: TeamId): HTMLElement {
  const floor = store.floor ?? '';
  const head = h('h3.tm-panel-h', {}, '💬 Team chatter');
  if (!floor) return h('section.tm-panel.tc-team', { 'aria-label': 'Team chatter' }, head, h('p.tm-dim', {}, 'Loading…'));
  const key = `${floor}\0${team}`;
  const had = made.get(key);
  if (had) return had;
  const line = h('p.tm-dim', {}, 'Loading…');
  const open = h('button.btn.small.tc-open', { type: 'button', onclick: () => openPhone({ floor, team }) }, 'Open in the team phone →');
  const el = h('section.tm-panel.tc-team', { 'aria-label': 'Team chatter' }, head, line, open);
  const fill = () => {
    const got = messages(floor);
    const day = new Date().setHours(0, 0, 0, 0);
    const today = got.list.filter((m) => m.at >= day && inTeam(m, team)).length;
    line.textContent = !got.loaded ? 'Loading…' : `${today ? `${today} message${today === 1 ? '' : 's'} with this team today.` : 'Nobody on this team has said anything today.'} The chatter, its threads and your messages to the team are in the team phone (bottom right).`;
  };
  onFeed(floor, fill);
  fill();
  made.set(key, el);
  return el;
}
