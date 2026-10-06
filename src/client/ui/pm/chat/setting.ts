// The Command Center terminal setting: which view the 1D view's Command Center console opens its worker
// in (pref.ts). It's in the 1D view's ⚙️ Settings tab (under Your view, beside the team's settings) and in
// the 3D office's ⚙️ Settings › You; the console's own Chat | Terminal toggle changes the same setting.

import { h } from '../../dom';
import { choiceRow } from '../../settings-rows';
import { PMC_VIEW_LABEL, PMC_VIEWS, savePmcView, savedPmcView } from './pref';

export function consoleViewSetting(): HTMLElement[] {
  const options = PMC_VIEWS.map((v) => [v, v === 'chat' ? `${PMC_VIEW_LABEL[v]} (default)` : PMC_VIEW_LABEL[v]] as const);
  return [
    choiceRow('Command Center terminal', options, savedPmcView, savePmcView),
    h('p.setting-note.ro-sub', {}, 'How the 1D view’s Command Center shows the Project Coordinator. Chat shows the conversation as messages: your prompts, its replies, its tool calls in a line each, and what it asks you. Terminal shows its screen as it is. The Chat | Terminal toggle on the console changes this too.'),
  ];
}
