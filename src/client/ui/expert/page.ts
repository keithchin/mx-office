// The Session screen of an Expert-mode project (?tab=session; design: docs/mockups/expert-mode, screen 4):
// Project Management's left navigation stays (collapsible to icons, as on every page); the page is
//
//   header       Session · branch · Mendix · toolkit · mxcli        App | Both | Chat   ● state   [Lock in]
//   phase strip  only for a phased project (./phases.ts); click: the Roadmap
//   split        live preview (./preview.ts)  ‖  the session (./term.ts): the real `claude` in the folder
//   proof strip  background proof (./proof.ts), "coming soon" until that module answers
//
// The office never types into the session: it's started with no prompt and woken with --resume only. The
// header's state is the session worker's, from its hooks (busy, waiting for you, starting, not running).
// Pop out opens the session alone in a window of its own (?pop=1). Nothing here runs per keystroke beyond
// the terminal's own bytes; the header asks the office again only when the session's state changes.

import { store } from '../../state';
import { pageNet } from '../../shared/page-net';
import { h, toast } from '../dom';
import { openProjectTab } from '../../tabs/host';
import type { TabHooks } from '../../tabs/registry';
import type { ExpertView, SessionState, SplitFocus } from '../../../shared/expert';
import type { WorkerInfo } from '../../../shared/protocol';
import { getExpert, startSession } from './api';
import { sessionTerm } from './term';
import { splitter } from './split';
import { sessionPreview } from './preview';
import { proofStrip } from './proof';
import { phaseBar } from './phases';
import '../terminal.css';
import '../liveapp/viewer.css';
import './expert.css';

/** The header asks the office again at most this often (the session's state can flip several times a second). */
const VIEW_GAP_MS = 1500;

export function sessionState(w: WorkerInfo | undefined): SessionState {
  if (!w || w.status === 'exited' || w.status === 'offline') return 'off';
  if (w.status === 'starting') return 'starting';
  if (w.status === 'working') return 'busy';
  return 'waiting';
}

const STATE_WORDS: Record<SessionState, string> = { busy: 'Working', waiting: 'Idle · waiting for you', starting: 'Starting', off: 'Not running' };

const popped = () => new URLSearchParams(location.search).get('pop') === '1';

