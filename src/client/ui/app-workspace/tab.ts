// The Developer view (the code's App Workspace, C3 of the App Workspace proposal) as tabs of the 1D view,
// from the tab registry (tabs/registry.ts): its five sections are project tabs of their own
// (?tab=app|requirements|decisions|review|release; shared/app-workspace/route.ts), all five hidden from the
// navigation (the Developer | Project Management switch is the way in, and the view has its own section
// bar). Nothing of the workspace loads until one of them is first shown: the shell (./shell.ts) comes in
// with that show and draws one workspace that the five sections share, so the running app's frame is never
// reloaded by moving between sections. The Developer | Project Management switch (./view-switch.ts) is
// small and goes in the top bar with the page's first tab, so it shows on every project page.

import { registerTab, type TabHooks } from '../../tabs/registry';
import { currentProjectTab, onProjectTab, openProjectTab } from '../../tabs/host';
import { APP_SECTIONS, isAppSection, VIEW_NAMES, type AppSection } from '../../../shared/app-workspace/route';
import { placeViewSwitch, viewSwitch, type ViewSwitch } from './view-switch';
// Only its type here: the module itself comes in with the first show.
import type * as Shell from './shell';

let shell: Promise<typeof Shell> | undefined;
/** The Project Management tab showing before the Developer view opened (the switch back goes there). */
let cameFrom: string | undefined;

function section(id: AppSection): TabDef {
  return {
    id,
    group: 'general',
    label: id === 'app' ? VIEW_NAMES.app : APP_SECTIONS.find((s) => s.id === id)!.label,
    tooltip: APP_SECTIONS.find((s) => s.id === id)!.hint,
    hidden: true,
    mount: (container) => {
      shell ??= import('./shell');
      let hooks: TabHooks | undefined;
      let wanted = true;
      void shell.then(({ appWorkspace }) => {
        hooks = appWorkspace(container, id);
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

// The switch: put in the top bar with the first tab the page shows (only the 1D view shows project tabs),
// marked again on every tab change. After this module's evaluation (the tab host is still loading now).
let vs: ViewSwitch | undefined;
queueMicrotask(() => {
  if (typeof document === 'undefined') return;
  onProjectTab((id) => {
    if (!isAppSection(id)) cameFrom = id;
    if (!vs) {
      vs = viewSwitch({ current: currentProjectTab, open: (t) => void openProjectTab(t), cameFrom: () => cameFrom });
      placeViewSwitch(vs);
    }
    vs.draw();
  });
});
