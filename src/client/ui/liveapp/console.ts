// The live app's Console on the 🌐 Live app tab, like Studio Pro's: the Runtime log (console-log.ts) and
// the Network (console-net.ts), on two tabs with their counts (errors in the log, failed requests).
//
// The office streams them only while the Console is showing (server/liveapp/console/): the page says
// `liveapp.console on` when the Live app tab is in view and the browser tab visible, and off when not; a
// reconnect (welcome) or another floor asks again. What came while it wasn't showing is still sent on the
// way back (the office keeps the last requests and reads the log on from where it was).

import type { Net } from '../../net';
import type { ServerMsg } from '../../../shared/protocol';
import { h } from '../dom';
import { logPane } from './console-log';
import { netPane } from './console-net';
import './console.css';

export interface LiveConsole {
  readonly el: HTMLElement;
  route(msg: ServerMsg, floor: string | null): void;
  /** Whether the Console is in view (the tab showing, the app known): streams start and stop with it. */
  setShown(shown: boolean): void;
  /** The address requests are recorded through, or null when they aren't. */
  setRecording(url: string | null): void;
  /** Errors in the log since its Clear (for a badge elsewhere). */
  errors(): number;
}

type Which = 'log' | 'net';

export function liveConsole(net: Net): LiveConsole {
  const log = logPane();
  const reqs = netPane();
  let which: Which = 'log';
  let shown = false;
  let sent = false;

  const tab = (w: Which, label: string) => {
    const b = h('button.lc-tab', { type: 'button', role: 'tab', id: `lc-tab-${w}`, 'aria-controls': `lc-panel-${w}`, 'aria-selected': String(w === which) }, label) as HTMLButtonElement;
    b.addEventListener('click', () => pick(w));
    b.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      e.preventDefault();
      pick(w === 'log' ? 'net' : 'log');
      (w === 'log' ? netTab : logTab).focus();
    });
    return b;
  };
  const logTab = tab('log', 'Runtime log');
  const netTab = tab('net', 'Network');
  const logBadge = h('span.lc-badge', { hidden: true });
  const netBadge = h('span.lc-badge', { hidden: true });
  logTab.append(logBadge);
  netTab.append(netBadge);
  const logPanel = h('div.lc-panel', { role: 'tabpanel', id: 'lc-panel-log', 'aria-labelledby': 'lc-tab-log' }, log.el);
  const netPanel = h('div.lc-panel', { role: 'tabpanel', id: 'lc-panel-net', 'aria-labelledby': 'lc-tab-net', hidden: true }, reqs.el);
  const el = h('section.lc', { 'aria-label': 'Console' }, h('div.lc-head', {}, h('h3.lc-title', {}, 'Console'), h('div.lc-tabs', { role: 'tablist', 'aria-label': 'Console' }, logTab, netTab)), logPanel, netPanel);

  function pick(w: Which) {
    which = w;
    logTab.setAttribute('aria-selected', String(w === 'log'));
    netTab.setAttribute('aria-selected', String(w === 'net'));
    logTab.tabIndex = w === 'log' ? 0 : -1;
    netTab.tabIndex = w === 'net' ? 0 : -1;
    logPanel.hidden = w !== 'log';
    netPanel.hidden = w !== 'net';
  }
  pick('log');

  function badges() {
    const e = log.errors();
    logBadge.hidden = !e;
    logBadge.textContent = String(e);
    logBadge.title = `${e} error${e === 1 ? '' : 's'} in the runtime log`;
    const f = reqs.failures();
    netBadge.hidden = !f;
    netBadge.textContent = String(f);
    netBadge.title = `${f} failed request${f === 1 ? '' : 's'}`;
  }
  log.onCount = badges;
  reqs.onCount = badges;

  /** Tells the office whether to stream, when that changed. */
  function sync(force = false) {
    const want = shown && document.visibilityState !== 'hidden';
    if (want === sent && !force) return;
    sent = want;
    net.send({ t: 'liveapp.console', on: want });
  }
  document.addEventListener('visibilitychange', () => sync());

  return {
    el,
    route(msg, floor) {
      if (msg.t === 'welcome' || msg.t === 'floor.enter') {
        // The office forgot (a new connection) or it's another floor: start over, and ask again if showing.
        log.put([], true);
        reqs.put([], true);
        if (sent) {
          sent = false;
          sync();
        }
        return;
      }
      if (msg.t !== 'liveapp.console' || msg.floor !== floor) return;
      if (msg.log || msg.reset) log.put(msg.log ?? [], !!msg.reset);
      if (msg.net || msg.reset) reqs.put(msg.net ?? [], !!msg.reset);
      if (msg.logMissing !== undefined) log.missing(msg.logMissing);
    },
    setShown(on) {
      shown = on;
      sync();
    },
    setRecording: (url) => reqs.setRecording(url),
    errors: () => log.errors(),
  };
}
