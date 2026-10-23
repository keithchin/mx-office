// The App Workspace's canvas (proposal section 5.1): the running app is the main thing on screen. While the
// live app serves, it's shown in the Live app tab's viewer (ui/liveapp/viewer.ts: a frame with a small
// browser's toolbar) under a line naming the served revision (the commit actually answering, never the one
// it's updating to) and an Open in a new tab that's always there: some parts of an app only work in a tab
// of their own (a frame on another origin can't reach the top window), and the office can't tell from here
// which. When nothing serves there is no frame at all, never a blank one: the canvas says why (starting,
// stopped, crashed, not started), what ran last, and where to start it. Before the build it shows the brief.

import { h, timeAgo } from '../dom';
import { liveStatus } from '../../../shared/liveapp/status';
import type { WorkspaceStage } from '../../../shared/app-workspace/words';
import { liveViewer, type LiveViewer } from '../liveapp/viewer';
import type { WorkspaceData } from './data';

const short = (sha?: string) => (sha ?? '').slice(0, 7);
const clock = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export interface Canvas {
  readonly el: HTMLElement;
  draw(d: WorkspaceData, stage: WorkspaceStage): void;
  /** The workspace stepped aside: nothing to keep loading. */
  idle(): void;
  /** The page of the app the canvas shows (a path), and whether the app moved on from it by itself. */
  where(): { path: string; moved: boolean } | undefined;
}

export function workspaceCanvas(deps: { open(tab: string): void }): Canvas {
  let viewer: LiveViewer | undefined;
  const line = h('div.aw-runline', { role: 'status', 'aria-live': 'polite' });
  const frameBox = h('div.aw-frame');
  const empty = h('div.aw-canvas-empty');
  const brief = h('div.aw-canvas-brief');
  const el = h('div.aw-canvas', {}, line, frameBox, empty, brief);

  function drawBrief(d: WorkspaceData, show: boolean) {
    brief.hidden = !show;
    if (!show) return;
    const b = d.brief;
    if (b === undefined) return void brief.replaceChildren(h('p.aw-muted', {}, 'Reading the brief…'));
    if (!b) return void brief.replaceChildren(h('h3', {}, 'The brief'), h('p.aw-muted', {}, 'No brief yet. Once the scope is approved, its goal and open questions show here.'));
    brief.replaceChildren(
      h('h3', {}, b.title ? `The brief: ${b.title}` : 'The brief'),
      b.goal.length ? h('p', {}, b.goal.join(' ')) : h('p.aw-muted', {}, 'The brief has no goal written down.'),
      h('button.aw-link', { type: 'button', onclick: () => deps.open('requirements') }, 'See the whole brief'),
    );
  }

  return {
    el,
    draw(d, stage) {
      const s = d.live;
      const served = s?.served;
      if (s && served && d.appUrl) {
        viewer ??= liveViewer();
        if (frameBox.firstChild !== viewer.el) frameBox.replaceChildren(viewer.el);
        frameBox.hidden = false;
        empty.hidden = true;
        viewer.show(d.appUrl, `${served.sha}|${s.since ?? ''}`, `running ${short(served.sha)}`);
        const open = h('a.aw-btn.aw-open', { href: d.appUrl, target: '_blank', rel: 'noopener', title: 'Open the app in a tab of its own, where every part of it works' }, 'Open in a new tab ↗');
        const updating = s.status === 'updating' && s.target ? ` · a newer version (${short(s.target.sha)}) is on its way; this one keeps running until it's ready` : '';
        line.replaceChildren(
          h('span', {}, h('b', {}, 'Running version '), h('code.aw-rev', { title: served.sha }, short(served.sha)), ` · ready since ${clock(served.builtAt)}${updating}`),
          h('span.aw-grow'),
          open,
          h('span.aw-hint', {}, 'If a page doesn’t work here, open it in a new tab: some parts of an app only work in a tab of their own.'),
        );
        drawBrief(d, false);
        return;
      }
      // Nothing serves: no frame at all.
      viewer?.hide();
      frameBox.hidden = true;
      frameBox.replaceChildren();
      empty.hidden = false;
      line.replaceChildren(h('span', {}, h('b', {}, 'No version running')));
      if (!s) {
        empty.replaceChildren(h('p.aw-muted', {}, 'Checking whether the app is running…'));
      } else {
        const word = cap(liveStatus(s).word);
        // Running with no served revision yet: up, not answering (the office calls nothing running until it answers).
        const busy = s.status === 'starting' || s.status === 'updating' || s.status === 'running';
        const last = s.lastServed ? `Last ran version ${short(s.lastServed.sha)} until ${clock(s.lastServed.until)} (${timeAgo(s.lastServed.until)}).` : 'It hasn’t run yet.';
        empty.replaceChildren(
          h('h3', {}, busy ? 'The app is starting' : 'The app isn’t running right now'),
          h('p', {}, h('span.aw-pill', { class: busy ? 'busy' : s.status === 'failed' ? 'bad' : 'idle' }, word), ' ', last),
          busy
            ? h('p.aw-muted', {}, 'It shows here as soon as it answers.')
            : s.available
              ? h('p', {}, h('button.aw-btn', { type: 'button', onclick: () => deps.open('live') }, 'Start the app'), h('span.aw-muted', {}, ' on the Engineering view’s Live app page.'))
              : h('p.aw-muted', {}, 'The office can’t run the app on this computer yet; the Engineering view’s Live app page says why.'),
        );
      }
      drawBrief(d, stage === 'before' || !s?.started);
    },
    where: () => (frameBox.hidden ? undefined : viewer?.where?.()),
    idle() {
      // The frame stays (moving between sections or views mustn't reload the app); nothing else runs.
    },
  };
}
