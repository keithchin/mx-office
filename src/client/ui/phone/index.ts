// 📱 The team phone (docs/site: "Team phone"): the floor's team chatter as a Slack-like chat, a composer
// that messages the agents (server/phone/), and the notification centre, all behind a floating button
// at the bottom right of the 1D and 2D views. Its channels are each floor's chatter (ui/chatter/feed.ts),
// its DMs the floor's agents; its notifications are the Needs-you items (ui/needsyou/logic.ts, the one
// place their rules live), counted red on the button, with ordinary unread messages a grey dot. What
// you've read is kept per person by the office (reads.ts); alerts follow Do not disturb and the digest
// (alerts.ts). No three.js: both flat views load it.

import type { ChatterFilter } from '../../../shared/chatter';
import { badgeOf, dmChannel, dmMessages, floorChannel, unreadIn } from '../../../shared/phone';
import type { ServerMsg } from '../../../shared/protocol';
import type { TeamId } from '../../../shared/roster/roles';
import type { SetupView } from '../../../shared/wizard';
import type { Net } from '../../net';
import type { DesktopNotifier } from '../../notify';
import { store } from '../../state';
import { messages, loadOlder, onFeed, refetch, routeChatter } from '../chatter/feed';
import { chatterActions } from '../chatter/panel';
import { h, modalOpen, toast } from '../dom';
import { collectNeeds, type NeedItem, type NeedsInput, type NeedTarget } from '../needsyou/logic';
import { currentRoster, onRoster, routeRosterMessage } from '../teams/world';
import { wizardApi } from '../wizard/api';
import { phoneAlerts } from './alerts';
import { pendingOn, sendMessage, setPhoneOpener, type PendingReply, type PhoneOpen } from './api';
import { openChatWindow } from './chatwin';
import { composer, type ComposeTarget } from './composer';
import { phoneFrame, wasOpen } from './frame';
import { notesOf, redCount, type NoteAction, type PhoneNote } from './notes';
import { readState } from './reads';
import type { RowActions } from './rows';
import { allLog, channelLog, dmLog, filterChips, homeList, needsLog, threadLog, type PhoneAgentView, type PhoneModel, type Screen } from './screens';
import { dndLabel, settingsSheet } from './settings';
import './phone.css';
import './iphone.css';

export interface PhoneDeps {
  net: Net;
  notifier: DesktopNotifier;
  openWorker(id: string): void;
  openPull(n: number): void;
  /** Where a Needs-you item's button goes (the same as the Command Center's). */
  go(t: NeedTarget): void;
  /** What the page knows that Needs you reads (the 1D view's setup panel, live app, Firm, Studio); the 2D view leaves it out. */
  needs?(): Partial<Pick<NeedsInput, 'setup' | 'live' | 'firm' | 'studio'>>;
}

export interface Phone {
  /** Every server message: new chatter, a changed team. */
  route(msg: ServerMsg): void;
  /** Draws again from what the page knows now. */
  refresh(): void;
  open(o?: PhoneOpen): void;
}

const CHAN_KEY = 'agent-office.phone.screen';

