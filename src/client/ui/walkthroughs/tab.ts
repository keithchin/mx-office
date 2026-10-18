// 🎬 Deployment › Walkthroughs (/lite?tab=walkthroughs), from the tab registry (tabs/registry.ts): videos of
// the app's workflows that the office records by itself (server/walkthroughs/). The page (page.ts and the
// player) is loaded the first time the tab is shown. It has a tab-row button too, which is also how the Live
// app tab's links open it (api.ts openWalkthroughs) in every theme.

import { registerTab, type TabHooks } from '../../tabs/registry';
// Only its type here: the module itself comes in with the first show.
import type * as Page from './page';

registerTab({
  id: 'walkthroughs',
  group: 'deploy',
  label: 'Walkthroughs',
  tooltip: 'Videos of the app’s workflows, recorded by the office from its test journeys at each passing build',
  icon: '🎬',
  tabRow: true,
  mount: (container) => {
    let hooks: TabHooks | undefined;
    let wanted: 'show' | 'refresh' | undefined = 'show';
    const page: Promise<typeof Page> = import('./page');
    void page.then(({ walkthroughsPage }) => {
      hooks = walkthroughsPage(container);
      if (wanted) hooks[wanted]?.();
    });
    return {
      show: () => {
        if (hooks) hooks.show?.();
        else wanted = 'show';
      },
      hide: () => {
        if (hooks) hooks.hide?.();
        else wanted = undefined;
      },
      refresh: () => {
        if (hooks) hooks.refresh?.();
        else wanted = 'refresh';
      },
    };
  },
});
