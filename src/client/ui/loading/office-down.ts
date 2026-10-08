// The office went away under this page: a full-page state instead of a page that just looks stuck.
// "Restarting… reconnecting" when the office said it's restarting (its close code, or an upgrade's
// message before), "The office has stopped" when it said it stopped (Restart safely with no looping
// launcher, Ctrl+C) or went without a word and didn't answer a few reconnects. The reconnects are the
// socket's own (net.ts); nothing here polls. Once the office answers again the page reloads, so it
// comes back on the office's current code and data. Which state is shared/office-down.ts's downState.

import type { Net } from '../../net';
import { DOWN_TEXT, downState, type DownState } from '../../../shared/office-down';
import { h } from '../dom';
import './office-down.css';

let el: HTMLElement | undefined;
let shown: DownState;

function draw(state: DownState) {
  if (state === shown) return;
  shown = state;
  if (!state) return el?.remove();
  const t = DOWN_TEXT[state];
  const box = h(
    'div.ao-down',
    { id: 'ao-down', role: 'alert', 'aria-live': 'assertive', 'data-state': state },
    h('div.ao-down-card', {}, state === 'restarting' ? h('div.ao-down-spin', { 'aria-hidden': 'true' }) : h('div.ao-down-icon', { 'aria-hidden': 'true' }, '⏹'), h('h1.ao-down-title', {}, t.title), h('p.ao-down-body', {}, t.body)),
  );
  if (el) el.replaceWith(box);
  else document.body.append(box);
  el = box;
}

/** Follows `net`: shows the state while the office is away, and reloads the page once it's back after one was shown. */
export function installOfficeDown(net: Net) {
  net.onStatus((up) => {
    if (up) {
      if (shown) location.reload();
      return;
    }
    draw(downState({ code: net.closeCode, failures: net.failures, restartExpected: net.restarting }));
  });
}
