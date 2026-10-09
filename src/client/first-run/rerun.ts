// ⚙️ Settings › 🔌 Connections' Run setup again (admins): 🚀 first-run setup once more, from the start,
// keeping everything that's already set.
import { SETUP_PAGE } from '../../shared/first-run';
import { h, toast } from '../ui/dom';
import { setting } from '../ui/settings/kit';
import { setupApi } from './api';

export function rerunSetupSetting(): HTMLElement {
  const go = h('button.btn', { type: 'button' }, '🚀 Run setup again');
  go.addEventListener('click', () => {
    go.disabled = true;
    setupApi
      .rerun()
      .then(() => location.assign(SETUP_PAGE))
      .catch((e: Error) => toast(e.message, 'error'))
      .finally(() => (go.disabled = false));
  });
  return setting('First-run setup', 'office', h('p.setting-note', {}, 'The steps a new office starts with: the password, this machine’s prerequisites, GitHub, Mendix, the toolkit, and the first project. Nothing set already is lost.'), go);
}
