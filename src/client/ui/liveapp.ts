// The 🌐 Live app tab of the 1D view: the floor's Mendix app, built from main and run on the office's
// machine (server/liveapp/), with ▶ / ⟳ / ■, the honest status (running, building, stopped: crashed at
// 10:27, not started), the served commit (the one actually answering) against the one it's updating to
// ("Running abc1234 · updating to def5678…") and against main, whether it's ready by milestone
// (ui/liveapp/readiness.ts), Open live app (ui/liveapp/open.ts: the app top-level in a window of its own,
// through the office's recording proxy; the frame of ui/liveapp/viewer.ts only as a preview, when asked
// for), and the Console (ui/liveapp/console.ts: the runtime log and the app's requests). And the chip in
// the project summary that says how it is and leads here.

import type { Net } from '../net';
import type { LiveAppState, ServerMsg } from '../../shared/protocol';
import { builtLine, commitLine, liveStatus, revisionLine, stamp } from '../../shared/liveapp/status';
import { store } from '../state';
import { h, timeAgo } from './dom';
import { readinessCard } from './liveapp/readiness';
import { liveViewer } from './liveapp/viewer';
import { desktopEmbed, liveEmbed } from './liveapp/embed';
import { liveConsole } from './liveapp/console';
import { sessionCapHint } from './liveapp/session-cap';
import { liveUrl, openPanel } from './liveapp/open';
import { aheadBanner } from './branch-ahead/banner';
import { walkLinks } from './walkthroughs/links';
import { businessNow, onBusiness, wantBusiness } from './business-status/feed';
import './liveapp.css';

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

/** The app's address as this browser reaches the office's machine (through the recording proxy when it's up: ui/liveapp/open.ts). */
export const appUrl = (s: LiveAppState) => liveUrl(s, location.hostname);

/**
 * What the Overview and View App say about it: the status word, the address when it runs, the project's
 * business status (shared/business-status.ts, ui/business-status/feed.ts: the same words as Home, the
 * progress bar and the phone), and what serves against what it's updating to.
 */
export function liveSummary(s: LiveAppState | null): { status: string; word: string; url?: string; business?: { label: string; line: string }; revision?: string } | undefined {
  if (!s) return undefined;
  const revision = revisionLine(s);
  const b = businessNow(s.floor)?.project;
  return { status: s.status, word: liveStatus(s).word, ...(s.status === 'running' && appUrl(s) ? { url: appUrl(s) } : {}), ...(b ? { business: { label: b.label, line: b.line } } : {}), ...(revision ? { revision } : {}) };
}

/** What a change of the live app's state asks the business status again for: what it runs and what that has of the plan. */
export const businessKey = (s: LiveAppState | null) => (s ? `${s.status}|${s.served?.sha ?? ''}|${s.readiness?.at ?? ''}|${s.main?.sha ?? ''}` : '');

