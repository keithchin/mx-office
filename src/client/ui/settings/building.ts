// ⚙️ Settings: the building, for everyone. The map, the holiday theme, the sky's clock, the office dog
// and where new projects are cloned. The 3D window has them under Building; the flat Settings page under
// Appearance (map, holiday) and Advanced (the rest). No three.js here.

import type { ThemePick } from '../../../shared/protocol';
import { THEME_PICKS } from '../../../shared/theme';
import { mapChoices } from '../../../shared/maps';
import { store } from '../../state';
import { h, timeAgo } from '../dom';
import { dogSetting } from '../settings-dog';
import { outsideSetting } from '../settings-sky';
import { framed, setting, type Built, type SettingsDeps } from './kit';

const THEME_LABEL: Record<ThemePick, string> = { auto: '📅 By the calendar', halloween: '🎃 Halloween', christmas: '🎄 Christmas', off: 'Off' };

/** The building's holiday theme, for everyone. */
export function holidaySetting({ net }: SettingsDeps): Built {
  const row = h('div.seg', { role: 'radiogroup', 'aria-label': 'Holiday theme' });
  const note = h('p.setting-note');
  const paint = () => {
    const { pick, active, by, at } = store.theme;
    row.replaceChildren(
      ...THEME_PICKS.map((p) => h('button.btn', { type: 'button', role: 'radio', 'aria-checked': String(pick === p), class: pick === p ? 'on' : '', onclick: () => store.theme.pick !== p && net.send({ t: 'theme.set', pick: p }) }, THEME_LABEL[p])),
    );
    const now =
      active === 'halloween'
        ? 'Halloween: the agents are zombies, your hands are an undead warlock’s, the dog’s in costume, the sky’s gone creepy and there are jack-o’-lanterns everywhere.'
        : active === 'christmas'
          ? 'Christmas: the agents are elves, your hands are in mittens, the dog’s Rudolph, and it’s snowing outside.'
          : 'No decorations up right now.';
    const how = pick === 'auto' ? ' By the calendar it’s Halloween through October and Christmas through December.' : '';
    note.textContent = `${now}${how} It’s the same for everyone in the building${by ? `, set by ${by}${at ? ` ${timeAgo(at)}` : ''}` : ''}.`;
  };
  paint();
  return { nodes: [setting('Holiday theme', 'office', row, note)], off: store.on('theme', paint) };
}

/**
 * The building's map, for everyone: the office, the castle, the space station, or one of your own.
 * Making it has the office read its folder of maps again, so one you just added or fixed shows up.
 */
export function mapSetting({ net }: SettingsDeps): Built {
  net.send({ t: 'map.set' });
  const row = h('div.seg', { role: 'radiogroup', 'aria-label': 'Map' });
  const note = h('p.setting-note');
  const bad = h('p.setting-note.bad', { style: 'white-space: pre-line' });
  const paint = () => {
    const { pick, by, at, custom } = store.map;
    const choices = mapChoices(custom);
    row.replaceChildren(
      ...choices.map((m) =>
        h(
          'button.btn',
          {
            type: 'button',
            role: 'radio',
            'aria-checked': String(pick === m.id),
            class: pick === m.id ? 'on' : '',
            disabled: !!m.error,
            title: m.error ? `${m.id} won't load: ${m.error}` : m.description,
            onclick: () => !m.error && store.map.pick !== m.id && net.send({ t: 'map.set', map: m.id }),
          },
          `${m.icon} ${m.name}`,
        ),
      ),
    );
    const now = choices.find((m) => m.id === pick) ?? choices[0];
    note.textContent = `${now.description} It’s the same on every floor, for everyone in the building${by ? `, picked by ${by}${at ? ` ${timeAgo(at)}` : ''}` : ''}. Maps of your own go in the office’s .agent-office/maps/ folder as JSON (see docs/maps.md).`;
    const broken = choices.filter((m) => m.error);
    bad.textContent = broken.map((m) => `⚠️ ${m.id} won't load: ${m.error}`).join('\n');
    bad.hidden = !broken.length;
  };
  paint();
  return { nodes: [setting('Map', 'office', row, note, bad)], off: store.on('map', paint) };
}

/** What the sky's doing, and which clock it keeps (settings-sky.ts). `outside` is the 3D office's words for it. */
export function skySetting({ net }: SettingsDeps, outside?: { now: string; live: boolean }): Built {
  const sky = outsideSetting(net, outside, framed('Outside', 'office'));
  return { nodes: [sky.section], off: sky.off };
}

/** The dog on this floor: its name, breed and coat, for everyone here (settings-dog.ts). */
export function dogSettingBuilt({ net }: SettingsDeps): Built {
  const dog = dogSetting(net, framed('Office dog', 'floor'));
  return { nodes: [dog.section], off: store.on('dog', dog.paint) };
}

/** Where the elevator clones new projects on the office's machine. Admins move it. */
export function workspaceSetting({ net }: SettingsDeps): Built {
  const input = h('input', { type: 'text', placeholder: '~/Workspace', 'aria-label': 'Workspace folder', spellcheck: 'false', autocomplete: 'off' }) as HTMLInputElement;
  const save = h('button.btn.primary', { type: 'button' }, 'Save');
  const back = h('button.btn', { type: 'button', onclick: () => net.send({ t: 'floor.projectsDir', dir: '' }) }, 'Use the default');
  const row = h('div.webhook', {}, input, save);
  const actions = h('div.seg', { style: 'margin-top:8px' }, back);
  const note = h('p.setting-note');
  const paint = () => {
    const { dir, custom, by, at } = store.projectsDir;
    const admin = store.me.admin;
    input.value = dir;
    row.classList.toggle('hidden', !admin);
    actions.classList.toggle('hidden', !admin || !custom);
    note.textContent =
      `New projects from the elevator are cloned into ${dir}/<owner>/<repo> on the office’s machine.` +
      (custom && by && at ? ` Set by ${by} ${timeAgo(at)}.` : '') +
      (admin ? ' A checkout of the same repository that’s already there is used as it is. Floors you already have stay where they are.' : ' An admin can move it.');
  };
  paint();
  const send = () => {
    const dir = input.value.trim();
    if (!dir) return input.focus();
    if (dir !== store.projectsDir.dir) net.send({ t: 'floor.projectsDir', dir });
  };
  save.addEventListener('click', send);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') send();
  });
  const offs = [store.on('projectsDir', paint), store.on('me', paint)];
  return { nodes: [setting('Workspace folder', 'office', row, actions, note)], off: () => offs.forEach((off) => off()) };
}
