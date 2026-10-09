// The 3D office's ⚙️ Settings window (☰ → ⚙️ Settings, the palette, the jukebox): the categories down
// the side, the one picked on the right. Its sections are the same builders the flat views' Settings
// page uses (you.ts, notify.ts, building.ts, workers.ts, page.ts); this window adds what only the 3D
// office has (the camera, your character, the sky over it), and links to the full page for the rest
// (the team, Jeff, the budget, incidents…).

import type { Net } from '../../net';
import type { OfficeSound } from '../../sound';
import { store, type Settings, type ViewMode } from '../../state';
import type { DesktopNotifier } from '../../notify';
import { settingsHref } from '../../../shared/settings-sections';
import { h, openModal } from '../dom';
import { connectionsPanel } from '../connections';
import { setting, together, plain, type Built, type SettingsDeps } from './kit';
import { consoleSetting, signedInSetting, soundSettings } from './you';
import { notifySettings } from './notify';
import { dogSettingBuilt, holidaySetting, mapSetting, skySetting, workspaceSetting } from './building';
import { workersSettings } from './workers';
import { choiceRow } from '../settings-rows';

const VIEWS: [ViewMode, string, string][] = [
  ['first', '👀 First person', 'See through your own eyes. Click the office to look around with the mouse and click things to use them. Esc frees the mouse.'],
  ['third', '🎥 Third person', 'Follow your character from behind. Drag to orbit the camera, scroll to zoom, and click things to use them.'],
];

/** The categories down the side of the 3D window. */
export type SettingsPane = 'you' | 'sound' | 'notify' | 'building' | 'workers' | 'connections';

export const PANES: { id: SettingsPane; icon: string; label: string; blurb: string; admin?: true }[] = [
  { id: 'you', icon: '🧍', label: 'You', blurb: 'How you look, how you see the office, and how you’re signed in.' },
  { id: 'sound', icon: '🔊', label: 'Sound & voice', blurb: 'How loud the office is for you, and how voice chat works.' },
  { id: 'notify', icon: '🔔', label: 'Notifications', blurb: 'Hear about a worker that needs someone, or finished, while you’re somewhere else.' },
  { id: 'building', icon: '🏢', label: 'Building', blurb: 'The map, the decorations, the sky, the dog, and where new floors are cloned.' },
  { id: 'workers', icon: '🤖', label: 'Agents', blurb: 'What agents start on, how many run at once, when they go home and what the office tells them.' },
  { id: 'connections', icon: '🔌', label: 'Connections', blurb: 'The tokens and password the office signs in with, git & gh, its folders and worktree cleanup. Admins only.', admin: true },
];

/** The camera: first or third person (the 3D office's alone). */
function cameraSetting(d: SettingsDeps): HTMLElement {
  const note = h('p.setting-note');
  const row = choiceRow('Camera view', VIEWS.map(([v, label]) => [v, label] as const), () => d.settings().view, (view) => {
    d.change({ view });
    note.textContent = VIEWS.find(([v]) => v === view)![2];
  });
  note.textContent = VIEWS.find(([v]) => v === d.settings().view)![2];
  return setting('Camera view', 'you', row, note);
}

/** Each pane's builder: what it shows, and what to let go of when the window closes. */
export const PANE_BUILDERS: Record<SettingsPane, (d: SettingsDeps, x: { onCharacter: () => void; outside?: { now: string; live: boolean } }) => Built> = {
  you: (d, x) => together(setting('Your character', null, h('button.btn', { type: 'button', onclick: x.onCharacter }, store.me.account ? '🧍 Change your look' : '🧍 Change your look & name')), cameraSetting(d), consoleSetting(), signedInSetting(d)),
  sound: (d) => soundSettings(d),
  notify: (d) => notifySettings(d),
  building: (d, x) => together(mapSetting(d), holidaySetting(d), x.outside ? skySetting(d, x.outside) : null, dogSettingBuilt(d), workspaceSetting(d)),
  workers: (d) => workersSettings(d),
  // Admins only (ui/connections/): loaded when Settings opens, for an admin.
  connections: () => (store.me.admin ? plain(connectionsPanel().el) : plain()),
};

