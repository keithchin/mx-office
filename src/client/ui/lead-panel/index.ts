// The team-lead panel: the agent who leads the project's team, docked on the right of every project tab
// of the 1D view (/lite), about 400 px wide and the full height under the top bar. Mounted once by the
// page (lite.ts) and never touched by a tab change, so its chat, scroll and what you're typing stay as you
// go between tabs; it hears the tabs through tabs/host.ts onProjectTab. What it keeps for you between
// visits (open or collapsed, Chat or Terminal, scroll, drafts) is ./logic.ts PanelState, in this browser.
//
//   open        the panel (./panel.ts): header, Chat | Terminal, the composer
//   collapsed   a slim rail: the avatar with an unread badge, a vertical name label, « to open
//   phone       (≤ 760 px) a floating avatar button opens it as a bottom sheet, chat only; the terminal
//               is "Open terminal", full screen
//   expanded    ⤢ Expand: the terminal in a wide overlay, ✕ top right; Esc closes it and gives focus
//               back to what opened it
//
// Its styles are lead-panel.css; the page makes room for it with body.lp-on (and .lp-collapsed). A view that
// docks it beside its own canvas (./dock.ts, the Developer view) shows it there too, even where the person
// turned the panel off for Project Management's pages: it's the same panel, conversation and state.

import type { Net } from '../../net';
import type { ServerMsg } from '../../../shared/protocol';
import { h, openModal, type Modal } from '../dom';
import { onProjectTab } from '../../tabs/host';
import { onPmcView } from '../pm/chat/pref';
import { LeadPanel } from './panel';
import { panelShown, PANEL_SHOW_KEY, readPanelState, writePanelState } from './logic';
import { setLeadAsk, SHOW_EVENT } from './hooks';
import { onPanelDock, panelDock, setDockFocus } from './dock';
import './lead-panel.css';

export interface LeadPanelDeps {
  net: Net;
  openWorker(id: string): void;
  /** The page's showTab. */
  show(tab: string): void;
  /** The panel has what it shows for `floor` (the floor's loading overlay). */
  onLoaded?(floor: string): void;
}

export interface LeadPanelHandle {
  /** Every server message: the terminal's output, a reconnect. */
  route(msg: ServerMsg): void;
  /** Opens the chat with `text` in the box ("Ask <name>" from Needs you). */
  ask(text: string): void;
}

const PHONE = '(max-width: 760px)';

