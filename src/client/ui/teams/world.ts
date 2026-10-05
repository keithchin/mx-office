// What the sub-boards know about the floor's team (ui/teams/): the roster (GET /api/roster, fetched once
// per floor and again when the office says it changed) and so which team each card on the board is.
// No polling and no model calls: the roster is the same answer the 👥 Team tab gets.

import type { ServerMsg } from '../../../shared/protocol';
import type { RosterView } from '../../../shared/roster/types';
import { issueTeam, pullTeam, taskTeam, workerTeam, type CardTeam, type TeamWorld } from '../../../shared/roster/card-team';
import { store } from '../../state';
import { fetchRoster } from '../roster/api';
import type { Card } from '../kanban';

let roster: RosterView | undefined;
let rosterFloor: string | undefined;
let loading: string | undefined;
let timer: ReturnType<typeof setTimeout> | undefined;
const listeners = new Set<() => void>();

/** Runs `fn` whenever the roster comes in (or changes). */
export const onRoster = (fn: () => void) => listeners.add(fn);

/** The floor's roster, when it has come in. */
export function currentRoster(): RosterView | undefined {
  if (store.floor && rosterFloor !== store.floor) load();
  return rosterFloor === store.floor ? roster : undefined;
}

/** The roster as an action on it answered (hire, wake on a team page): drawn at once, no fetch. */
export function setRoster(v: RosterView) {
  roster = v;
  rosterFloor = v.floor;
  listeners.forEach((fn) => fn());
}

function load() {
  const f = store.floor;
  if (!f || loading === f) return;
  loading = f;
  fetchRoster(f).then(
    (v) => {
      loading = undefined;
      if (f !== store.floor) return;
      roster = v;
      rosterFloor = f;
      listeners.forEach((fn) => fn());
    },
    () => (loading = undefined),
  );
}

/** Every server message: a change to the floor's team fetches the roster again (once per burst). */
export function routeRosterMessage(msg: ServerMsg) {
  if (msg.t !== 'roster.changed' || msg.floor !== store.floor) return;
  clearTimeout(timer);
  timer = setTimeout(load, 400);
}
store.on('floor', load);

/** The floor as the mapping sees it, right now. */
export function teamWorld(): TeamWorld {
  return {
    issues: store.issues.items,
    pulls: store.pulls.items,
    tasks: store.queue.tasks,
    workers: [...store.workers.values()],
    members: (currentRoster()?.members ?? []).filter((m) => m.workerId).map((m) => ({ workerId: m.workerId, team: m.team })),
  };
}

/** The team a card on the board is of (shared/roster/card-team.ts). */
export function teamOfCard(c: Card, world: TeamWorld = teamWorld()): CardTeam {
  const o = c.of;
  if (o.kind === 'issue') return issueTeam(o.it);
  if (o.kind === 'task') return taskTeam(o.t, world);
  if (o.kind === 'worker') return workerTeam(o.w, world);
  return pullTeam(o.p, world);
}

/** Whether you may change a card's team: the Project Manager, an admin (with the shared office password, everyone is). */
export const canRetag = () => store.me.admin || !!currentRoster()?.admin;