/** Where ⚙️ Settings was last, so it opens there again. */
let lastPane: SettingsPane = 'you';

/** `outside` describes the sky over the office (see describeSky), once the server has said. `first` opens on that category instead of the last one. */
export function openSettings(net: Net, settings: Settings, onChange: (s: Settings) => void, onCharacter: () => void, sound: Pick<OfficeSound, 'ding' | 'needsYou'>, notifier: DesktopNotifier, onSignOut: () => void, outside?: { now: string; live: boolean }, first?: SettingsPane) {
  const deps: SettingsDeps = {
    net,
    settings: () => settings,
    change: (some) => {
      settings = { ...settings, ...some };
      onChange(settings);
    },
    notifier,
    sound,
    signOut: onSignOut,
  };
  let modalClose = () => {};
  const extra = {
    onCharacter: () => {
      modalClose();
      onCharacter();
    },
    outside,
  };

  // The categories down the side, the one picked on the right.
  const nav = h('nav.settings-nav', { role: 'tablist', 'aria-orientation': 'vertical', 'aria-label': 'Settings' });
  const tabs = new Map<SettingsPane, HTMLButtonElement>();
  const bodies = new Map<SettingsPane, HTMLElement>();
  const offs: (() => void)[] = [];
  for (const p of PANES) {
    if (p.admin && !store.me.admin) continue;
    const built = PANE_BUILDERS[p.id](deps, extra);
    offs.push(built.off);
    const tab = h('button.settings-tab', { type: 'button', role: 'tab', onclick: () => show(p.id) }, h('span.icon', { 'aria-hidden': 'true' }, p.icon), h('span', {}, p.label)) as HTMLButtonElement;
    tabs.set(p.id, tab);
    nav.append(tab);
    bodies.set(p.id, h('section.settings-pane', { role: 'tabpanel', 'aria-label': p.label }, h('div.settings-head', {}, h('h3', {}, `${p.icon} ${p.label}`), h('p', {}, p.blurb)), ...built.nodes));
  }
  // The team, Jeff, the budget, incidents and the rest are on the full Settings page (the 1D view).
  nav.append(h('a.settings-more', { href: settingsHref(undefined, store.floor ?? undefined), title: 'The team, Jeff · Router, the budget, deliverables, incidents, Studio and the rest: the full Settings page, on the 1D view' }, 'All settings ↗'));
  const show = (id: SettingsPane) => {
    lastPane = id;
    for (const [t, tab] of tabs) {
      tab.classList.toggle('on', t === id);
      tab.setAttribute('aria-selected', String(t === id));
      tab.tabIndex = t === id ? 0 : -1;
    }
    for (const [t, body] of bodies) body.classList.toggle('hidden', t !== id);
    bodies.get(id)!.scrollTop = 0;
    // On a phone the categories are a row across the top that scrolls sideways.
    tabs.get(id)!.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  };
  nav.addEventListener('keydown', (e) => {
    const step = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[e.key];
    if (!step) return;
    e.preventDefault();
    const shown = PANES.filter((p) => tabs.has(p.id));
    const i = shown.findIndex((p) => p.id === lastPane);
    const next = shown[(i + step + shown.length) % shown.length].id;
    show(next);
    tabs.get(next)!.focus();
  });

  const close = h('button.btn.close', { 'aria-label': 'Close' }, '✕');
  const el = h('div.modal.settings', { role: 'dialog', 'aria-label': 'Settings' }, h('header', {}, h('h2', {}, '⚙️ Settings'), close), h('div.settings-body', {}, nav, ...bodies.values()));
  const modal = openModal(el, { doing: '⚙️ in settings', onClose: () => offs.forEach((off) => off()) });
  modalClose = () => modal.close();
  show(tabs.has(first ?? lastPane) ? (first ?? lastPane) : 'you');
  close.addEventListener('click', () => modal.close());
}