export function installPhone(deps: PhoneDeps): Phone {
  const frame = phoneFrame((open) => {
    if (open) {
      void loadPending();
      draw();
    }
  });
  document.body.append(frame.win, frame.launcher);
  frame.win.querySelector('.tp-wide')?.addEventListener('click', () => draw());
  document.body.classList.add('has-phone');
  const reads = readState();
  const alerts = phoneAlerts(deps.notifier, () => open({ needs: true }));
  let screen: Screen = savedScreen();
  let filter: ChatterFilter = { with: 'all' };
  let team: TeamId | undefined;
  let pending: PendingReply[] = [];
  let items: NeedItem[] = [];
  let ownSetup: { floor: string; at: number; view?: SetupView } | undefined;
  let sheet: HTMLElement | undefined;
  const listened = new Set<string>();

  const list = h('div.tp-pane.tp-pane-list');
  const log = h('ol.tp-log', { 'aria-live': 'polite', 'aria-relevant': 'additions', tabindex: '0', 'aria-label': 'Messages' });
  const older = h('button.btn.small.tp-older', { type: 'button', hidden: true, onclick: () => void more() }, 'Load older');
  const scroller = h('div.tp-scroll', {}, older, log);
  const chips = h('div.tp-chipbar');
  const compose = composer((r, t) => {
    const held = r.to.filter((x) => x.status === 'held').map((x) => x.name);
    if (r.note) toast(r.note);
    if (held.length) toast(`Held for ${held.join(', ')}: it's typed once ${held.length === 1 ? 'its' : 'their'} turn is over`);
    void t;
    void loadPending();
  });
  const main = h('div.tp-pane.tp-pane-main', {}, chips, scroller, compose.el);
  frame.body.append(list, main);

  // ---- What the phone knows ----------------------------------------------------------------------------
  const roster = () => currentRoster();
  const admin = () => !!roster()?.admin;

  function agents(): PhoneAgentView[] {
    const members = roster()?.members ?? [];
    return [...store.workers.values()]
      .filter((w) => w.kind === 'agent' && !w.lost)
      .map((w) => {
        const role = members.find((m) => m.workerId === w.id)?.role;
        return { workerId: w.id, name: w.name, status: w.status, color: w.color, ...(role ? { role } : {}) };
      })
      .sort((a, b) => (a.role === 'pm' ? -1 : b.role === 'pm' ? 1 : (a.role ? 0 : 1) - (b.role ? 0 : 1) || a.name.localeCompare(b.name)));
  }

  function setupNow(): SetupView | undefined {
    const f = store.floor;
    if (!f) return undefined;
    if (!ownSetup || ownSetup.floor !== f || Date.now() - ownSetup.at > 60_000) {
      const mine = (ownSetup = { floor: f, at: Date.now(), view: ownSetup?.floor === f ? ownSetup.view : undefined });
      wizardApi.setup(f).then(
        (v) => {
          mine.view = v;
          draw();
        },
        () => undefined,
      );
    }
    return ownSetup.view;
  }

  function collect() {
    const extra = deps.needs?.() ?? { setup: setupNow() };
    const studio = store.studio?.floor === store.floor ? (store.studio ?? undefined) : undefined;
    items = collectNeeds({ floor: store.floor ?? undefined, workers: store.workers.values(), roster: roster(), pulls: store.pulls.items, floors: store.floors, studio, ...extra });
    alerts.saw(store.floor ?? undefined, items);
  }

  /** Messages in a floor's channel you haven't read (a DM's are counted in the DM). */
  const unreadFloor = (floor: string) => {
    const got = messages(floor);
    return unreadIn(got.list.filter((m) => !m.ref?.thread?.startsWith('dm-')), reads.get(floorChannel(floor)));
  };
  const unreadDm = (workerId: string) => (store.floor ? unreadIn(dmMessages(messages(store.floor).list, workerId), reads.get(dmChannel(store.floor, workerId))) : 0);

  function model(): PhoneModel {
    const r = roster();
    return {
      floor: store.floor ?? undefined,
      floors: store.floors,
      agents: agents(),
      notes: notesOf(items, admin()),
      red: redCount(items, store.floors, store.floor ?? undefined),
      pending,
      escalations: new Map((r?.floor === store.floor ? r.escalations : []).map((e) => [e.id, e])),
      feed: (f) => {
        listen(f);
        return messages(f);
      },
      unreadFloor,
      unreadDm,
      filter,
      ...(team ? { team } : {}),
    };
  }

  /** Each floor's feed redraws the phone as its messages come. */
  function listen(floor: string) {
    if (listened.has(floor)) return;
    listened.add(floor);
    onFeed(floor, () => draw());
  }

  async function loadPending() {
    const f = store.floor;
    if (!f) return;
    try {
      pending = await pendingOn(f);
      draw();
    } catch {
      // the office is unreachable: nothing pending shown
    }
  }

  // ---- Drawing -------------------------------------------------------------------------------------------
  const rowActions: RowActions = {
    ...chatterActions({ openWorker: deps.openWorker, openEscalation: (id) => go({ s: 'thread', floor: store.floor ?? '', key: `esc:${id}`, back: screen }), openPull: deps.openPull }),
    openThread: (key) => go({ s: 'thread', floor: floorOf(screen) ?? store.floor ?? '', key, back: screen }),
    openChat: (id) => openChatWindow(deps.net, id, deps.openWorker, roster()?.members.some((m) => m.role === 'pm' && m.workerId === id) ?? false),
    act: (n, a) => void act(n, a),
    floorName: (id) => store.floors.find((f) => f.id === id)?.name ?? id,
  };

  const floorOf = (s: Screen): string | undefined => (s.s === 'floor' || s.s === 'thread' ? s.floor : s.s === 'dm' ? (store.floor ?? undefined) : undefined);

  /** In the narrow window the list is a screen of its own; wide, it's beside what's open (your floor's channel at first). */
  function shown(): Screen {
    if (screen.s !== 'home') return screen;
    return store.floor ? { s: 'floor', floor: store.floor } : { s: 'needs' };
  }

  let frameReq = 0;
  /** A screen was just opened: show its newest messages. */
  let toBottom = true;
  /** Draws on the next frame: a burst of worker updates draws once. */
  function draw() {
    if (!frameReq) frameReq = requestAnimationFrame(() => ((frameReq = 0), paint()));
  }

  function paint() {
    collect();
    const m = model();
    const b = badgeOf(m.red, store.floors.reduce((n, f) => n + unreadFloor(f.id), 0) + m.agents.reduce((n, a) => n + unreadDm(a.workerId), 0));
    frame.setBadge(b, b.kind === 'count' ? `${b.n} thing${b.n === 1 ? '' : 's'} need${b.n === 1 ? 's' : ''} you` : b.kind === 'dot' ? 'unread messages' : '');
    if (!frame.isOpen()) return;
    const s = shown();
    frame.body.classList.toggle('tp-at-home', screen.s === 'home');
    swap(list, [homeList(m, s, go)]);
    const quiet = dndLabel(alerts.settings());
    const busy = m.agents.filter((a) => a.status === 'working' || a.status === 'starting').length;
    frame.sub.textContent = quiet || (s.s === 'floor' && s.floor === store.floor ? `${m.agents.length} agent${m.agents.length === 1 ? '' : 's'}${busy ? ` · ${busy} working` : ''}` : s.s === 'floor' ? 'Another floor' : (store.floors.find((f) => f.id === store.floor)?.name ?? ''));
    frame.back.hidden = screen.s === 'home';
    const stick = scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 24;
    const before = scroller.scrollHeight - scroller.scrollTop;
    let rows: HTMLElement[] = [];
    let target: ComposeTarget | undefined;
    let why: string | undefined;
    const chipEls: HTMLElement[] = [];
    older.hidden = true;
    const ag = m.agents;
    if (s.s === 'needs') {
      frame.title.textContent = 'Needs you';
      rows = needsLog(m, rowActions);
    } else if (s.s === 'all') {
      frame.title.textContent = 'All projects';
      chipEls.push(filterChips(m, store.floor ?? '', setFilter));
      rows = allLog(m, rowActions);
      why = 'Open a project channel to write';
    } else if (s.s === 'floor') {
      frame.title.textContent = `# ${rowActions.floorName(s.floor)}`;
      chipEls.push(filterChips(m, s.floor, setFilter));
      rows = channelLog(m, s.floor, rowActions);
      older.hidden = !messages(s.floor).more;
      target = { floor: s.floor, place: { in: 'channel' }, agents: s.floor === store.floor ? ag : [] };
      if (frame.isOpen() && !document.hidden) mark(floorChannel(s.floor), messages(s.floor).list.filter((x) => !x.ref?.thread?.startsWith('dm-'))[0]?.at);
    } else if (s.s === 'dm') {
      const a = ag.find((x) => x.workerId === s.workerId);
      frame.title.textContent = a ? a.name : 'Direct message';
      rows = dmLog(m, s.workerId, rowActions);
      target = a && store.floor ? { floor: store.floor, place: { in: 'dm', workerId: a.workerId }, agents: ag } : undefined;
      why = a ? undefined : 'That agent has left the floor';
      if (store.floor) mark(dmChannel(store.floor, s.workerId), dmMessages(messages(store.floor).list, s.workerId).slice(-1)[0]?.at);
    } else if (s.s === 'thread') {
      const esc = s.key.startsWith('esc:') ? s.key.slice(4) : undefined;
      frame.title.textContent = esc ? 'Escalation' : 'Thread';
      rows = threadLog(m, s.floor, s.key, rowActions, (id, verdict) => void answer(s.floor, id, verdict));
      const open = esc ? m.escalations.get(esc)?.status === 'open' : true;
      target = open ? { floor: s.floor, place: { in: 'thread', thread: s.key, agents: [] }, agents: s.floor === store.floor ? ag : [], ...(esc ? { escalation: esc } : {}) } : undefined;
      why = open ? undefined : 'This escalation has been answered';
    }
    // The narrow phone's own first screen is the channel list.
    if (screen.s === 'home' && !frame.win.classList.contains('tp-is-wide')) frame.title.textContent = 'Team phone';
    swap(chips, chipEls);
    const changed = swap(log, rows);
    compose.target(target, why);
    main.classList.toggle('tp-no-compose', !target && !why);
    // Newest at the bottom, as a chat: stay there when you were, else keep what you were reading in place.
    if (changed || toBottom) scroller.scrollTop = stick || toBottom ? scroller.scrollHeight : scroller.scrollHeight - before;
    toBottom = false;
  }

  function mark(channel: string, at: number | undefined) {
    if (at !== undefined) reads.mark(channel, at);
  }

  function go(s: Screen) {
    screen = s;
    if (s.s !== 'thread') {
      try {
        localStorage.setItem(CHAN_KEY, JSON.stringify(s));
      } catch {
        // just this visit
      }
    }
    sheet?.remove();
    sheet = undefined;
    toBottom = true;
    draw();
  }

  function setFilter(f: ChatterFilter, t?: TeamId) {
    filter = f;
    team = t;
    draw();
  }

  async function more() {
    const f = floorOf(shown());
    if (!f) return;
    older.disabled = true;
    await loadOlder(f);
    older.disabled = false;
    draw();
  }

  async function answer(floor: string, id: string, verdict: 'approve' | 'reject') {
    let text = '';
    if (verdict === 'reject') {
      text = window.prompt('Why is it rejected? (the agent is told)')?.trim() ?? '';
      if (!text) return;
    }
    try {
      await sendMessage(floor, text, { in: 'thread', thread: `esc:${id}`, agents: [] }, verdict);
      toast(verdict === 'approve' ? 'Approved: the agent is told' : 'Rejected: the agent is told');
      void loadPending();
    } catch (err) {
      toast(`Couldn't answer it: ${(err as Error).message}`, 'warn');
    }
  }

  async function act(n: PhoneNote, a: NoteAction) {
    if (a.do === 'go') return deps.go(a.target);
    const floor = store.floor ?? '';
    if (a.do === 'reply') {
      go({ s: 'thread', floor, key: `esc:${a.escalation}`, back: screen });
      return setTimeout(() => compose.focus(), 30);
    }
    void n;
    await answer(floor, a.escalation, a.do);
  }

  function open(o: PhoneOpen = {}) {
    if (o.filter || o.team) {
      filter = o.filter ?? { with: 'all' };
      team = o.team;
    }
    screen = o.needs ? { s: 'needs' } : o.floor ? { s: 'floor', floor: o.floor } : screen;
    frame.setOpen(true);
    draw();
  }
  setPhoneOpener(open);

  frame.back.addEventListener('click', () => go(screen.s === 'thread' ? screen.back : { s: 'home' }));
  frame.gear.addEventListener('click', () => {
    if (sheet) return closeSheet();
    sheet = settingsSheet(frame.body, alerts.settings, (s) => (alerts.set(s), draw()), closeSheet);
    frame.body.append(sheet);
    sheet.querySelector<HTMLElement>('input, select, button')?.focus();
  });
  function closeSheet() {
    sheet?.remove();
    sheet = undefined;
    frame.gear.focus();
  }
  // Esc: the settings sheet first, then the phone; never while a window opened over it is up.
  frame.win.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !modalOpen()) {
      e.preventDefault();
      if (sheet) return closeSheet();
      frame.setOpen(false);
      frame.launcher.focus();
    }
    if (e.key === 'ArrowLeft' && e.altKey && screen.s !== 'home') frame.back.click();
  });
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !frame.isOpen() || modalOpen() || frame.win.contains(document.activeElement)) return;
    const typing = document.activeElement?.matches('input, textarea, select, [contenteditable]');
    if (!typing) frame.setOpen(false);
  });

  // ---- Keeping up ----------------------------------------------------------------------------------------
  for (const k of ['workers', 'pulls', 'floors', 'studio'] as const) store.on(k, draw);
  let lastFloor = store.floor;
  store.on('floor', () => {
    pending = [];
    // Another floor's DMs and threads aren't this one's (the first floor of the visit keeps where you were).
    if (lastFloor && lastFloor !== store.floor && (screen.s === 'dm' || screen.s === 'thread')) screen = { s: 'home' };
    lastFloor = store.floor;
    void loadPending();
    draw();
  });
  onRoster(draw);
  reads.onChange(draw);
  document.addEventListener('visibilitychange', () => !document.hidden && draw());
  // Other floors' channels don't get their messages live: look again now and then.
  setInterval(() => {
    for (const f of store.floors) if (f.id !== store.floor && !f.cloning && listened.has(f.id)) void refetch(f.id);
    if (frame.isOpen()) void loadPending();
  }, 45_000);
  setInterval(() => frame.isOpen() && draw(), 30_000);
  if (wasOpen()) frame.setOpen(true);
  // Every floor's channel counts its unread from the start.
  store.on('floors', () => store.floors.forEach((f) => !f.cloning && listen(f.id)));

  return {
    route(msg) {
      routeChatter(msg);
      routeRosterMessage(msg);
      if (msg.t === 'chatter.new' && msg.message.from.kind !== 'human') pending = pending.filter((p) => !(p.thread === msg.message.ref?.thread && msg.message.from.workerId === p.workerId) && !(msg.message.ref?.worker === p.workerId));
      if (msg.t === 'welcome' || msg.t === 'floor.enter' || msg.t === 'liveapp.state' || msg.t === 'roster.changed') draw();
    },
    refresh: draw,
    open,
  };
}

