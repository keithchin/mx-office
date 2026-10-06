// The team phone's settings sheet (the ⚙ in its header): Do not disturb (off, until you turn it off,
// for an hour, until 9:00 tomorrow), the digest (alerts that aren't urgent bundled every 15, 30 or 60
// minutes), the sound, and turning on desktop notifications. Kept in this browser. A sheet over the
// phone's screen, with its own ✕ and Esc.

import { DIGEST_CHOICES, dndUntil, isQuiet, type AlertSettings, type DndChoice } from '../../../shared/phone';
import { askNotifyPermission, notifyPermission } from '../../notify';
import { h } from '../dom';

const DND: { v: DndChoice; label: string }[] = [
  { v: 'off', label: 'Off' },
  { v: 'on', label: 'Until I turn it off' },
  { v: '1h', label: 'For 1 hour' },
  { v: 'tomorrow', label: 'Until tomorrow 9:00' },
];

/** Which choice the settings are on now (a timed one that ran out is Off). */
function dndNow(s: AlertSettings, now: number): DndChoice | 'timed' {
  if (!isQuiet(s, now)) return 'off';
  return s.dndUntil === Infinity ? 'on' : 'timed';
}

export function dndLabel(s: AlertSettings, now = Date.now()): string {
  if (!isQuiet(s, now)) return '';
  if (s.dndUntil === Infinity) return 'Do not disturb';
  return `Do not disturb until ${new Date(s.dndUntil).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' })}`;
}

/** The sheet, drawn into `host`; `close` takes it away. */
export function settingsSheet(host: HTMLElement, get: () => AlertSettings, set: (s: AlertSettings) => void, close: () => void): HTMLElement {
  const s = get();
  const now = Date.now();
  const cur = dndNow(s, now);
  const dnd = h(
    'fieldset.tp-field',
    {},
    h('legend', {}, 'Do not disturb'),
    h('p.tp-dim', {}, 'No desktop alerts or sounds. The badge still counts.'),
    ...DND.map((d) =>
      h(
        'label.tp-radio',
        {},
        h('input', { type: 'radio', name: 'tp-dnd', value: d.v, checked: cur === d.v, onchange: () => set({ ...get(), dndUntil: dndUntil(d.v, Date.now()) }) }),
        ` ${d.label}`,
      ),
    ),
    cur === 'timed' ? h('p.tp-dim', {}, dndLabel(s, now)) : null,
  );
  const digest = h(
    'select.tp-select',
    { 'aria-label': 'Digest', onchange: (e: Event) => set({ ...get(), digestMinutes: Number((e.target as HTMLSelectElement).value) }) },
    ...DIGEST_CHOICES.map((m) => h('option', { value: String(m), selected: s.digestMinutes === m }, m ? `Every ${m} minutes` : 'Off: each one as it comes')),
  );
  const sound = h('input', { type: 'checkbox', checked: s.sound, onchange: (e: Event) => set({ ...get(), sound: (e.target as HTMLInputElement).checked }) });
  const perm = notifyPermission();
  const allow =
    perm === 'default'
      ? h('button.btn.small', { type: 'button', onclick: async () => (await askNotifyPermission(), host.replaceChildren(settingsSheet(host, get, set, close))) }, 'Turn on desktop notifications')
      : h('p.tp-dim', {}, perm === 'granted' ? 'Desktop notifications are on in this browser.' : perm === 'denied' ? 'This browser blocks notifications from the office: allow them in its site settings.' : "This browser can't show desktop notifications here (they need https or localhost).");
  const x = h('button.tp-hbtn.close', { type: 'button', 'aria-label': 'Close the settings', title: 'Close (Esc)', onclick: close }, '✕');
  return h(
    'div.tp-sheet',
    { role: 'dialog', 'aria-label': 'Phone settings' },
    h('header.tp-sheet-h', {}, h('h3', {}, 'Phone settings'), x),
    h(
      'div.tp-sheet-body',
      {},
      h('p.tp-dim', {}, 'Alerts and the sound are only for what needs you (the red count), never for a turn the office started.'),
      dnd,
      h('fieldset.tp-field', {}, h('legend', {}, 'Digest'), h('p.tp-dim', {}, 'Bundle the alerts that aren’t urgent into one. Urgent ones (an agent stopped on you, a critical escalation) still come at once.'), digest),
      h('fieldset.tp-field', {}, h('legend', {}, 'Sound'), h('label.tp-radio', {}, sound, ' A short sound with an alert')),
      h('fieldset.tp-field', {}, h('legend', {}, 'Desktop notifications'), allow),
    ),
  );
}
