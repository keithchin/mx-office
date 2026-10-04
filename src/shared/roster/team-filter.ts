// The main board's team filter (ui/teams/filter.ts): which teams' cards it shows, as the address keeps
// it (`&teams=design,testing`) and this browser remembers it. An empty pick means every team, so a link
// without `teams=` always shows the whole board. Pure: the browser and the tests import it.

import { CARD_TEAMS, isCardTeam, type CardTeam } from './card-team.js';

/** `design,testing` (from the address or storage) as a pick; unknown names are dropped, and all of them is the same as none. */
export function parseTeams(s: string | null | undefined): Set<CardTeam> {
  const out = new Set<CardTeam>();
  for (const part of (s ?? '').split(',')) {
    const t = part.trim().toLowerCase();
    if (isCardTeam(t)) out.add(t);
  }
  return out.size === CARD_TEAMS.length ? new Set() : out;
}

/** The pick for the address, in the filter bar's order; null (take `teams` out) when it's every team. */
export function formatTeams(pick: ReadonlySet<CardTeam>): string | null {
  const list = CARD_TEAMS.filter((t) => pick.has(t));
  return list.length && list.length < CARD_TEAMS.length ? list.join(',') : null;
}

/** A chip clicked: on if it was off, off if it was on. Picking the last one left means every team again. */
export function toggleTeam(pick: ReadonlySet<CardTeam>, t: CardTeam): Set<CardTeam> {
  const next = new Set(pick);
  if (next.has(t)) next.delete(t);
  else next.add(t);
  return next.size === CARD_TEAMS.length ? new Set() : next;
}

/** Whether the pick shows a card of team `t`. */
export const showsTeam = (pick: ReadonlySet<CardTeam>, t: CardTeam) => !pick.size || pick.has(t);

/** How many of `teams` are each team, every team present (0 when none). */
export function countTeams(teams: Iterable<CardTeam>): Record<CardTeam, number> {
  const out = Object.fromEntries(CARD_TEAMS.map((t) => [t, 0])) as Record<CardTeam, number>;
  for (const t of teams) out[t]++;
  return out;
}

/** Where the page starts: the address's pick if it names one, else what this browser remembered. */
export const startingPick = (fromAddress: string | null, remembered: string | null) => (fromAddress !== null ? parseTeams(fromAddress) : parseTeams(remembered));
