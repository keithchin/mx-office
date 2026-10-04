// The main board as the PM's view from above (docs/teams.md, "Sub-boards"): every card wears its team's
// tag, a bar of team chips over the columns picks which teams' cards show (several at once; remembered
// on this browser and kept in the address as `&teams=design,testing`), and each column says under its
// header how many of its cards are each team's. The pick is pure logic in shared/roster/team-filter.ts.

import { CARD_TEAMS, TEAM_META, type CardTeam } from '../../../shared/roster/card-team';
import { countTeams, formatTeams, showsTeam, startingPick, toggleTeam } from '../../../shared/roster/team-filter';
import { askedTeams, setAddress } from '../../shared/address';
import { h } from '../dom';
import { cards, type BoardView, type Card, type KanbanActions } from '../kanban';
import { teamTag } from './tag';
import { teamOfCard, teamWorld } from './world';
import { retagControl } from './retag';

const PICK_KEY = 'agent-office.board-teams';

function remembered(): string | null {
  try {
    return localStorage.getItem(PICK_KEY);
  } catch {
    return null;
  }
}

let pick = startingPick(askedTeams, remembered());

/** The pick as the address should have it while the board shows (null: every team, so no `teams=`). */
export const pickForAddress = () => formatTeams(pick);

function setPick(next: Set<CardTeam>, redraw: () => void) {
  pick = next;
  try {
    localStorage.setItem(PICK_KEY, formatTeams(pick) ?? '');
  } catch {
    // just for this visit
  }
  setAddress({ teams: formatTeams(pick) });
  redraw();
}

/** Each card's team, worked out once per drawing of the board. */
export function teamsOf(list: Card[]): Map<string, CardTeam> {
  const world = teamWorld();
  return new Map(list.map((c) => [c.key, teamOfCard(c, world)]));
}

/** The slim row under a column's header: how many of its cards are each team's (a tooltip spells it out). */
export function teamCounts(list: Card[], teams: Map<string, CardTeam>): HTMLElement | null {
  if (!list.length) return null;
  const n = countTeams(list.map((c) => teams.get(c.key) ?? 'unassigned'));
  const present = CARD_TEAMS.filter((t) => n[t]);
  return h(
    'div.tm-colnote',
    { title: present.map((t) => `${TEAM_META[t].name}: ${n[t]}`).join('\n') },
    ...present.map((t) => h('span.tm-count', { class: `tm-${t}` }, h('span.tm-ico', { 'aria-hidden': 'true' }, TEAM_META[t].icon), String(n[t]))),
  );
}

/** The main board's view: tags, the filter bar, the per-team counts and the Team control in previews. */
export function mainBoardView(a: KanbanActions, redraw: () => void): BoardView {
  const every = cards(a);
  const teams = teamsOf(every);
  const team = (c: Card) => teams.get(c.key) ?? teamOfCard(c);
  const n = countTeams(every.map(team));
  const chip = (t: CardTeam | 'all') => {
    const on = t === 'all' ? !pick.size : pick.has(t);
    const label = t === 'all' ? ['All', h('span.tm-chip-n', {}, String(every.length))] : [h('span.tm-ico', { 'aria-hidden': 'true' }, TEAM_META[t].icon), TEAM_META[t].name, h('span.tm-chip-n', {}, String(n[t]))];
    return h(
      'button.btn.small.tm-chip',
      {
        type: 'button',
        class: t === 'all' ? 'tm-all' : `tm-${t}`,
        'aria-pressed': String(on),
        'data-team': t,
        title: t === 'all' ? 'Every team' : `Show ${TEAM_META[t].name}'s cards (pick several to see them together)`,
        onclick: () => setPick(t === 'all' ? new Set() : toggleTeam(pick, t), redraw),
      },
      ...label,
    );
  };
  const top = h('div.tm-filter', { role: 'group', 'aria-label': 'Show the teams' }, h('span.tm-filter-h', {}, 'Teams'), chip('all'), ...CARD_TEAMS.map(chip));
  return {
    top,
    keep: (c) => showsTeam(pick, team(c)),
    badge: (c) => teamTag(team(c)),
    note: (list) => teamCounts(list, teams),
    previewTop: (c) => retagControl(c, team(c)),
  };
}