/** `openTab` shows the 🌐 Live app tab (the chip's click); `visible` says whether it's the tab showing now. */
export function liveAppView(net: Net, openTab: () => void, visible: () => boolean): LiveAppView {
  let state: LiveAppState | null = null;
  let root: HTMLElement | null = null;
  // Taking a frame out of the page reloads it, so the viewer stays put and only what's above it is redrawn.
  const top = h('div.la-top');
  // In the desktop app, Show here: the app top-level in a native view over the tab (ui/liveapp/embed.ts); in a browser, the preview frame.
  const bridge = desktopEmbed();
  const viewer = bridge ? liveEmbed(bridge, () => store.floor ?? '') : liveViewer();
  const opener = openPanel(!!bridge);
  const panel = liveConsole(net);
  // The app refused a session (an unlicensed app keeps only 6): said here, from what the Console streams.
  const cap = sessionCapHint();
  // The way to 🎬 Walkthroughs (ui/walkthroughs/), and the readiness card's link to a ready milestone's video.
  const walks = walkLinks();
  walks.onChange = () => draw();
  opener.onPreview = () => draw();
  const banner = aheadBanner('live', { openModel: () => document.getElementById('tab-model')?.click() });
  const chip = h('button.la-chip', { type: 'button', title: "The project's app, running from main: open the 🌐 Live app tab", onclick: openTab });

  const ask = () => net.send({ t: 'liveapp.status' });
  onBusiness(() => drawChip());

  function drawChip() {
    const s = state;
    const st = liveStatus(s);
    chip.className = `la-chip ${s?.status ?? 'stopped'} ${st.tone}`;
    // The work's status is the business status (shared/business-status.ts), never a second "ready" of its own.
    const biz = s ? businessNow(s.floor)?.project : undefined;
    const what = s?.status === 'running' && s.served ? `running · ${short(s.served.sha)}${s.failure?.kind === 'update' ? ' · update failed' : ''}${biz ? ` · ${biz.label}` : ''}` : s && s.status !== 'stopped' ? revisionLine(s) || st.word : st.word;
    chip.textContent = `🌐 Live app: ${what}`;
    chip.title = [biz?.line, s?.readiness?.headline].filter(Boolean).join('\n') || "The project's app, running from main: open the 🌐 Live app tab";
  }

  function draw() {
    drawChip();
    panel.setShown(!!root && visible() && !root.classList.contains('hidden') && !!state);
    if (!root || !visible()) return;
    const s = state;
    if (!s) {
      viewer.hide();
      opener.hide();
      return void top.replaceChildren(h('p.la-empty', {}, 'Asking the office about the live app…'));
    }
    const up = s.status === 'starting' || s.status === 'updating' || s.status === 'running';
    const busy = s.status === 'stopping';
    const send = (t: 'liveapp.start' | 'liveapp.restart' | 'liveapp.stop') => () => net.send({ t });
    // Only admins run it (it starts processes on the office's machine); everyone else watches.
    const admin = store.me.admin;
    const url = s.status === 'running' ? appUrl(s) : '';
    const st = liveStatus(s);
    const crashed = s.status === 'failed';
    const line = commitLine(s);
    // The served build only: what it's building or updating to is the revision line's.
    const on = s.served;
    const commit = on
      ? h('span.la-commit', { title: on.subject ?? '' }, '📦 ', h('code', {}, line || short(on.sha)), ' ', h('span.la-subject', {}, on.subject ?? ''), builtLine(s) ? h('small', {}, ` · ${builtLine(s)}`) : null)
      : null;
    const rev = revisionLine(s);
    const revision = rev && rev !== `Running ${short(on?.sha)}` ? h('span.la-rev', { role: 'status', title: s.target?.subject ?? '' }, rev) : null;
    const bar = h(
      'div.la-bar',
      {},
      h('span', { class: `pill la-pill ${s.status} ${st.tone}` }, st.word),
      !admin || up || busy ? null : h('button.btn.primary', { type: 'button', disabled: !s.available, onclick: send(crashed ? 'liveapp.restart' : 'liveapp.start'), title: crashed ? 'Start it again on the newest main' : 'Build main and run it on the office' }, crashed ? '⟳ Restart' : '▶ Start'),
      admin && up ? h('button.btn', { type: 'button', onclick: send('liveapp.restart'), title: 'Stop it and start it again on the newest main' }, '⟳ Restart') : null,
      admin && up ? h('button.btn', { type: 'button', onclick: send('liveapp.stop'), title: 'Stop the app and free its ports' }, '■ Stop') : null,
      admin ? null : h('small.la-note', {}, 'Only admins start or stop the live app'),
      revision,
      commit,
    );
    const said = crashed ? '' : [s.message, s.by && s.since ? `${s.by} · ${timeAgo(s.since)}` : s.by].filter(Boolean).join(' — ');
    const note = said ? h('p.la-note', {}, said) : null;
    const f = s.failure;
    const failed = crashed
      ? h('div.la-failed', { role: 'alert' }, h('p.la-note.bad', {}, f ? `${f.kind === 'crash' ? `The app stopped by itself at ${stamp(f.at)}` : f.kind === 'timeout' ? `It didn't come up; gave up at ${stamp(f.at)}` : `The build failed at ${stamp(f.at)}`}${f.sha ? ` (${s.branch ?? 'main'} @${short(f.sha)})` : ''}: ${f.why}` : (s.message ?? 'It failed.')), admin ? null : h('p.la-note', {}, 'An admin can restart it.'))
      : null;
    const refresh = s.refresh && !s.refresh.ok && (up || crashed) ? h('p.la-note.bad', {}, `Live app can't check for updates: ${s.refresh.error ?? 'unknown error'}${on ? `. Running ${commitLine({ ...s, main: undefined })}` : ''}.`) : null;
    const hint = !s.available ? h('p.la-note.bad', {}, "mxcli isn't installed where the office runs, so it can't run the app (AGENT_OFFICE_LIVE_MXCLI).") : null;
    const lines = crashed && f?.lines.length ? f.lines : s.log;
    const log = s.status !== 'running' && lines.length ? h('pre.la-log', {}, lines.join('\n')) : null;
    if (url) opener.show(url, s.floor, !!s.viewPort);
    else opener.hide();
    panel.setRecording(url && s.viewPort ? url : null);
    if (url && opener.previewing()) viewer.show(url, `${on?.sha ?? ''}@${on?.builtAt ?? s.since}`, on ? `running ${short(on.sha)}` : undefined);
    else viewer.hide();
    const mixed = url && opener.previewing() && location.protocol === 'https:' ? h('p.la-note', {}, 'This page is on HTTPS and the app on plain HTTP, so the browser may not show the preview: use Open live app.') : null;
    const empty = url || up || crashed ? null : h('p.la-empty', {}, s.started ? 'The app is stopped. ▶ Start builds the project’s main branch and runs it here; it follows main as PRs merge.' : "The app isn't started. ▶ Start builds the project's main branch and runs it here; it follows main as PRs merge.");
    walks.update(s.floor, s.readiness?.sha ?? on?.sha, true);
    const card = readinessCard(s, (m) => walks.linkFor(m, s.readiness?.sha, s.readiness?.milestones.find((x) => x.id === m)?.journeys.map((j) => j.id)));
    top.replaceChildren(bar, ...([failed, refresh, note, hint, opener.el, url ? cap.el : null, banner.el, card, walks.el, mixed, log, empty] as (HTMLElement | null)[]).filter((e): e is HTMLElement => !!e));
    if (log) log.scrollTop = log.scrollHeight;
  }

  return {
    route(msg) {
      panel.route(msg, store.floor);
      cap.route(msg, store.floor);
      if (msg.t === 'welcome' || msg.t === 'floor.enter') {
        state = null;
        draw();
        ask();
        banner.refresh();
      } else if (msg.t === 'liveapp.state' && msg.state.floor === store.floor) {
        const moved = msg.state.main?.sha !== state?.main?.sha;
        state = msg.state;
        wantBusiness(state.floor, businessKey(state));
        draw();
        if (moved) banner.refresh();
      }
    },
    render(el) {
      if (root !== el) {
        root = el;
        root.classList.add('la');
        root.replaceChildren(top, viewer.el, panel.el);
        // The tab hidden (another tab picked): the Console stops streaming.
        new MutationObserver(() => panel.setShown(!!state && visible() && !el.classList.contains('hidden'))).observe(el, { attributes: true, attributeFilter: ['class'] });
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