const drawn = new WeakMap<HTMLElement, string>();

/** Puts `children` in `el` only when they differ from what's there, keeping the focus where it was. True when it did. */
function swap(el: HTMLElement, children: HTMLElement[]): boolean {
  const sig = children.map((c) => c.outerHTML).join('');
  if (drawn.get(el) === sig) return false;
  drawn.set(el, sig);
  // Where the focus is, as a path of child indexes, to put it back on the same spot of the new rows.
  const path: number[] = [];
  let at = document.activeElement;
  while (at && at !== el && el.contains(at) && at.parentElement) {
    path.unshift([...at.parentElement.children].indexOf(at));
    at = at.parentElement;
  }
  el.replaceChildren(...children);
  if (at === el && path.length) {
    let to: Element | undefined = el;
    for (const i of path) to = to?.children[i];
    if (to instanceof HTMLElement) to.focus({ preventScroll: true });
  }
  return true;
}

function savedScreen(): Screen {
  try {
    const s = JSON.parse(localStorage.getItem(CHAN_KEY) ?? 'null') as Screen | null;
    if (s && (s.s === 'home' || s.s === 'needs' || s.s === 'all' || (s.s === 'floor' && typeof s.floor === 'string') || (s.s === 'dm' && typeof s.workerId === 'string'))) return s;
  } catch {
    // first time
  }
  return { s: 'home' };
}
