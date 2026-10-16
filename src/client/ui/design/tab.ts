// Project Management › Design gallery (/lite?tab=design), from the tab registry (tabs/registry.ts): the project's
// adopted design system, its patterns with their states, "Use for…", and runtime screenshots. The page itself
// (page.ts and its stylesheet) is loaded the first time the tab is shown, so nothing of it is in the main
// bundle; it asks the office when it's shown, and never while it's hidden (no timers).

import { registerTab, type TabHooks } from '../../tabs/registry';
// Only its type here: the module itself comes in with the first show.
import type * as Page from './page';

registerTab({
  id: 'design',
  group: 'pm',
  order: 27,
  label: 'Design gallery',
  tooltip: 'The design system this project adopted: its patterns and states, which pattern each page uses, and screenshots of the running app',
  icon: '🎨',
  mount: (container) => {
    let hooks: TabHooks | undefined;
    let wanted: 'show' | 'refresh' | undefined = 'show';
    const page: Promise<typeof Page> = import('./page');
    void page.then(({ designTab }) => {
      hooks = designTab(container);
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
