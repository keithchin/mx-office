// ⚙️ Settings: what's yours alone. How loud the office is for you, the alarm when a worker needs you,
// voice chat, the Command Center terminal, and how you're signed in. The camera and your character are
// the 3D office's own (index.ts adds them there). No three.js here: the flat Settings page uses these.

import type { NeedsYouSound, Settings } from '../../state';
import { store } from '../../state';
import { h } from '../dom';
import { choiceRow } from '../settings-rows';
import { consoleViewSetting } from '../pm/chat/setting';
import { plain, setting, type Built, type SettingsDeps } from './kit';

/** A volume slider with its mute button. Dragging it turns the sound back on; letting go plays `preview`. */
function volumeRow(d: SettingsDeps, label: string, level: 'volume' | 'music', muted: 'muted' | 'musicMuted', preview?: () => void) {
  const slider = h('input', { type: 'range', min: 0, max: 100, step: 1, 'aria-label': label }) as HTMLInputElement;
  const pct = h('span.vol-pct');
  const mute = h('button.btn', { type: 'button' });
  const row = h('div.volume', {}, mute, slider, pct);
  const s = () => d.settings();
  const paint = () => {
    const v = Math.round(s()[level] * 100);
    slider.value = String(v);
    slider.style.setProperty('--fill', `${v}%`);
    pct.textContent = s()[muted] ? 'Muted' : `${v}%`;
    mute.textContent = s()[muted] ? '🔊 Unmute' : '🔇 Mute';
    mute.setAttribute('aria-pressed', String(s()[muted]));
    mute.classList.toggle('danger', s()[muted]);
    row.classList.toggle('muted', s()[muted]);
  };
  paint();
  slider.addEventListener('input', () => {
    d.change({ [level]: Number(slider.value) / 100, [muted]: false } as Partial<Settings>);
    paint();
  });
  if (preview) slider.addEventListener('change', preview);
  mute.addEventListener('click', () => {
    d.change({ [muted]: !s()[muted] } as Partial<Settings>);
    paint();
    if (!s()[muted]) preview?.();
  });
  return row;
}

/** The alarm when a worker stops to ask you something; picking one plays it (where there's sound). */
export function alarmSetting(d: SettingsDeps): HTMLElement {
  const row = choiceRow<NeedsYouSound>('When an agent needs you', [['once', '🔔 Ring once'], ['remind', '🔁 Keep reminding me'], ['off', '🔕 Off']], () => d.settings().needsYouSound, (needsYouSound) => {
    d.change({ needsYouSound });
    if (needsYouSound !== 'off') d.sound?.needsYou();
  });
  return setting('When an agent needs you', 'you', row, h('p.setting-note', {}, 'An alarm the moment an agent stops to ask you something or wants a permission. Keep reminding me rings it again, softly, every 30 seconds until someone opens that agent’s terminal. It’s as loud as the office sounds are.'));
}

/** Sound & voice: the office's sounds, the jukebox, page turns and voice chat (yours alone). */
export function soundSettings(d: SettingsDeps): Built {
  const pagesRow = choiceRow('Page turns at the bookshelf', [[true, '📖 On'], [false, 'Off']], () => d.settings().pageTurns, (pageTurns) => d.change({ pageTurns }));
  const talkRow = choiceRow('Voice chat', [[false, '🎙️ Open mic'], [true, '✋ Push to talk']], () => d.settings().pushToTalk, (pushToTalk) => d.change({ pushToTalk }));
  return plain(
    setting('Office sounds', 'you', volumeRow(d, 'Office sounds volume', 'volume', 'muted', () => d.sound?.ding('done')), h('p.setting-note', {}, 'Agents typing, footsteps, the coffee machine, birds and rain outside, the dog, the ding when an agent is done and the alarm when one needs you. Voice chat isn’t affected.')),
    alarmSetting(d),
    setting('Page turns at the bookshelf', 'you', pagesRow, h('p.setting-note', {}, 'A soft swish each time the book in your hands turns a page, as you open a doc or scroll through one. The 🔈 at the top of the bookshelf turns it off too.')),
    setting('Jukebox', 'you', volumeRow(d, 'Jukebox volume', 'music', 'musicMuted'), h('p.setting-note', {}, 'The jukebox in the lounge. Everyone on the floor hears the same song, louder the closer they are to it; this is how loud it is for you alone.')),
    setting('Voice chat', 'you', talkRow, h('p.setting-note', {}, 'Either way, V joins voice, holding V talks and you’re muted once you let go, and M mutes or unmutes. With push to talk you join muted. Leave voice from the ☰ menu.')),
  );
}

/** The Command Center terminal: Chat or Terminal, the view the Project Coordinator console opens in. */
export const consoleSetting = () => setting('Command Center terminal', 'you', ...consoleViewSetting());

/** How you're signed in, and signing out. */
export function signedInSetting(d: SettingsDeps): HTMLElement {
  const account = store.me.account;
  const out = h('button.btn', { type: 'button', onclick: () => d.signOut() }, '🚪 Sign out');
  return setting('Signed in', null, h('div.volume', {}, out), h('p.setting-note', {}, account ? `As ${account.name}, with your own account (${account.role}).` : 'With the shared office password.'));
}
