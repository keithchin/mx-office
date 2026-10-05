// The team chatter on a team's page (ui/teams/panels.ts): the latest few exchanges its members are in,
// compact. One element per floor and team, kept across the page's redraws (it's drawn again on every
// change of the board) and updated in place as messages come in. No three.js.

import { isGroup, type ChatterMessage } from '../../../shared/chatter';
import type { TeamId } from '../../../shared/roster/roles';
import { store } from '../../state';
import { h } from '../dom';
import { messages, onFeed } from './feed';
import { messageNode, refreshTimes, type ChatterActions } from './message';
import { chatterActions, type ChatterDeps } from './panel';
import './chatter.css';

const SHOWN = 8;
const made = new Map<string, HTMLElement>();
let actions: ChatterActions | undefined;

/** Where the compact panels' bubbles go: the 1D view says once (lite.ts); without it, only journal entries and standups open. */
export function useChatterActions(deps: ChatterDeps) {
  actions = chatterActions(deps);
}

const fallback: ChatterDeps = { openWorker: () => undefined, openEscalation: () => undefined, openPull: () => undefined };

/** Whether a member of `team` is in it, saying or being told. */
export const inTeam = (m: ChatterMessage, team: TeamId) => m.from.team === team || (!isGroup(m.to) && m.to.team === team);

export function teamChatter(team: TeamId): HTMLElement {
  const floor = store.floor ?? '';
  const head = h('h3.tm-panel-h', {}, '💬 Team chatter');
  // Before the page knows its floor: a placeholder, not kept (the next redraw has the floor).
  if (!floor) return h('section.tm-panel.tc-team', { 'aria-label': 'Team chatter' }, head, h('p.tm-dim', {}, 'Loading…'));
  const key = `${floor}\0${team}`;
  const had = made.get(key);
  if (had) return had;
  const act = () => actions ?? chatterActions(fallback);
  const list = h('ol.tc-list.tc-compact');
  const empty = h('p.tm-dim', {}, 'Loading…');
  const el = h('section.tm-panel.tc-team', { 'aria-label': 'Team chatter' }, head, list, empty);
  const fill = () => {
    const got = messages(floor);
    const mine = got.list.filter((m) => inTeam(m, team)).slice(0, SHOWN);
    list.replaceChildren(...mine.map((m) => messageNode(m, act(), true)));
    empty.hidden = mine.length > 0;
    empty.textContent = got.loaded ? 'Nobody on this team has said anything to anyone yet.' : 'Loading…';
  };
  onFeed(floor, (ev) => {
    if (ev.t === 'reset') return fill();
    if (ev.t !== 'new' || !inTeam(ev.m, team)) return;
    list.prepend(messageNode(ev.m, act(), true));
    while (list.childElementCount > SHOWN) list.lastElementChild!.remove();
    empty.hidden = true;
  });
  setInterval(() => el.isConnected && refreshTimes(list), 30_000);
  fill();
  made.set(key, el);
  return el;
}