export function sessionPage(container: HTMLElement): TabHooks {
  const net = pageNet();
  const chips = h('div.xs-chips');
  const seg = (f: SplitFocus, label: string, title: string) => h('button.xs-seg', { type: 'button', 'data-focus': f, title, onclick: () => split.focus(f) }, label);
  const segs = h('div.xs-segs', { role: 'group', 'aria-label': 'Focus' }, seg('app', 'App', 'The preview only'), seg('both', 'Both', 'The preview and the session side by side'), seg('chat', 'Chat', 'The session only'));
  const statePill = h('span.xs-state', { role: 'status', 'aria-live': 'polite' });
  const lockIn = h('button.btn.primary.xs-lockin', { type: 'button', disabled: true, title: 'Lock in: full checks, merge and publish. Coming soon' }, 'Lock in');
  const head = h('header.xs-head', {}, h('h1.xs-title', {}, 'Session'), chips, h('span.xs-grow'), segs, statePill, lockIn);
  const phases = phaseBar();

  const preview = sessionPreview({ startApp: () => net?.send({ t: 'liveapp.start' }), openLive: () => openProjectTab('live') });
  const previewPane = h('div.xs-pane.xs-preview', {}, preview.el);
  const divider = h('div.xs-div', { role: 'separator', tabindex: '0', 'aria-orientation': 'vertical', 'aria-label': 'Resize the preview and the session', 'aria-valuemin': '0', 'aria-valuemax': '100', title: 'Drag to resize · double-click for half and half · arrow keys (Shift: bigger steps)' }, h('span.xs-grip', { 'aria-hidden': 'true' }));
  const termHost = h('div.xs-term');
  const cover = h('div.xs-cover', { hidden: true });
  const sessState = h('span.xs-sess-state');
  const swapBtn = h('button.xs-icon', { type: 'button', title: 'Swap sides', 'aria-label': 'Swap sides', onclick: () => split.swap() }, '⇄');
  const popBtn = h('button.xs-icon', { type: 'button', title: 'Pop out: the session in a window of its own', 'aria-label': 'Pop out the session', onclick: () => popOut() }, '↗');
  const sessionPane = h(
    'div.xs-pane.xs-session',
    {},
    h('div.xs-sh', {}, h('span.xs-sh-l', {}, 'Session'), h('span.xs-tag', {}, 'Terminal'), h('span.xs-grow'), sessState, swapBtn, popBtn),
    h('div.xs-termbox', {}, termHost, cover),
  );
  const row = h('div.xs-split', {}, previewPane, divider, sessionPane);
  const proof = proofStrip({ worker: () => worker() });
  const root = h('div.xs', {}, head, phases, row, proof.el);
  container.append(root);

  const split = splitter(row, previewPane, divider, sessionPane);
  const term = net ? sessionTerm(net, termHost) : undefined;
  split.onChange((p) => {
    for (const b of segs.children) (b as HTMLElement).setAttribute('aria-pressed', String((b as HTMLElement).dataset.focus === p.focus));
    term?.fit();
  });

  let showing = false;
  let view: ExpertView | undefined;
  let asked = 0;
  let lastAsk = 0;
  let askTimer: ReturnType<typeof setTimeout> | undefined;
  let lastState = '';
  /** Projects whose session this page already tried to start (a failure isn't retried in a loop). */
  const tried = new Set<string>();
  let tick: ReturnType<typeof setInterval> | undefined;

  const worker = () => (view?.workerId ? store.workers.get(view.workerId) : [...store.workers.values()].find((w) => w.session));

  function chip(icon: string, text: string | undefined, title: string) {
    return text ? h('span.xs-chip', { title }, h('span.xs-chip-i', { 'aria-hidden': 'true' }, icon), text) : null;
  }
  function drawHead() {
    const f = store.currentFloor();
    const branch = view?.branch ?? f?.branch;
    chips.replaceChildren(
      ...[
        chip('⎇', branch, 'The branch the project folder is on'),
        chip('Mx', view?.mendix && `Mendix ${view.mendix}`, 'The app’s Mendix version'),
        chip('⌖', view?.toolkit ? `toolkit ${view.toolkit}` : 'toolkit not pinned', 'The mxcli project toolkit pin'),
        chip('⌖', view?.mxcli && `mxcli ${view.mxcli}`, 'The mxcli the office runs'),
      ].filter((x): x is HTMLElement => !!x),
    );
  }
  function drawState() {
    const w = worker();
    const s = sessionState(w);
    statePill.className = `xs-state ${s}`;
    statePill.textContent = w?.status === 'needs_input' ? 'Needs you' : STATE_WORDS[s];
    sessState.textContent = w?.usage ? `$${w.usage.cost.toFixed(2)} this session` : '';
    cover.hidden = s !== 'off' && s !== 'starting';
    if (!cover.hidden) {
      cover.replaceChildren(
        h('div.xs-cover-in', {}, h('p', {}, s === 'starting' ? 'Starting your session…' : w ? 'The session isn’t running.' : 'No session yet.'), s === 'off' ? h('button.btn.primary', { type: 'button', onclick: () => void start(true) }, w ? 'Resume session' : 'Start session') : null, h('p.xs-muted', {}, 'Claude Code runs in the project folder with your own settings, skills and subagents. The office never types into it.')),
      );
    }
    term?.show(w && s !== 'off' ? w.id : undefined);
    proof.session();
  }
  async function start(byHand = false) {
    const floor = store.floor;
    if (!floor || (!byHand && tried.has(floor))) return;
    tried.add(floor);
    const r = await startSession(floor);
    if ('error' in r) toast(r.error, 'warn');
    else ask();
  }
  function popOut() {
    const floor = store.floor;
    if (!floor) return;
    const w = window.open(`/lite?floor=${encodeURIComponent(floor)}&tab=session&pop=1`, `session-${floor}`, 'popup,width=900,height=760');
    if (!w) toast('The browser blocked the window: allow pop-ups for the office', 'warn');
  }
  function ask() {
    clearTimeout(askTimer);
    const wait = Math.max(0, VIEW_GAP_MS - (Date.now() - lastAsk));
    askTimer = setTimeout(() => void load(), wait);
  }
  async function load() {
    const floor = store.floor;
    if (!floor || !showing) return;
    lastAsk = Date.now();
    const n = ++asked;
    const v = await getExpert(floor);
    if (n !== asked || floor !== store.floor) return;
    view = v;
    drawHead();
    preview.loop(v?.loop);
    drawState();
    proof.refresh(floor);
    // The first visit to a project starts its session (or wakes it, carrying on): nothing is typed into it.
    const s = sessionState(worker());
    if (v?.mode === 'expert' && s === 'off') void start();
  }
  function onWorkers() {
    if (!showing) return;
    const w = worker();
    const key = `${w?.id}|${w?.status}`;
    if (key === lastState) return;
    lastState = key;
    drawState();
    ask();
  }

  store.on('workers', onWorkers);
  // The background proof says it changed with the project's roster.changed message (a commit, a push, the budget).
  let proofTimer: ReturnType<typeof setTimeout> | undefined;
  net?.onMessage((msg) => {
    if (!showing || msg.t !== 'roster.changed' || msg.floor !== store.floor) return;
    clearTimeout(proofTimer);
    proofTimer = setTimeout(() => proof.refresh(store.floor), 300);
  });
  store.on('liveApp', () => {
    if (!showing) return;
    preview.draw(store.liveApp);
    ask();
  });
  store.on('floor', () => {
    if (!showing) return;
    view = undefined;
    lastState = '';
    term?.drop();
    split.load(store.floor ?? '');
    void load();
  });
  divider.addEventListener('keydown', () => term?.fit());

  return {
    show() {
      showing = true;
      document.body.classList.add('xs-on');
      document.body.classList.toggle('xs-pop', popped());
      split.load(store.floor ?? '');
      drawHead();
      net?.send({ t: 'liveapp.status' });
      preview.draw(store.liveApp);
      lastState = '';
      onWorkers();
      void load();
      tick = setInterval(() => preview.tick(), 5000);
    },
    hide() {
      showing = false;
      document.body.classList.remove('xs-on', 'xs-pop');
      clearInterval(tick);
      term?.drop();
    },
    refresh() {
      void load();
    },
  };
}
