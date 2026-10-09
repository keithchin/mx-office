// The flat Settings page's sections about the floor you're on: its team (ui/roster/settings.ts, split
// into Team, Jeff · Router and Deliverables), its budget (ui/budget/settings.ts) and its Mendix model in
// Studio Pro (ui/studio/). Admins change them; everyone else sees them read-only, as on the tabs they
// come from.

import '../budget/budget.css';
import type { RosterView } from '../../../shared/roster/types';
import { store } from '../../state';
import { h } from '../dom';
import { fetchRoster } from '../roster/api';
import { settingsView, type RosterSettingsPart } from '../roster/settings';
import { budgetFeed } from '../budget/feed';
import { settingsSection as budgetSettings } from '../budget/settings';
import { studioButton, studioChip, studioState } from '../studio';
import { setting, type Built, type SettingsDeps } from './kit';

/** No floor to show it for (the home page before any project). */
const noFloor = () => h('p.setting-note', {}, 'Open a project first: this is about the project you’re on.');

/** One group of the team settings, fetched for the floor you're on and drawn again after a save. */
export function rosterPart(part: Exclude<RosterSettingsPart, 'all'>): Built {
  const box = h('div.fs-roster', {}, h('p.setting-note', {}, 'Loading the team settings…'));
  const floor = store.floor;
  if (!floor) return { nodes: [noFloor()], off: () => {} };
  let gone = false;
  const draw = (v: RosterView) => !gone && box.replaceChildren(settingsView(v, draw, part));
  fetchRoster(floor).then(draw, (err: Error) => !gone && box.replaceChildren(h('p.setting-note.bad', {}, `Couldn’t load the team settings: ${err.message}`)));
  return { nodes: [box], off: () => (gone = true) };
}

/** The project's budget, alert and auto-pause, its level, and the office's default threshold and currency (admins). */
export function budgetPart({ net }: SettingsDeps): Built {
  if (!store.floor) return { nodes: [noFloor()], off: () => {} };
  const feed = budgetFeed(net);
  const box = h('div.fs-budget', {}, h('p.setting-note', {}, 'Loading the budget…'));
  let gone = false;
  let force = true;
  const refresh = () => ((force = true), feed.refresh());
  const draw = () => {
    if (gone) return;
    const v = feed.floor();
    if (!v) return;
    // Someone typing in a field, or choosing a level: the numbers wait.
    const active = document.activeElement;
    if (!force && ((active && box.contains(active) && /^(INPUT|SELECT|TEXTAREA)$/.test(active.tagName)) || box.querySelector('.bud-levels-box'))) return;
    force = false;
    const el = budgetSettings(v, feed.office(), refresh);
    if (el instanceof HTMLDetailsElement) el.open = true;
    box.replaceChildren(...(el ? [el] : []), h('p.setting-note', {}, 'What the project has spent, by stage, role, agent, model and day, is on the 💰 Budget tab.'));
  };
  feed.on(draw);
  feed.refresh();
  return { nodes: [box], off: () => (gone = true) };
}

/** Studio Pro on the office's computer: Studio mode now, and the button that opens the project there. */
export function studioPart(): Built {
  if (!store.floor) return { nodes: [noFloor()], off: () => {} };
  const now = h('p.outside-now');
  const paint = () => {
    const s = studioState();
    now.textContent = s?.open ? 'Studio Pro has the project open: the agents’ mxcli writes are paused until it’s closed.' : 'Studio Pro doesn’t have the project open: the agents write the model with mxcli.';
  };
  paint();
  const off = store.on('studio', paint);
  return {
    nodes: [
      setting(
        'Open in Studio Pro',
        'floor',
        now,
        h('div.seg', {}, studioButton(), studioChip()),
        h('p.setting-note', {}, 'Opens the project’s .mpr in Studio Pro on the office’s computer, after a confirm that names the agents mid-turn. Only admins open it. While Studio Pro has it open (however it was opened) the office holds the agents’ mxcli writes (the one-writer rule) and shows Studio mode on the Command Center; Needs you says when it closed with model changes nobody committed. Where the Mendix toolkit lives is under 🔌 Connections › Folders.'),
      ),
    ],
    off,
  };
}
