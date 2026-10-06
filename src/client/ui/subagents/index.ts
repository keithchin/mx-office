// The Leads' subagents as workers in the 1D view's 👷 Workers tab: their cards come from the floor's
// team as the sub-boards already fetch it (ui/teams/world.ts), and clicking one opens its detail.

import { subagentCards, type SubagentCard } from '../../../shared/roster/subagent-cards';
import { currentRoster, setRoster } from '../teams/world';
import { openSubagentDetail } from './detail';

/** What the Workers tab (ui/ranking/) needs to show the floor's subagents; `openWorker` opens a Lead's terminal. */
export function floorSubagents(openWorker: (id: string) => void): { cards(includeNeverRun: boolean): SubagentCard[]; open(c: SubagentCard): void } {
  return {
    cards: (includeNeverRun) => {
      const v = currentRoster();
      return v ? subagentCards(v, { includeNeverRun }) : [];
    },
    open: (c) => {
      const v = currentRoster();
      if (v) openSubagentDetail(v, c.key, { openWorker, onRoster: setRoster });
    },
  };
}
