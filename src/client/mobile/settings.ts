// The phone version's ⚙ sheet: push notifications on this phone (on, off, a test), Do not disturb and the
// digest (the team phone's own settings, sent to the office too so pushes follow them), the phones
// signed up on this account (each one revocable), and how to install the app on an iPhone. ✕ or Esc closes.

import { DIGEST_CHOICES, dndUntil, isQuiet, type AlertSettings, type DndChoice } from '../../shared/phone';
import { h, openModal, timeAgo, toast } from '../ui/dom';
import { loadAlerts, saveAlerts } from '../ui/phone/alerts';
import { dndLabel } from '../ui/phone/settings';
import { mobileApi, type MeView } from './api';
import { disablePush, enablePush, isIos, pushState, savedSubId, type PushState } from './push';

const DND: { v: DndChoice; label: string }[] = [
  { v: 'off', label: 'Off' },
  { v: '1h', label: '1 hour' },
  { v: 'tomorrow', label: 'Until 9:00' },
  { v: 'on', label: 'On' },
];

/** How to put the office on an iPhone's home screen (push only works from there). */
export function installSteps(): HTMLElement {
  return h(
    'ol.m-steps',
    {},
    h('li', {}, 'Open this page in ', h('b', {}, 'Safari'), ' (not inside Teams or another app).'),
    h('li', {}, 'Tap ', h('b', {}, 'Share'), ' ', h('span.m-share', { 'aria-label': 'the Share button' }, '⬆︎'), ' at the bottom of the screen.'),
    h('li', {}, 'Scroll down and tap ', h('b', {}, 'Add to Home Screen'), ', then ', h('b', {}, 'Add'), '.'),
    h('li', {}, 'Open ', h('b', {}, 'Agent Office'), ' from your home screen, then ⚙ → ', h('b', {}, 'Turn on notifications'), '.'),
  );
}

const STATE_TEXT: Record<PushState, string> = {
  unsupported: 'This browser can’t get push notifications.',
  insecure: 'Push needs https: open the office through 📱 Phone access (⚙️ Settings › 🔌 Connections, on the office’s 1D view on a computer: /lite?tab=settings&section=connections).',
  'install-first': 'On an iPhone, push only works once the office is on your home screen:',
  denied: 'Notifications are blocked for the office: allow them in Settings → Notifications → Agent Office, then come back.',
  off: 'Off on this phone. Turn them on to hear about red items (an agent stopped on you, an escalation, failing checks) even with the app closed.',
  on: 'On: red items arrive here, under Do not disturb and the digest below.',
};

export function openSettings(me: MeView | undefined, onChange: () => void) {
  const body = h('div.body.m-settings');
  const close = h('button.btn.close', { type: 'button', 'aria-label': 'Close' }, '✕');
  const modal = openModal(h('div.modal.m-sheet', { role: 'dialog', 'aria-label': 'Phone settings' }, h('header', {}, h('h2', {}, '⚙ Phone settings'), close), body), { doing: '📱 in settings' });
  close.addEventListener('click', () => modal.close());

  const setAlerts = (s: AlertSettings) => {
    saveAlerts(s);
    const id = savedSubId();
    if (id) void mobileApi.alerts(id, s).catch(() => undefined);
    onChange();
    void paint();
  };

  async function paint() {
    const s = loadAlerts();
    const phones = me?.phones ?? [];
    const state = await pushState(phones);
    const now = Date.now();
    const cur: DndChoice | 'timed' = !isQuiet(s, now) ? 'off' : s.dndUntil === Infinity ? 'on' : 'timed';
    const pushBtns: HTMLElement[] = [];
    if (state === 'off') {
      pushBtns.push(
        h('button.btn.primary', {
          type: 'button',
          onclick: async (e: Event) => {
            (e.target as HTMLButtonElement).disabled = true;
            const err = await enablePush(loadAlerts());
            if (err) toast(err, 'warn');
            else toast('🔔 Push notifications are on');
            if (me) me.phones = await mobileApi.me().then((m) => m.phones).catch(() => me.phones);
            void paint();
          },
        }, '🔔 Turn on notifications'),
      );
    }
    if (state === 'on') {
      const id = savedSubId()!;
      pushBtns.push(
        h('button.btn', { type: 'button', onclick: () => void mobileApi.testPush(id).then(() => toast('Sent: it should arrive in a moment'), (x) => toast((x as Error).message, 'warn')) }, 'Send a test'),
        h('button.btn', {
          type: 'button',
          onclick: async () => {
            await disablePush();
            if (me) me.phones = me.phones.filter((p) => p.id !== id);
            void paint();
          },
        }, 'Turn off'),
      );
    }
    body.replaceChildren(
      h('section.m-field', {}, h('h3', {}, '🔔 Notifications on this phone'), h('p.m-dim', {}, STATE_TEXT[state]), state === 'install-first' ? installSteps() : null, pushBtns.length ? h('div.m-acts', {}, ...pushBtns) : null),
      h(
        'section.m-field',
        {},
        h('h3', {}, '🌙 Do not disturb'),
        h('div.m-seg', { role: 'group', 'aria-label': 'Do not disturb' }, ...DND.map((d) => h('button.m-seg-b', { type: 'button', 'aria-pressed': String(cur === d.v), onclick: () => setAlerts({ ...loadAlerts(), dndUntil: dndUntil(d.v, Date.now()) }) }, d.label))),
        cur === 'timed' ? h('p.m-dim', {}, dndLabel(s, now)) : null,
      ),
      h(
        'section.m-field',
        {},
        h('h3', {}, '🗞 Digest'),
        h('p.m-dim', {}, 'Bundle what isn’t blocking into one notification. An agent stopped on you, or a critical escalation, still comes at once.'),
        h('div.m-seg', { role: 'group', 'aria-label': 'Digest' }, ...DIGEST_CHOICES.map((m) => h('button.m-seg-b', { type: 'button', 'aria-pressed': String(s.digestMinutes === m), onclick: () => setAlerts({ ...loadAlerts(), digestMinutes: m }) }, m ? `${m} min` : 'Off'))),
      ),
      phones.length
        ? h(
            'section.m-field',
            {},
            h('h3', {}, '📱 Your phones'),
            h(
              'ul.m-phones',
              {},
              ...phones.map((p) =>
                h(
                  'li',
                  {},
                  h('span', {}, h('b', {}, p.device), h('small.m-dim', {}, ` since ${new Date(p.createdAt).toLocaleDateString()}${p.lastOkAt ? ` · last ${timeAgo(p.lastOkAt)}` : ''}${p.id === savedSubId() ? ' · this one' : ''}`), p.lastError ? h('small.m-err', {}, ` ${p.lastError}`) : null),
                  h('button.btn.small', {
                    type: 'button',
                    'aria-label': `Stop notifications on ${p.device}`,
                    onclick: async () => {
                      if (p.id === savedSubId()) await disablePush();
                      else await mobileApi.unsubscribe(p.id).catch(() => undefined);
                      if (me) me.phones = me.phones.filter((x) => x.id !== p.id);
                      void paint();
                    },
                  }, 'Remove'),
                ),
              ),
            ),
          )
        : '',
      isIos() ? '' : h('section.m-field', {}, h('h3', {}, '➕ Install'), h('p.m-dim', {}, 'On Android or a desktop browser, use the browser’s menu → Install app (or Add to Home screen).')),
      h('p.m-dim.m-foot', {}, h('a', { href: '/lite' }, 'Open the full office (1D view)'), ' · ', h('a', { href: '/docs/using-the-office/phone-version' }, 'Help')),
    );
  }
  void paint();
}
