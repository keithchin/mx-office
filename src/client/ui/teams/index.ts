// Sub-boards (docs/teams.md, "Sub-boards"): every card on the floor's board belongs to a team, the main
// board shows them all with their team's tag and a team filter (the PM's view from above), and the 🧩
// Teams tab has a page per team with its own board, Lead, panels and journal. This is what the 1D view
// (lite.ts) wires in: a view for the main board, the team page, and the address keys they keep.

import type { ServerMsg } from '../../../shared/protocol';
import type { Net } from '../../net';
import { setAddress } from '../../shared/address';
import { store } from '../../state';
import type { BoardView } from '../kanban';
import { mainBoardView, pickForAddress } from './filter';
import { forgetTeamData, pageTeam, renderTeamPage, type PageDeps } from './page';
import { useRetagNet } from './retag';
import { onRoster, routeRosterMessage } from './world';

export { teamPicker } from './retag';

export interface SubBoards {
  /** The main board's tags, filter bar and per-team counts; `redraw` draws the board again (a chip clicked). */
  boardView(redraw: () => void): BoardView;
  /** Draws the 🧩 Team boards tab into `root`. */
  renderPage(root: HTMLElement): void;
  /** Every server message (the roster changed). */
  route(msg: ServerMsg): void;
  /** The tab showing now: the address keeps `teams=` on the board and `team=` on the team page, and neither elsewhere. */
  address(tab: string): void;
}

/** `redraw` draws whichever of the board and the team page is showing (the roster came in). */
export function subBoards(net: Net, deps: PageDeps, redraw: () => void): SubBoards {
  useRetagNet(net);
  onRoster(redraw);
  store.on('floor', forgetTeamData);
  return {
    boardView: (again) => mainBoardView(deps.kanban, again),
    renderPage: (root) => renderTeamPage(root, deps),
    route: routeRosterMessage,
    address: (tab) => setAddress({ teams: tab === 'board' ? pickForAddress() : null, team: tab === 'teams' ? pageTeam() : null }),
  };
}
