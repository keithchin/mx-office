// Expert mode's Session screen as a tab of the 1D view (?tab=session), from the tab registry (tabs/registry.ts).
// Listed first in the navigation's General group, and only for an Expert-mode project (`mode` on the project:
// shared/expert.ts). Arriving on an Expert-mode project opens it in place of the Overview. While you're on such
// a project the team-lead panel steps aside (body.xs-project, ./expert.css): Expert mode has no coordinator.
// The screen itself (./page.ts) loads the first time it's shown.

import { registerTab, tabVisibilityChanged, type TabHooks } from '../../tabs/registry';
import { currentProjectTab, onProjectTab, openProjectTab } from '../../tabs/host';
import { store } from '../../state';
import { isExpertMode } from '../../../shared/expert';
// Only its type here: the module itself comes in with the first show.
import type * as Page from './page';
import './expert.css';

const expertHere = () => isExpertMode(store.currentFloor());

registerTab({
  id: 'session',
  group: 'general',
  label: 'Session',
  tooltip: 'Your own Claude Code session in the project folder, with the app live beside it',
  icon: '💻',
  order: 5,
  shown: expertHere,
  mount: (container) => {
    let hooks: TabHooks | undefined;
    let wanted: 'show' | 'refresh' | undefined = 'show';
    const page: Promise<typeof Page> = import('./page');
    void page.then(({ sessionPage }) => {
      hooks = sessionPage(container);
      if (wanted) hooks[wanted]?.();
    });
    return {
      show: () => (hooks ? hooks.show?.() : (wanted = 'show')),
      hide: () => (hooks ? hooks.hide?.() : (wanted = undefined)),
      refresh: () => (hooks ? hooks.refresh?.() : (wanted = 'refresh')),
    };
  },
});

// After this module's evaluation (the tab host is still loading now).
queueMicrotask(() => {
  if (typeof document === 'undefined') return;
  /** Projects this page already took to their session on arrival (going to the Overview after is yours). */
  const arrived = new Set<string>();
  let was: boolean | undefined;
  const look = () => {
    const expert = expertHere();
    document.body.classList.toggle('xs-project', expert);
    if (expert !== was) {
      was = expert;
      tabVisibilityChanged();
    }
    const floor = store.floor;
    if (!expert || !floor || arrived.has(floor)) return;
    const tab = currentProjectTab();
    if (tab === undefined) return;
    arrived.add(floor);
    if (tab === 'command') openProjectTab('session');
  };
  store.on('floor', look);
  store.on('floors', look);
  onProjectTab(look);
});
