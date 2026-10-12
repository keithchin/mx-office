// The team-lead panel's settings (ui/lead-panel/): which view it opens in, Chat or Terminal (pref.ts), and
// whether it shows at all. Both are in the 1D view's ⚙️ Settings tab (under Your view, beside the team's
// settings) and in ⚙️ Settings › You; the panel's own Chat | Terminal tabs change the first one too.

import { h } from '../../dom';
import { choiceRow } from '../../settings-rows';
import { panelShown } from '../../lead-panel/logic';
import { setPanelShown } from '../../lead-panel';
import { PMC_VIEW_LABEL, PMC_VIEWS, savePmcView, savedPmcView } from './pref';

const storage = () => {
  try {
    return localStorage;
  } catch {
    return undefined;
  }
};

export function consoleViewSetting(): HTMLElement[] {
  const options = PMC_VIEWS.map((v) => [v, v === 'chat' ? `${PMC_VIEW_LABEL[v]} (default)` : PMC_VIEW_LABEL[v]] as const);
  return [
    choiceRow('Show the team-lead panel', [[true, 'On (default)'], [false, 'Off']] as const, () => panelShown(storage()), (on) => setPanelShown(on)),
    choiceRow('Team-lead panel view', options, savedPmcView, savePmcView),
    h('p.setting-note.ro-sub', {}, 'The team-lead panel is docked on the right of every project tab: the agent who leads the team (the Project Coordinator, or the Chief Analyst or Solo Lead on a smaller team). Chat shows its conversation as messages: your prompts, its replies, its tool calls in a line each, and what it asks you. Terminal shows its screen as it is, live and read-only, connected only while it is on screen. Its own Chat | Terminal tabs change this too.'),
  ];
}
