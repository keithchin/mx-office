// ⚙️ Settings › Notifications: this browser's desktop notifications (yours), the office's Slack /
// Discord webhook and its Microsoft Teams cards (everyone's).

import type { WebhookKind } from '../../../shared/protocol';
import { store } from '../../state';
import { askNotifyPermission, notifyPermission } from '../../notify';
import { h, timeAgo } from '../dom';
import { teamsSetting } from '../settings-teams';
import { framed, setting, together, type Built, type SettingsDeps } from './kit';

const WEBHOOK_NAME: Record<WebhookKind, string> = { slack: 'Slack', discord: 'Discord', other: 'a webhook' };

/** Desktop notifications: this browser's permission, then your own on/off. */
export function desktopSetting(d: SettingsDeps): HTMLElement {
  const row = h('div.seg');
  const note = h('p.setting-note');
  const paint = () => {
    const perm = notifyPermission();
    const on = perm === 'granted' && d.settings().notify;
    row.replaceChildren();
    if (perm === 'default') {
      row.append(
        h(
          'button.btn.primary',
          {
            type: 'button',
            onclick: async () => {
              if ((await askNotifyPermission()) === 'granted') {
                d.change({ notify: true });
                d.notifier.sample();
              }
              paint();
            },
          },
          '🔔 Turn on notifications',
        ),
      );
    } else if (perm === 'granted') {
      for (const [value, label] of [
        [true, '🔔 On'],
        [false, '🔕 Off'],
      ] as const) {
        row.append(h('button.btn', { type: 'button', role: 'radio', 'aria-checked': String(on === value), class: on === value ? 'on' : '', onclick: () => (d.change({ notify: value }), paint()) }, label));
      }
      if (on) row.append(h('button.btn', { type: 'button', onclick: () => d.notifier.sample() }, 'Show me one'));
    }
    note.textContent =
      perm === 'unsupported'
        ? 'This browser can’t show notifications from the office here. They need https or localhost (an SSH tunnel counts).'
        : perm === 'denied'
          ? 'Your browser blocks notifications from the office. Allow them in the site settings (the icon left of the address), then open this again.'
          : 'When an agent needs you or finishes while you’re in another tab or app, you get a notification. Click it to go straight to that agent: you’re put at its desk with its terminal open. The tab title counts the agents waiting on someone either way.';
  };
  paint();
  return setting('Desktop notifications', 'you', row, note);
}

/** The office's Slack / Discord webhook, shared by everyone. */
export function webhookSetting(d: SettingsDeps): Built {
  const { net } = d;
  const status = h('p.setting-note');
  const input = h('input', { type: 'text', placeholder: 'https://hooks.slack.com/services/…', 'aria-label': 'Slack or Discord webhook URL', spellcheck: 'false', autocomplete: 'off' }) as HTMLInputElement;
  const save = h('button.btn.primary', { type: 'button' }, 'Save');
  const test = h('button.btn', { type: 'button', onclick: () => net.send({ t: 'notify.test' }) }, 'Send a test');
  const remove = h('button.btn.danger', { type: 'button', onclick: () => net.send({ t: 'notify.webhook', url: '' }) }, 'Remove');
  const actions = h('div.seg', { style: 'margin-top:8px' }, test, remove);
  const paint = () => {
    const { webhook, error, lastSentAt } = store.notify;
    actions.classList.toggle('hidden', !webhook);
    save.textContent = webhook ? 'Replace' : 'Save';
    status.classList.toggle('bad', !!error);
    status.textContent = !webhook
      ? 'Paste an incoming webhook from Slack or Discord, and the office posts to that channel when an agent needs input or finishes and nobody has its terminal open. It’s for everyone in the office.'
      : error
        ? `⚠️ Posting to ${WEBHOOK_NAME[webhook.kind]} (${webhook.hint}) failed: ${error}`
        : `📣 Posting to ${WEBHOOK_NAME[webhook.kind]} (${webhook.hint}), set by ${webhook.by} ${timeAgo(webhook.at)}${lastSentAt ? ` · last message ${timeAgo(lastSentAt)}` : ''}.`;
  };
  paint();
  const send = () => {
    const url = input.value.trim();
    if (!url) return input.focus();
    net.send({ t: 'notify.webhook', url });
    input.value = '';
  };
  save.addEventListener('click', send);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') send();
  });
  return { nodes: [setting('Team notifications (Slack / Discord)', 'office', h('div.webhook', {}, input, save), actions, status)], off: store.on('notify', paint) };
}

/** Microsoft Teams cards, fetched from the office (settings-teams.ts). */
export function teamsCardsSetting(): Built {
  const t = teamsSetting(framed('Microsoft Teams', 'office'));
  t.section.id = 'settings-teams';
  return { nodes: [t.section], off: t.off };
}

/** The three Notifications has. */
export const notifySettings = (d: SettingsDeps): Built => together(desktopSetting(d), webhookSetting(d), teamsCardsSetting());
