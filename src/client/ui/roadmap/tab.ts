// 🗺️ Project Management › Roadmap (/lite?tab=roadmap), from the tab registry (tabs/registry.ts): phased
// delivery's timeline, the Build Plan gate's phases editor and the change history (./page.ts, loaded the first
// time the tab is shown). Loading this module also puts the phase strip on the Overview's Progress card
// (./strip.ts, through ui/portal/progress-extras.ts), which shows only for a project delivered in phases.

import { registerTab, type TabHooks } from '../../tabs/registry';
import { registerProgressExtra } from '../portal/progress-extras';
import { phaseStrip } from './strip';
// Only its type here: the module itself comes in with the first show.
import type * as Page from './page';

registerTab({
  id: 'roadmap',
  group: 'pm',
  label: 'Roadmap',
  tooltip: 'Build delivered in phases: the timeline, spend against each estimate, exit criteria and every change to the phases',
  icon: '🗺️',
  order: 25,
  mount: (container) => {
    let hooks: TabHooks | undefined;
    let wanted: 'show' | 'refresh' | undefined = 'show';
    const page: Promise<typeof Page> = import('./page');
    void page.then(({ roadmapPage }) => {
      hooks = roadmapPage(container);
      if (wanted) hooks[wanted]?.();
    });
    return {
      show: () => (hooks ? hooks.show?.() : (wanted = 'show')),
      hide: () => (hooks ? hooks.hide?.() : (wanted = undefined)),
      refresh: () => (hooks ? hooks.refresh?.() : (wanted = 'refresh')),
    };
  },
});

registerProgressExtra(phaseStrip);
