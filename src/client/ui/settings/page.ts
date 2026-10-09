// The full ⚙️ Settings page of the flat views: the 1D view's ⚙️ Settings tab (/lite?tab=settings), which
// the 2D view, the home page, the Needs-you strip, the team phone and the docs link to, a section at a
// time (&section=workers). Its sections, down the left in shared/settings-sections.ts's order, are built
// from the builders (you.ts, notify.ts, workers.ts, building.ts) and from the tabs' own settings (the team's, the budget's, the incident rules). Only the section showing
// is built, and put away (its timers and listeners let go) when another is picked.test.ts follows /lite's imports to check.

import './page.css';
import { SETTINGS_SECTIONS, isSettingsSection, settingsSection, type SettingsSectionId } from '../../../shared/settings-sections';
import { store } from '../../state';
import { h } from '../dom';
import { connectionsPanel } from '../connections';
import { plain, setting, together, type Built, type SettingsDeps } from './kit';
import { consoleSetting, signedInSetting } from './you';
import { desktopSetting, teamsCardsSetting, webhookSetting } from './notify';
import { workersSettings } from './workers';
import { budgetPart, rosterPart, studioPart } from './project';
import { advancedPart, appearancePart, incidentsPart } from './office';
import { testingPart } from './testing';
import { dangerPart } from '../project-delete/danger';
import { rerunSetupSetting } from '../../first-run/rerun';

/** Phone alerts: where each phone's own settings are (the team phone's ⚙, the phone version's). */
const phoneAlerts = () =>
  setting(
    'Phone alerts',
    'you',
    h(
      'p.setting-note',
      {},
      'The 📱 Team phone (bottom right on the 1D and 2D views) has its own ⚙: do not disturb, a digest instead of every alert, and its ring. On your phone, the phone version (',
      h('a', { href: '/m' }, '/m'),
      ') asks for push notifications under its ⚙ Phone settings. To reach the office from your phone away from the office’s network, an admin sets up 📱 Phone access under 🔌 Connections.',
    ),
  );

/** What each section shows. Every id in SETTINGS_SECTIONS has one (the typecheck says so). */
export const SECTION_BUILDERS: Record<SettingsSectionId, (d: SettingsDeps) => Built> = {
  you: (d) => together(consoleSetting(), signedInSetting(d)),
  workers: (d) => workersSettings(d),
  team: () => rosterPart('team'),
  jeff: () => rosterPart('jeff'),
  notify: (d) => together(desktopSetting(d), phoneAlerts(), webhookSetting(d), teamsCardsSetting()),
  budget: (d) => budgetPart(d),
  connections: () => (store.me.admin ? plain(rerunSetupSetting(), connectionsPanel().el) : plain(h('p.setting-note', {}, 'Only admins see the office’s connections.'))),
  deliverables: () => rosterPart('deliverables'),
  incidents: () => incidentsPart(),
  studio: () => studioPart(),
  appearance: (d) => appearancePart(d),
  advanced: (d) => advancedPart(d),
  testing: () => testingPart(),
  danger: () => dangerPart(),
};

export interface SettingsPage {
  /** Shows the page at `section` (the one it was last on otherwise), building it afresh. */
  show(section?: SettingsSectionId): void;
  /** Puts the section away (another tab is showing). */
  hide(): void;
  /** The section showing, or last shown. */
  current(): SettingsSectionId;
}

/** Where the page was last, so it opens there again (this browser). */
const KEY = 'agent-office.settings-section';
function remembered(): SettingsSectionId {
  try {
    const s = localStorage.getItem(KEY);
    return isSettingsSection(s) ? s : 'you';
  } catch {
    return 'you';
  }
}

/** Draws the page into `root`. `onSection` hears each section picked (the 1D view puts it in the address). */
export function settingsPage(root: HTMLElement, deps: SettingsDeps, onSection?: (id: SettingsSectionId) => void): SettingsPage {
  let section = remembered();
  let built: Built | undefined;
  let shown = false;
  const visible = () => SETTINGS_SECTIONS.filter((s) => !('admin' in s && s.admin) || store.me.admin);

  const nav = h('nav.settings-nav.fs-nav', { role: 'tablist', 'aria-orientation': 'vertical', 'aria-label': 'Settings sections' });
  const body = h('section.settings-pane.fs-body', { role: 'tabpanel' });
  root.replaceChildren(h('div.fs-page', {}, h('h2.lite-h.fs-title', {}, '⚙️ Settings'), h('div.settings-body.fs-grid', {}, nav, body)));

  const paintNav = () =>
    nav.replaceChildren(
      ...visible().map((s) =>
        h(
          'button.settings-tab',
          { type: 'button', role: 'tab', id: `fs-tab-${s.id}`, 'data-section': s.id, 'aria-selected': String(s.id === section), 'aria-controls': 'fs-body', class: s.id === section ? 'on' : '', tabIndex: s.id === section ? 0 : -1, onclick: () => pick(s.id) },
          h('span.icon', { 'aria-hidden': 'true' }, s.icon),
          h('span', {}, s.label),
        ),
      ),
    );

  const build = () => {
    built?.off();
    const s = settingsSection(section);
    built = SECTION_BUILDERS[section](deps);
    body.id = 'fs-body';
    body.dataset.section = section;
    body.setAttribute('aria-labelledby', `fs-tab-${section}`);
    body.replaceChildren(h('div.settings-head', { id: `settings-${section}` }, h('h3', {}, `${s.icon} ${s.label}`), h('p', {}, s.blurb)), ...built.nodes);
    body.scrollTop = 0;
  };

  const pick = (id: SettingsSectionId) => {
    section = id;
    try {
      localStorage.setItem(KEY, id);
    } catch {
      // Just for this visit.
    }
    onSection?.(id);
    paintNav();
    build();
    nav.querySelector<HTMLElement>(`[data-section="${id}"]`)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  };

  nav.addEventListener('keydown', (e) => {
    const step = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[e.key];
    if (!step) return;
    e.preventDefault();
    const list = visible();
    const i = list.findIndex((s) => s.id === section);
    const next = list[(i + step + list.length) % list.length].id;
    pick(next);
    nav.querySelector<HTMLElement>(`[data-section="${next}"]`)?.focus();
  });

  // Becoming an admin (or not) changes what's listed and what each section lets you do; another floor, what its sections are about.
  const redraw = () => shown && (paintNav(), build());
  store.on('me', () => {
    if (!shown) return;
    const admin = store.me.admin;
    if (admin !== lastAdmin) ((lastAdmin = admin), redraw());
  });
  let lastAdmin = store.me.admin;
  store.on('floor', () => shown && 'floor' in settingsSection(section) && build());

  return {
    show(s) {
      shown = true;
      lastAdmin = store.me.admin;
      if (s) section = s;
      pick(section);
    },
    hide() {
      shown = false;
      built?.off();
      built = undefined;
    },
    current: () => section,
  };
}
