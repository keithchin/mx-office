// The App Workspace (C3 of the App Workspace proposal) as tabs of the 1D view, from the tab registry
// (tabs/registry.ts): its five sections are project tabs of their own (?tab=app|requirements|decisions|
// review|release; shared/app-workspace/route.ts), App listed first in the navigation's General group as
// "App workspace" and the other four hidden there (the workspace has its own section bar). Nothing of the
// workspace loads until one of them is first shown: the shell (./shell.ts) comes in with that show and
// draws one workspace that the five sections share, so the running app's frame is never reloaded by
// moving between sections.

import { registerTab, type TabHooks } from '../../tabs/registry';
import { currentProjectTab } from '../../tabs/host';
import { APP_SECTIONS, isAppSection, type AppSection } from '../../../shared/app-workspace/route';
// Only its type here: the module itself comes in with the first show.
import type * as Shell from './shell';

let shell: Promise<typeof Shell> | undefined;
/** The Engineering tab showing before the App Workspace opened (the switch back goes there). */
let cameFrom: string | undefined;

function section(id: AppSection): TabDef {
  return {
    id,
    group: 'general',
    label: id === 'app' ? 'App workspace' : APP_SECTIONS.find((s) => s.id === id)!.label,
    tooltip: APP_SECTIONS.find((s) => s.id === id)!.hint,
    ...(id === 'app' ? { order: 5, icon: '🧭', tabRow: true } : { hidden: true }),
    mount: (container) => {
      shell ??= import('./shell');
      let hooks: TabHooks | undefined;
      let wanted = true;
      void shell.then(({ appWorkspace }) => {
        hooks = appWorkspace(container, id, () => cameFrom);
        if (wanted) hooks.show?.();
      });
      return {
        show: () => {
          const before = currentProjectTab();
          if (before && !isAppSection(before)) cameFrom = before;
          if (hooks) hooks.show?.();
          else wanted = true;
        },
        hide: () => {
          if (hooks) hooks.hide?.();
          else wanted = false;
        },
        refresh: () => hooks?.refresh?.(),
      };
    },
  };
}

type TabDef = Parameters<typeof registerTab>[0];

for (const s of APP_SECTIONS) registerTab(section(s.id));
