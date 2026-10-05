// The 🌐 Live app tab of the 1D view: the floor's Mendix app, built from main and run on the office's
// machine (server/liveapp/), with ▶ / ⟳ / ■, the commit it runs, and the app itself in a frame. And
// the small chip in the project summary that says how it is and leads here. No three.js here: the
// 1D view imports it.

import type { Net } from '../net';
import type { LiveAppState, LiveAppStatus, ServerMsg } from '../../shared/protocol';
import { store } from '../state';
import { h, timeAgo } from './dom';
import './liveapp.css';

const WORD: Record<LiveAppStatus, string> = {
  stopped: 'stopped',
  starting: 'starting…',
  running: 'running',
  updating: 'updating…',
  stopping: 'stopping…',
  failed: 'failed',
};

export interface LiveAppView {
  /** Every server message: the floor's app changed, or you came onto a floor (then it asks). */
  route(msg: ServerMsg): void;
  /** Draws the tab into `root` (the frame is kept between draws, so the app isn't reloaded). */
  render(root: HTMLElement): void;
  /** Puts the chip into the project summary's heading in `summary`, after it was drawn. */
  mountChip(summary: HTMLElement): void;
  /** How the floor's app is, once the office said (null before). */
  current(): LiveAppState | null;
}

const short = (sha?: string) => sha?.slice(0, 7) ?? '';

/** The app's address as this browser reaches the office's machine: its port there, over plain HTTP (mxcli serves no TLS). */
export const appUrl = (s: LiveAppState) => (s.appPort ? `http://${location.hostname}:${s.appPort}/` : '');

/** `openTab` shows the 🌐 Live app tab (the chip's click); `visible` says whether it's the tab showing now. */
export function liveAppView(net: Net, openTab: () => void, visible: () => boolean): LiveAppView {
  let state: LiveAppState | null = null;
  let root: HTMLElement | null = null;
  const frame = h('iframe.la-frame', { title: 'The live app', referrerpolicy: 'no-referrer' }) as HTMLIFrameElement;
  // Taking a frame out of the page reloads it, so it stays put and only what's above it is redrawn.
  const top = h('div.la-top');
  const frameBox = h('div.la-framebox', { hidden: true }, frame);
  /** What the frame was last pointed at: a new start (or commit) loads the app again. */
  let loaded = '';
  const chip = h('button.la-chip', { type: 'button', title: "The floor's app, running from main: open the 🌐 Live app tab", onclick: openTab });

  const ask = () => net.send({ t: 'liveapp.status' });

  function drawChip() {
    const s = state;
    chip.className = `la-chip ${s?.status ?? 'stopped'}`;
    const what = !s ? '…' : s.status === 'running' ? `running · ${short(s.sha)}` : s.status === 'updating' ? `updating to ${short(s.sha)}…` : WORD[s.status];
    chip.textContent = `🌐 Live app: ${what}`;
  }

  function draw() {
    drawChip();
    if (!root || !visible()) return;
    const s = state;
    if (!s) {
      frameBox.hidden = true;
      return void top.replaceChildren(h('p.la-empty', {}, 'Asking the office about the live app…'));
    }
    const up = s.status === 'starting' || s.status === 'updating' || s.status === 'running';
    const busy = s.status === 'stopping';
    const send = (t: 'liveapp.start' | 'liveapp.restart' | 'liveapp.stop') => () => net.send({ t });
    // Only admins run it (it starts processes on the office's machine); everyone else watches.
    const admin = store.me.admin;
    const url = s.status === 'running' ? appUrl(s) : '';
    const commit = s.sha
      ? h('span.la-commit', { title: s.subject ?? '' }, '📦 ', h('code', {}, short(s.sha)), ' ', h('span.la-subject', {}, s.subject ?? ''), s.branch ? h('small', {}, ` on ${s.branch}`) : null)
      : null;
    const bar = h(
      'div.la-bar',
      {},
      h('span', { class: `pill la-pill ${s.status}` }, WORD[s.status]),
      !admin || up || busy ? null : h('button.btn.primary', { type: 'button', disabled: !s.available, onclick: send('liveapp.start'), title: 'Build main and run it on the office' }, '▶ Start'),
      admin && up ? h('button.btn', { type: 'button', onclick: send('liveapp.restart'), title: 'Stop it and start it again on the newest main' }, '⟳ Restart') : null,
      admin && up ? h('button.btn', { type: 'button', onclick: send('liveapp.stop'), title: 'Stop the app and free its ports' }, '■ Stop') : null,
      admin ? null : h('small.la-note', {}, 'Only admins start or stop the live app'),
      commit,
      url ? h('a.btn.la-open', { href: url, target: '_blank', rel: 'noopener noreferrer' }, 'Open in new tab ↗') : null,
    );
    const said = [s.message, s.by && s.since ? `${s.by} · ${timeAgo(s.since)}` : s.by].filter(Boolean).join(' — ');
    const note = said ? h('p.la-note', {}, said) : null;
    const hint = !s.available ? h('p.la-note.bad', {}, "mxcli isn't installed where the office runs, so it can't run the app (AGENT_OFFICE_LIVE_MXCLI).") : null;
    const log = s.status !== 'running' && s.log.length ? h('pre.la-log', {}, s.log.join('\n')) : null;
    if (url) {
      const key = `${url}@${s.sha}@${s.since}`;
      if (key !== loaded) {
        loaded = key;
        frame.src = url;
      }
    } else if (loaded) {
      loaded = '';
      frame.removeAttribute('src');
    }
    const mixed = url && location.protocol === 'https:' ? h('p.la-note', {}, 'This page is on HTTPS and the app on plain HTTP, so the browser may not show it here: use Open in new tab.') : null;
    const empty = url || up || s.status === 'failed' ? null : h('p.la-empty', {}, "The app isn't running. ▶ Start builds the floor's main branch and runs it here; it follows main as PRs merge.");
    top.replaceChildren(bar, ...([note, hint, mixed, log, empty] as (HTMLElement | null)[]).filter((e): e is HTMLElement => !!e));
    frameBox.hidden = !url;
    if (log) log.scrollTop = log.scrollHeight;
  }

  return {
    route(msg) {
      if (msg.t === 'welcome' || msg.t === 'floor.enter') {
        state = null;
        draw();
        ask();
      } else if (msg.t === 'liveapp.state' && msg.state.floor === store.floor) {
        state = msg.state;
        draw();
      }
    },
    render(el) {
      if (root !== el) {
        root = el;
        root.classList.add('la');
        root.replaceChildren(top, frameBox);
      }
      if (!state) ask();
      draw();
    },
    current: () => state,
    mountChip(summary) {
      drawChip();
      const at = summary.querySelector('.sm-name');
      if (at && chip.parentElement !== at) at.append(chip);
    },
  };
}
