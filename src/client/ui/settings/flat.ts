// The flat views' end of ⚙️ Settings: the page (page.ts) wired to a flat session (your settings kept in
// this browser, its notifications), and where a page with no Settings tab sends a settings link (the 2D
// view and the home page go to the 1D view's tab; the home page with no project yet opens it in a window).
//

import { settingsHref, type SettingsSectionId } from '../../../shared/settings-sections';
import { lastFloor } from '../../state/persist';
import { saveSettings, store } from '../../state';
import type { FlatSession } from '../../shared/session';
import { h, openModal } from '../dom';
import { signOut, type SettingsDeps } from './kit';
import { settingsPage, type SettingsPage } from './page';

/** What the page needs, from a flat view's session. */
export function flatDeps(session: Pick<FlatSession, 'net' | 'settings' | 'notifier'>): SettingsDeps {
  return {
    net: session.net,
    settings: () => session.settings,
    change: (some) => {
      Object.assign(session.settings, some);
      saveSettings(session.settings);
    },
    notifier: session.notifier,
    signOut: () => void signOut(),
  };
}

/** The 1D view's ⚙️ Settings tab, drawn into `root`. */
export function flatSettings(root: HTMLElement, session: Pick<FlatSession, 'net' | 'settings' | 'notifier'>, onSection?: (id: SettingsSectionId) => void): SettingsPage {
  return settingsPage(root, flatDeps(session), onSection);
}

/** The floor a settings link opens on: the one you're on, the one you were last on, or the first there is. */
const floorFor = () => store.floor ?? lastFloor() ?? store.floors.find((f) => !f.cloning)?.id;

/**
 * Opens Settings at `section` from a page with no Settings tab (the 2D view, the home page): the 1D
 * view's tab. With no project at all yet (a new office's home page), a window here
 * instead, with ✕ and Esc to close it.
 */
export function goToSettings(session: Pick<FlatSession, 'net' | 'settings' | 'notifier'>, section?: SettingsSectionId) {
  const floor = floorFor();
  if (floor) return location.assign(settingsHref(section, floor));
  const root = h('div.fs-window-body');
  const close = h('button.btn.close', { type: 'button', 'aria-label': 'Close', title: 'Close (Esc)' }, '✕');
  const el = h('div.modal.settings.fs-window', { role: 'dialog', 'aria-label': 'Settings' }, h('header', {}, h('h2', {}, '⚙️ Settings'), close), root);
  const page = settingsPage(root, flatDeps(session));
  const modal = openModal(el, { doing: '⚙️ in settings', onClose: () => page.hide() });
  close.addEventListener('click', () => modal.close());
  page.show(section);
}
