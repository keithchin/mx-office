// The Developer view (the code's App Workspace) as a tab of the 1D view, from the tab registry
// (tabs/registry.ts): ?tab=app (shared/app-workspace/route.ts), hidden from the navigation (the Developer |
// Project Management switch is the way in). Nothing of the workspace loads until it is first shown: the shell
// (./shell.ts) comes in with that show. The switch (./view-switch.ts) is small and goes in the top bar with
// the page's first tab, so it shows on every project page.
//
// The view's old sections (Requirements, Decisions, Review, Release) are retired: their tab ids stay
// registered, hidden, so an old link or a page that still opens one lands on the Project Management page that
// has its list now (Documents, Approvals, Testing, the Overview), never on a blank page.

import { registerTab, type TabHooks } from '../../tabs/registry';
import { currentProjectTab, onProjectTab, openProjectTab } from '../../tabs/host';
import { APP_SECTIONS, isAppSection, isRetiredSection, RETIRED_SECTIONS, VIEW_NAMES, type RetiredSection } from '../../../shared/app-workspace/route';
import { placeViewSwitch, viewSwitch, type ViewSwitch } from './view-switch';
// Only its type here: the module itself comes in with the first show.
import type * as Shell from './shell';

let shell: Promise<typeof Shell> | undefined;
/** The Project Management tab showing before the Developer view opened (the switch back goes there). */
let cameFrom: string | undefined;

registerTab({
  id: 'app',
  group: 'general',
  label: VIEW_NAMES.app,
  tooltip: APP_SECTIONS[0].hint,
  hidden: true,
  mount: (container) => {
    shell ??= import('./shell');
    let hooks: TabHooks | undefined;
    let wanted = true;
    void shell.then(({ appWorkspace }) => {
      hooks = appWorkspace(container);
      if (wanted) hooks.show?.();
    });
    return {
      show: () => {
        const before = currentProjectTab();
        if (before && !isAppSection(before) && !isRetiredSection(before)) cameFrom = before;
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
});

/** A retired section: shown, it opens the Project Management page with its list (after this show finishes). */
function retired(id: RetiredSection) {
  registerTab({
    id,
    group: 'general',
    label: id[0].toUpperCase() + id.slice(1),
    tooltip: `Moved to Project Management (${RETIRED_SECTIONS[id]})`,
    hidden: true,
    mount: () => ({ show: () => void queueMicrotask(() => openProjectTab(RETIRED_SECTIONS[id])) }),
  });
}
for (const id of Object.keys(RETIRED_SECTIONS) as RetiredSection[]) retired(id);

// The switch: put in the top bar with the first tab the page shows (only the 1D view shows project tabs),
// marked again on every tab change. After this module's evaluation (the tab host is still loading now).
let vs: ViewSwitch | undefined;
queueMicrotask(() => {
  if (typeof document === 'undefined') return;
  onProjectTab((id) => {
    if (!isAppSection(id) && !isRetiredSection(id)) cameFrom = id;
    if (!vs) {
      vs = viewSwitch({ current: currentProjectTab, open: (t) => void openProjectTab(t), cameFrom: () => cameFrom });
      placeViewSwitch(vs);
    }
    vs.draw();
  });
});
