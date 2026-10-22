// 🔐 App Insights › Security (/lite?tab=security), from the tab registry (tabs/registry.ts): the project's
// security baseline (server/security-gate/): what the office read of the app's security at main, the last
// mx check with its commit, the policy and what a sign-off or acceptance needs now. The page itself
// (page.ts) is loaded the first time the tab is shown.

import { registerTab, type TabHooks } from '../../tabs/registry';
// Only its type here: the module itself comes in with the first show.
import type * as Page from './page';

registerTab({
  id: 'security',
  group: 'insights',
  label: 'Security',
  tooltip: 'The app’s security as read from main, the last mx check with its commit, and the project’s security baseline',
  icon: '🔐',
  mount: (container) => {
    let hooks: TabHooks | undefined;
    let wanted: 'show' | 'refresh' | undefined = 'show';
    const page: Promise<typeof Page> = import('./page');
    void page.then(({ securityPage }) => {
      hooks = securityPage(container);
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
