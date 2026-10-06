// The flat Settings page's sections for the whole office that the 3D window doesn't have on their own:
// Incidents (the detection rules, ui/incidents/form.ts), Appearance (the flat views' color theme, yours,
// beside the building's holiday theme and map) and Advanced (the workspace folder, the sky's clock, the
// office dog and where the office keeps its settings). No three.js here.

import '../incidents/ui.css';
import { INCIDENT_RULES, RULE_META, type IncidentSettings } from '../../../shared/incidents';
import { store } from '../../state';
import { h } from '../dom';
import { rulesForm } from '../incidents/form';
import { applyTheme, COLOR_THEMES, currentTheme, THEME_LABEL, type ColorTheme } from '../colortheme';
import { choiceRow } from '../settings-rows';
import { dogSettingBuilt, holidaySetting, mapSetting, skySetting, workspaceSetting } from './building';
import { plain, setting, together, type Built, type SettingsDeps } from './kit';

/** The incident detection rules: each on or off with its numbers; admins edit them (the same window as the Audit log's). */
export function incidentsPart(): Built {
  const list = h('ul.fs-rules', {}, h('li', {}, 'Loading the rules…'));
  const edit = h('button.btn', { type: 'button', disabled: true }, store.me.admin ? '⚙️ Edit the detection rules…' : 'Only admins change the rules');
  let rules: IncidentSettings | undefined;
  let gone = false;
  const load = async () => {
    try {
      const res = await fetch('/api/incidents/settings', { credentials: 'same-origin' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      rules = (await res.json()) as IncidentSettings;
    } catch (err) {
      if (!gone) list.replaceChildren(h('li.bad', {}, `Couldn’t load the rules: ${(err as Error).message}`));
      return;
    }
    if (gone) return;
    const r = rules;
    list.replaceChildren(
      ...INCIDENT_RULES.map((id) => h('li', { class: r.rules[id].on ? 'on' : 'off' }, h('b', {}, `${r.rules[id].on ? 'On' : 'Off'} · ${RULE_META[id].label}`), h('small', {}, RULE_META[id].what))),
      h('li', {}, h('b', {}, `Same incident if seen again within ${r.dedupeHours} hours`)),
    );
    edit.disabled = !store.me.admin;
  };
  edit.addEventListener('click', () => rules && rulesForm(rules, () => void load()));
  void load();
  return {
    nodes: [setting('Detection rules', 'office', list, h('div.seg', {}, edit), h('p.setting-note', {}, 'Each rule opens an incident by itself, or counts again into the open one from the same rule on the same floor. Incidents are on the 🧾 Audit log’s Incidents tab, and the serious ones (sev1, sev2) in Needs you.'))],
    off: () => (gone = true),
  };
}

/** The flat views' color theme, yours alone (the 🎨 on the top bar picks it too). */
export function colorThemeSetting(): HTMLElement {
  const row = choiceRow<ColorTheme>('Color theme', COLOR_THEMES.map((t) => [t, THEME_LABEL[t]] as const), currentTheme, (t) => applyTheme(t, true));
  return setting('Color theme', 'you', row, h('p.setting-note', {}, 'How the 1D view, the 2D view and the home page look in this browser: Default, Dark, Terminal (green on black), or Clean (Light or Dark), plain and without emoji. The 🎨 on the top bar picks it too. The 3D office always wears its own colors.'));
}

/** Appearance: your color theme, and the building's holiday theme and map (everyone's). */
export const appearancePart = (d: SettingsDeps): Built => together(colorThemeSetting(), holidaySetting(d), mapSetting(d));

/** Where the office keeps its settings, for the admin who goes looking. */
const filesNote = () =>
  setting(
    'Settings files',
    null,
    h(
      'p.setting-note',
      {},
      'What’s set here is kept in the office’s data folder (~/agent-office by default): the office’s own settings in office-settings.json and one file each for Teams, keep-awake, incidents and the budget; a project’s team settings with its roster; the tokens in credentials.json, encrypted. Yours (the color theme, the sounds, the Command Center terminal) stay in this browser. Every field, its file and its command-line flag: the docs’ Settings reference (📖 Documentation).',
    ),
  );

/** Advanced: where new projects go, the sky's clock, the dog on this floor, and the files. */
export const advancedPart = (d: SettingsDeps): Built => together(workspaceSetting(d), skySetting(d), dogSettingBuilt(d), plain(filesNote()));
