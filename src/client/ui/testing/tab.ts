// 🧾 App Insights › Testing (/lite?tab=testing), from the tab registry (tabs/registry.ts): the project's
// test-run records against main, read-only. The page itself (page.ts, render.ts and the markdown
// renderer) is loaded the first time the tab is shown, so nothing of it costs anything at page start.

import { registerTab, type TabHooks } from '../../tabs/registry';
// Only its type here: the module itself comes in with the first show.
import type * as Page from './page';

registerTab({
  id: 'testing',
  group: 'insights',
  label: 'Testing',
  tooltip: 'Test runs bound to revisions, and coverage, results and freshness per use case',
  icon: '🧾',
  mount: (container) => {
    let hooks: TabHooks | undefined;
    let wanted: 'show' | 'refresh' | undefined = 'show';
    const page: Promise<typeof Page> = import('./page');
    void page.then(({ testingTab }) => {
      hooks = testingTab(container);
      if (wanted) hooks[wanted]?.();
    });
    return {
      show: () => {
        if (hooks) hooks.show?.();
        else wanted = 'show';
      },
      hide: () => {
        if (!hooks) wanted = undefined;
      },
      refresh: () => {
        if (hooks) hooks.refresh?.();
        else wanted = 'refresh';
      },
    };
  },
});