export function leadPanel(deps: LeadPanelDeps): LeadPanelHandle {
  const store = (() => {
    try {
      return localStorage;
    } catch {
      return undefined;
    }
  })();
  const st = readPanelState(store);
  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  const save = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => writePanelState(store, st), 300);
  };
  const mq = matchMedia(PHONE);
  let sheet = false;
  let overlay: Modal | undefined;
  let setting = panelShown(store);
  let shown = setting || !!panelDock();

  const collapseBtn = h('button.lp-iconbtn.lp-collapse', { type: 'button', 'aria-label': 'Collapse the panel', title: 'Collapse' }, '»');
  const sheetX = h('button.lp-iconbtn.lp-sheet-x', { type: 'button', 'aria-label': 'Close the chat', title: 'Close (Esc)' }, '✕');
  const railAv = h('span.lp-rail-av');
  const railBadge = h('span.lp-badge', { hidden: true });
  const railOpen = h('button.lp-rail-btn', { type: 'button' }, railAv, railBadge);
  const railDot = h('span.lp-rail-dot', { 'aria-hidden': 'true' });
  const railLabel = h('span.lp-vlabel');
  const railOpen2 = h('button.lp-iconbtn.lp-rail-open', { type: 'button', 'aria-label': 'Open the panel', title: 'Open the panel' }, '«');
  const rail = h('div.lp-rail', { hidden: true }, railOpen, railDot, railLabel, railOpen2);
  const fabAv = h('span.lp-fab-av');
  const fabBadge = h('span.lp-badge', { hidden: true });
  const fab = h('button.lp-fab', { type: 'button' }, fabAv, fabBadge);
  const backdrop = h('div.lp-backdrop');
  const aside = h('aside.lp', { id: 'lead-panel', 'aria-labelledby': 'lp-name' });
  let frameKey = '';
  const panel = new LeadPanel(
    {
      net: deps.net,
      openWorker: deps.openWorker,
      toNeeds,
      open: () => shown && (mq.matches ? sheet : !st.collapsed),
      phone: () => mq.matches,
      expand,
      expanded: () => !!overlay,
      changed: () => drawFrame(),
      draft: (floor, text) => {
        if (text !== undefined) ((st.drafts[floor] = text), save());
        return st.drafts[floor] ?? '';
      },
      seen: (id, msg) => {
        if (msg !== undefined) ((st.seen[id] = msg), save());
        return st.seen[id];
      },
      scroll: (floor) => st.scroll[floor],
      onLoaded: deps.onLoaded,
    },
    [collapseBtn, sheetX],
  );
  aside.append(panel.el);
  document.body.append(aside, rail, fab, backdrop);

  // ---- Open, collapsed, the phone's sheet -------------------------------------------------------------
  function setCollapsed(c: boolean, focus = true) {
    st.collapsed = c;
    save();
    apply();
    if (focus) (c ? railOpen : collapseBtn).focus();
  }
  collapseBtn.addEventListener('click', () => setCollapsed(true));
  railOpen.addEventListener('click', () => setCollapsed(false));
  railOpen2.addEventListener('click', () => setCollapsed(false));
  function setSheet(on: boolean, focus = true) {
    sheet = on;
    apply();
    if (!focus) return;
    if (on) setTimeout(() => (panel.canChat ? aside.querySelector<HTMLTextAreaElement>('.lp-box') : sheetX)?.focus(), 60);
    else fab.focus();
  }
  fab.addEventListener('click', () => setSheet(true));
  sheetX.addEventListener('click', () => setSheet(false));
  backdrop.addEventListener('click', () => setSheet(false));
  addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && sheet && !overlay && !document.querySelector('#modal-root .backdrop')) setSheet(false);
  });
  mq.addEventListener('change', () => apply());
  onPmcView(() => apply());
  const reshow = () => ((setting = panelShown(store)), (shown = setting || !!panelDock()), apply());
  addEventListener(SHOW_EVENT, reshow);
  addEventListener('storage', (e) => e.key === PANEL_SHOW_KEY && reshow());
  onPanelDock(() => {
    shown = setting || !!panelDock();
    apply();
  });

  /** Lays the frame out for where it is now, and attaches or lets go of the terminal to match. */
  function apply() {
    const phone = mq.matches;
    const body = document.body.classList;
    body.toggle('lp-on', shown);
    body.toggle('lp-docked', !!panelDock());
    body.toggle('lp-collapsed', shown && !phone && st.collapsed);
    body.toggle('lp-sheet', shown && phone && sheet);
    aside.hidden = !shown;
    rail.hidden = !shown || phone || !st.collapsed;
    fab.hidden = !shown || !phone || sheet;
    aside.inert = shown && (phone ? !sheet : st.collapsed);
    panel.draw();
    panel.countUnread();
  }

  function drawFrame() {
    const l = panel.lead;
    const name = l && l.kind !== 'none' ? `${l.name} · ${l.title}` : 'No one leads the team yet';
    const who = l && l.kind !== 'none' ? l.name : 'the team lead';
    const n = panel.unread;
    const key = JSON.stringify([name, n, l?.kind, panel.avatarKey()]);
    if (key === frameKey) return;
    frameKey = key;
    railAv.replaceChildren(panel.avatar());
    fabAv.replaceChildren(panel.avatar());
    railLabel.textContent = name;
    railDot.className = `lp-rail-dot lp-st-${l?.kind === 'lead' ? 'work' : 'off'}`;
    for (const b of [railBadge, fabBadge]) ((b.hidden = !n), (b.textContent = String(n)));
    railOpen.setAttribute('aria-label', `Open ${who}'s panel${n ? `, ${n} unread` : ''}`);
    fab.setAttribute('aria-label', `Chat with ${who}${n ? `, ${n} unread` : ''}`);
    aside.setAttribute('aria-label', name);
  }

  // ---- Where the panel sends you --------------------------------------------------------------------
  /** "N waiting on you →": the Overview first, then its Needs you scrolled to, highlighted and focused. */
  function toNeeds() {
    if (mq.matches && sheet) setSheet(false, false);
    deps.show('command');
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        const card = [...document.querySelectorAll<HTMLElement>('#pt-needs, #needs-you')].find((el) => el.offsetParent !== null);
        if (!card) return;
        card.scrollIntoView({ block: 'start', behavior: 'smooth' });
        card.classList.remove('lp-ring');
        void card.offsetWidth;
        card.classList.add('lp-ring');
        setTimeout(() => card.classList.remove('lp-ring'), 1600);
        (card.querySelector<HTMLElement>('#pt-needs-h') ?? card).focus({ preventScroll: true });
      }),
    );
  }

  /** ⤢ Expand (Open terminal on a phone): the terminal's box in a wide overlay; Esc or ✕ bring it back. */
  function expand(opener: HTMLElement, host: HTMLElement, title: string) {
    if (overlay) return;
    const frame = h('div.lp-tx-host');
    const content = h('div.modal.lp-tx', { role: 'dialog', 'aria-modal': 'true', 'aria-label': title }, h('header', {}, h('h2', {}, title), h('span.lp-tx-sub', {}, 'Read-only · live')), frame);
    overlay = openModal(content, {
      onClose: () => {
        overlay = undefined;
        panel.returnHost();
        if (opener.isConnected && opener.offsetParent !== null) opener.focus();
        else (mq.matches ? fab : collapseBtn).focus();
      },
    });
    frame.append(host);
    panel.attach();
    setTimeout(() => content.querySelector<HTMLElement>('.close')?.focus(), 0);
  }

  // ---- Keeping your place -----------------------------------------------------------------------------
  // The chat's scroll per project, kept for the next visit (the panel itself is never redrawn between tabs).
  let scrollTimer: ReturnType<typeof setTimeout> | undefined;
  aside.addEventListener(
    'scroll',
    (e) => {
      const list = panel.list;
      if (e.target !== list || !list || !panel.project) return;
      clearTimeout(scrollTimer);
      scrollTimer = setTimeout(() => ((st.scroll[panel.project!] = Math.round(list.scrollTop)), save()), 250);
    },
    { capture: true, passive: true },
  );
  // The top bar's height: the panel starts under it (classic themes' bar is in the page's flow, Portal's fixed).
  const bar = document.querySelector<HTMLElement>('header.lite-bar');
  const top = () => document.documentElement.style.setProperty('--lp-top', `${Math.round(bar?.getBoundingClientRect().bottom ?? 0)}px`);
  if (bar) new ResizeObserver(top).observe(bar);
  top();
  // A tab change doesn't touch the panel; a hidden page lets go of the terminal and the conversation.
  onProjectTab(() => panel.attach());
  panel.sync();
  document.addEventListener('visibilitychange', () => panel.attach());
  apply();

  const ask = (text: string) => {
    if (mq.matches) setSheet(true, false);
    else if (st.collapsed) setCollapsed(false, false);
    if (shown) panel.ask(text);
  };
  setLeadAsk(ask);
  setDockFocus(
    (chip, mode) => {
      if (mq.matches) setSheet(true, false);
      else if (st.collapsed) setCollapsed(false, false);
      panel.focusWith(chip, mode ?? 'change');
    },
    (chip) => panel.selection(chip),
  );
  return { route: (msg) => panel.route(msg), ask };
}
