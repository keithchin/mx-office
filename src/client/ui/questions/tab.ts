// Project Management › Questions (/lite?tab=questions), from the tab registry (tabs/registry.ts): the
// analysts' open questions for the client, answered in one place. The page itself (page.ts and its cards
// and windows) is loaded the first time the tab is shown; the feed Needs you reads is loaded with the page.

import { registerTab, type TabHooks } from '../../tabs/registry';
// Only its type here: the module itself comes in with the first show.
import type * as Page from './page';

registerTab({
  id: 'questions',
  group: 'pm',
  order: 25,
  label: 'Questions',
  tooltip: 'The open questions the analysts raised for the client in the BRDs: answer them here and send the answers back',
  icon: '❓',
  mount: (container) => {
    let hooks: TabHooks | undefined;
    let wanted: 'show' | 'refresh' | undefined = 'show';
    const page: Promise<typeof Page> = import('./page');
    void page.then(({ questionsTab }) => {
      hooks = questionsTab(container);
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
