// ⚙️ Settings: what's yours alone. The team-lead panel, and how you're signed in.

import { store } from '../../state';
import { h } from '../dom';
import { consoleViewSetting } from '../pm/chat/setting';
import { setting, type SettingsDeps } from './kit';

/** The team-lead panel: shown or not, and Chat or Terminal, the view it opens in. */
export const consoleSetting = () => setting('Team-lead panel', 'you', ...consoleViewSetting());

/** How you're signed in, and signing out. */
export function signedInSetting(d: SettingsDeps): HTMLElement {
  const account = store.me.account;
  const out = h('button.btn', { type: 'button', onclick: () => d.signOut() }, '🚪 Sign out');
  return setting('Signed in', null, h('div.volume', {}, out), h('p.setting-note', {}, account ? `As ${account.name}, with your own account (${account.role}).` : 'With the shared office password.'));
}
