// 📱 The phone version (/m): the team phone full screen, as an app. Tabs along the bottom: Needs you (what
// needs you, with its buttons), Projects (each floor's channel), DMs (the floor's agents), Activity (every
// floor's chatter) and Status (each project at a glance). Built from the team phone's own pieces
// (ui/phone/: its screens, rows, composer, notifications and read state) and the same Needs-you rules
// (ui/needsyou/logic.ts). Risky actions are confirmed with a fresh sign-in (confirm.ts); an agent's
// terminal is read-only here (chat.ts).

import { MOBILE_TABS, type MobileTab, type ProjectStatus, type RestartLine } from '../../shared/mobile';
import { dmChannel, dmMessages, floorChannel, unreadIn } from '../../shared/phone';
import type { ServerMsg } from '../../shared/protocol';
import type { Net } from '../net';
import type { DesktopNotifier } from '../notify';
import { store } from '../state';
import { floorPicker } from '../shared/floors';
import { messages, loadOlder, onFeed, refetch, routeChatter } from '../ui/chatter/feed';
import { chatterActions } from '../ui/chatter/panel';
import { $, h, modalOpen, toast } from '../ui/dom';
import { collectNeeds, type NeedItem } from '../ui/needsyou/logic';
import { phoneAlerts } from '../ui/phone/alerts';
import { pendingOn, type PendingReply } from '../ui/phone/api';
import { nudgeMember } from '../ui/roster/api';
import { composer, type ComposeTarget } from '../ui/phone/composer';
import { notesOf, redCount, type NoteAction, type PhoneNote } from '../ui/phone/notes';
import { readState } from '../ui/phone/reads';
import type { RowActions } from '../ui/phone/rows';
import { allLog, channelLog, dmLog, needsLog, STREAM_CAP, threadLog, type PhoneAgentView, type PhoneModel } from '../ui/phone/screens';
import { currentRoster, onRoster, routeRosterMessage } from '../ui/teams/world';
import { mobileApi, type MeView } from './api';
import { openReadOnlyChat } from './chat';
import { setFreshUntil } from './confirm';
import { agentList, floorList, swap } from './lists';
import { answerEscalation, approvalRows, hireSheet, onComputer, prSheet, raiseCap } from './needs';
import { isIos, isStandalone, registerWorker } from './push';
import { installSteps, openSettings } from './settings';
import { running, statusList } from './status';
import { pauseProject, resumeProject } from './resume';
import '../ui/phone/phone.css';
import './mobile.css';
import { batched } from '../ui/batch';

export interface MobileDeps {
  net: Net;
  notifier: DesktopNotifier;
}

export interface MobileApp {
  route(msg: ServerMsg): void;
  openChat(workerId: string): void;
}

/** What's open on top of a tab's list: a project's channel, a DM, a thread. */
type Sub = { s: 'floor'; floor: string } | { s: 'dm'; workerId: string } | { s: 'thread'; floor: string; key: string; back?: Sub };

const HINT_KEY = 'agent-office.m.install-hint';

export function installMobile(deps: MobileDeps): MobileApp {
  const { net } = deps;
  const reads = readState();
  const alerts = phoneAlerts(deps.notifier, () => go('needs'));
  // Always opens on Needs you: what a phone is for.
  let tab: MobileTab = 'needs';
  let sub: Sub | undefined;
  let items: NeedItem[] = [];
  let pending: PendingReply[] = [];
  let me: MeView | undefined;
  let statuses: ProjectStatus[] | undefined;
  let statusError: string | undefined;
  let restart: RestartLine | undefined;
  let statusTimer: ReturnType<typeof setTimeout> | undefined;
  let flash: string | undefined;

  const back = h('button.m-hbtn', { type: 'button', 'aria-label': 'Back', hidden: true, onclick: () => goBack() }, '‹');
  const title = h('h1.m-title', {}, 'Agent Office');
  const subline = h('p.m-sub');
  const gear = h('button.m-hbtn', { type: 'button', 'aria-label': 'Phone settings', onclick: () => openSettings(me, draw) }, '⚙');
  const floorSel = h('select.m-floor', { id: 'floor', 'aria-label': 'Project' });
  const bar = h('header.m-bar', {}, back, h('div.m-titles', {}, title, subline), floorSel, h('span.m-hidden', { id: 'floor-meta' }), gear);
  const banner = h('div.m-banner-box');
  const log = h('ol.tp-log.m-log', { 'aria-live': 'polite', 'aria-relevant': 'additions' });
  const cards = h('div.m-cards');
  const older = h('button.btn.small.m-older', { type: 'button', hidden: true, onclick: () => void more() }, 'Load older');
  const main = h('main.m-main', {}, banner, older, log, cards);
  const compose = composer(() => void loadPending());
  const composeBox = h('div.m-compose', {}, compose.el);
  const tabs = h('nav.m-tabs', { 'aria-label': 'Sections' });
  $('m-app').replaceChildren(bar, main, composeBox, tabs);
  floorPicker(net);

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
      .sort((a, b) => (a.role === 'pm' ? -1 : b.role === 'pm' ? 1 : a.name.localeCompare(b.name)));
  }

  const unreadFloor = (f: string) => unreadIn(messages(f).list.filter((m) => !m.ref?.thread?.startsWith('dm-')), reads.get(floorChannel(f)));
  const unreadDm = (id: string) => (store.floor ? unreadIn(dmMessages(messages(store.floor).list, id), reads.get(dmChannel(store.floor, id))) : 0);
  const listened = new Set<string>();
  const listen = (f: string) => void (listened.has(f) || (listened.add(f), onFeed(f, () => drawLater())));

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
      feed: (f) => (listen(f), messages(f)),
      unreadFloor,
      unreadDm,
      filter: { with: 'all' },
      limit,
    };
  }

  const rowActions: RowActions = {
    ...chatterActions({ openWorker: (id) => openChat(id), openEscalation: (id) => open({ s: 'thread', floor: store.floor ?? '', key: `esc:${id}`, back: sub }), openPull: (n) => prSheet(store.floor ?? '', n) }),
    openThread: (key) => open({ s: 'thread', floor: sub && 'floor' in sub ? sub.floor : (store.floor ?? ''), key, back: sub }),
    openChat: (id) => openChat(id),
    act: (n, a) => void noteAct(n, a),
    floorName: (id) => store.floors.find((f) => f.id === id)?.name ?? id,
  };

  async function noteAct(_n: PhoneNote, a: NoteAction) {
    const floor = store.floor ?? '';
    if (a.do === 'reply') {
      open({ s: 'thread', floor, key: `esc:${a.escalation}`, back: sub });
      return void setTimeout(() => compose.focus(), 30);
    }
    if (a.do !== 'go') return void (await answerEscalation(floor, a.escalation, a.do, roster()));
    const t = a.target;
    if (t.to === 'worker') return openChat(t.id);
    if (t.to === 'escalation') return open({ s: 'thread', floor, key: `esc:${t.id}`, back: sub });
    if (t.to === 'pr') return prSheet(floor, t.number);
    if (t.to === 'floor') return net.send({ t: 'floor.go', floor: t.floor });
    if (t.to === 'firm') return location.assign(t.url);
    if (t.to === 'settings') return void raiseCap({ floor, name: store.currentFloor()?.name ?? floor, spend: statuses?.find((s) => s.floor === floor)?.spend ?? { usd: roster()?.spentToday ?? 0, ...(roster()?.cap ? { cap: roster()!.cap } : {}) } });
    if (t.to === 'approvals') return main.querySelector('.m-appr')?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    if (t.to === 'nudge') return void nudgeMember(floor, t.role);
    onComputer(t, floor);
  }

  function openChat(id: string) {
    openReadOnlyChat(net, id, (w) => (go('dms'), open({ s: 'dm', workerId: w })));
  }

  // ---- Drawing ---------------------------------------------------------------------------------------------
  let toBottom = false;
  /** How many of the newest messages the logs draw (Load older adds STREAM_CAP more). */
  let limit = STREAM_CAP;
  /** Draws on the next frame (and at most every 150 ms): you did something. */
  const draw = batched(() => paint(), 150);
  /** What the office sends (every worker update, every message): at most twice a second, as the team phone (ui/batch.ts). */
  const drawLater = batched(() => paint(), 500);

  function paint() {
    items = collectNeeds({ floor: store.floor ?? undefined, workers: store.workers.values(), roster: roster(), pulls: store.pulls.items, floors: store.floors, studio: store.studio?.floor === store.floor ? (store.studio ?? undefined) : undefined });
    alerts.saw(store.floor ?? undefined, items);
    const m = model();
    const floorName = store.currentFloor()?.name ?? '';
    tabs.replaceChildren(
      ...MOBILE_TABS.map((t) => {
        const n = t.id === 'needs' ? m.red : t.id === 'dms' ? m.agents.reduce((s, a) => s + unreadDm(a.workerId), 0) : t.id === 'projects' ? store.floors.reduce((s, f) => s + unreadFloor(f.id), 0) : 0;
        return h('button.m-tab', { type: 'button', 'aria-current': t.id === tab ? 'page' : undefined, 'data-tab': t.id, onclick: () => go(t.id) }, h('span.m-tab-ico', { 'aria-hidden': 'true' }, t.icon), h('span.m-tab-label', {}, t.label), n ? h('span.m-tab-badge', { class: t.id === 'needs' ? 'm-red' : 'm-grey' }, t.id === 'needs' ? String(n) : '') : null);
      }),
    );
    back.hidden = !sub;
    let rows: HTMLElement[] = [];
    let cardEls: HTMLElement[] = [];
    let target: ComposeTarget | undefined;
    older.hidden = true;
    if (sub?.s === 'floor') {
      title.textContent = `# ${rowActions.floorName(sub.floor)}`;
      subline.textContent = sub.floor === store.floor ? `${m.agents.length} agents` : 'Another project';
      rows = channelLog(m, sub.floor, rowActions);
      older.hidden = !messages(sub.floor).more && messages(sub.floor).list.length <= limit;
      target = { floor: sub.floor, place: { in: 'channel' }, agents: sub.floor === store.floor ? m.agents : [] };
      reads.mark(floorChannel(sub.floor), messages(sub.floor).list[0]?.at ?? 0);
    } else if (sub?.s === 'dm') {
      const id = sub.workerId;
      const a = m.agents.find((x) => x.workerId === id);
      title.textContent = a?.name ?? 'Direct message';
      subline.textContent = a ? (a.status === 'working' ? 'working…' : a.status === 'needs_input' ? 'asking you' : a.status) : 'left the floor';
      rows = dmLog(m, id, rowActions);
      rows.unshift(h('li.m-chatlink', {}, h('button.btn.small', { type: 'button', onclick: () => openChat(id) }, '🖥️ Terminal (read-only)')));
      target = a && store.floor ? { floor: store.floor, place: { in: 'dm', workerId: id }, agents: m.agents } : undefined;
      if (store.floor) reads.mark(dmChannel(store.floor, id), dmMessages(messages(store.floor).list, id).slice(-1)[0]?.at ?? 0);
    } else if (sub?.s === 'thread') {
      const esc = sub.key.startsWith('esc:') ? sub.key.slice(4) : undefined;
      title.textContent = esc ? 'Escalation' : 'Thread';
      subline.textContent = rowActions.floorName(sub.floor);
      const floor = sub.floor;
      rows = threadLog(m, floor, sub.key, rowActions, (id, verdict) => void answerEscalation(floor, id, verdict, roster()));
      const isOpen = esc ? m.escalations.get(esc)?.status === 'open' : true;
      target = isOpen ? { floor, place: { in: 'thread', thread: sub.key, agents: [] }, agents: floor === store.floor ? m.agents : [], ...(esc ? { escalation: esc } : {}) } : undefined;
    } else {
      const t = MOBILE_TABS.find((x) => x.id === tab)!;
      title.textContent = t.label;
      subline.textContent = floorName;
      if (tab === 'needs') {
        const appr = approvalRows(store.floor ?? '', roster(), statuses?.find((s) => s.floor === store.floor));
        // A merge waiting on you has its own row above (with Merge…): not its notification again.
        rows = [...appr, ...needsLog(m, rowActions).filter((r) => !(appr.length && r.dataset.key?.startsWith('appr-m-')))];
        if (rows.length > 1) rows = rows.filter((r) => !r.classList.contains('tp-calm'));
      } else if (tab === 'projects') cardEls = [floorList(m, (f) => open({ s: 'floor', floor: f }))];
      else if (tab === 'dms') cardEls = [agentList(m, (id) => open({ s: 'dm', workerId: id }), openChat)];
      else if (tab === 'activity') {
        store.floors.forEach((f) => !f.cloning && listen(f.id));
        rows = allLog(m, rowActions);
      } else if (tab === 'status') {
        cardEls = statusList(statuses, store.floor ?? undefined, roster(), {
          go: (f) => net.send({ t: 'floor.go', floor: f }),
          raiseCap: (p) => void raiseCap(p).then(loadStatus),
          hire: () => {
            const r = roster();
            if (r) hireSheet(store.floor ?? '', r);
          },
          pause: (p) => void pauseProject(p).then((ok) => void (ok && loadStatus())),
          resume: (p) => void resumeProject(p).then((ok) => void (ok && loadStatus())),
        }, statusError, restart);
      }
    }
    swap(banner, banners());
    const stick = main.scrollTop + main.clientHeight >= main.scrollHeight - 24;
    const changed = swap(log, rows);
    swap(cards, cardEls);
    log.hidden = !rows.length;
    compose.target(target);
    composeBox.hidden = !target;
    document.body.classList.toggle('m-has-compose', !!target);
    if (sub && (changed || toBottom) && (stick || toBottom)) main.scrollTop = main.scrollHeight;
    toBottom = false;
    if (flash) {
      const el = log.querySelector<HTMLElement>(`[data-key="${CSS.escape(flash)}"]`);
      if (el) {
        el.classList.add('m-flash');
        el.scrollIntoView({ block: 'center' });
        flash = undefined;
      }
    }
  }

  /** What's worth saying above the list: install it (iPhone Safari), push needs https. */
  function banners(): HTMLElement[] {
    const out: HTMLElement[] = [];
    let dismissed = false;
    try {
      dismissed = localStorage.getItem(HINT_KEY) === '1';
    } catch {
      // ask again next time
    }
    if (tab === 'needs' && !sub && isIos() && !isStandalone() && !dismissed) {
      const x = h('button.m-hbtn.m-x', { type: 'button', 'aria-label': 'Hide', onclick: () => (localStorage.setItem(HINT_KEY, '1'), draw()) }, '✕');
      out.push(h('section.m-banner', {}, x, h('b', {}, '📲 Put Agent Office on your home screen'), h('p.m-dim', {}, 'It opens full screen like an app, and can then tell you when something needs you.'), installSteps()));
    }
    return out;
  }

  function open(s: Sub) {
    sub = s;
    toBottom = true;
    draw();
  }
  function goBack() {
    sub = sub?.s === 'thread' ? sub.back : undefined;
    draw();
  }
  function go(t: MobileTab) {
    tab = t;
    sub = undefined;
    main.scrollTop = 0;
    if (t === 'status') void loadStatus();
    draw();
  }

  async function loadStatus() {
    try {
      const v = await mobileApi.status();
      statuses = v.projects;
      restart = v.restart;
      statusError = undefined;
      // While a resume, a pause or a restart is going, its progress is looked at every few seconds.
      clearTimeout(statusTimer);
      if (tab === 'status' && (restart || statuses.some(running))) statusTimer = setTimeout(() => !document.hidden && tab === 'status' && void loadStatus(), 3000);
    } catch (err) {
      statusError = (err as Error).message;
    }
    draw();
  }
  async function loadPending() {
    if (!store.floor) return;
    pending = await pendingOn(store.floor).catch(() => pending);
    draw();
  }
  async function more() {
    if (sub?.s !== 'floor') return;
    limit += STREAM_CAP;
    await loadOlder(sub.floor);
    draw();
  }
  async function loadMe() {
    try {
      me = await mobileApi.me();
      setFreshUntil(me.reauthUntil);
    } catch {
      // the welcome says the rest
    }
  }

  /** /m?floor=…&item=…: a push notification tapped (or a link): that floor's Needs you, that item lit up. */
  function deepLink(href: string) {
    const q = new URL(href, location.origin).searchParams;
    const floor = q.get('floor');
    const item = q.get('item');
    if (!floor && !item) return;
    tab = 'needs';
    sub = undefined;
    flash = item ?? undefined;
    if (floor && floor !== store.floor && store.floors.some((f) => f.id === floor)) net.send({ t: 'floor.go', floor });
    draw();
  }
  let linked = false;
  navigator.serviceWorker?.addEventListener('message', (e) => e.data?.t === 'open' && deepLink(String(e.data.url)));

  // ---- Keeping up ------------------------------------------------------------------------------------------
  for (const k of ['workers', 'pulls', 'floors', 'studio'] as const) store.on(k, drawLater);
  store.on('floor', () => {
    pending = [];
    if (sub?.s === 'dm' || sub?.s === 'thread') sub = undefined;
    void loadPending();
    draw();
  });
  store.on('floors', () => {
    store.floors.forEach((f) => !f.cloning && listen(f.id));
    if (!linked && store.floors.length) ((linked = true), deepLink(location.href));
  });
  onRoster(drawLater);
  reads.onChange(draw);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) return;
    draw();
    void loadMe();
    if (tab === 'status') void loadStatus();
  });
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && sub && !modalOpen() && !document.activeElement?.matches('input, textarea, select')) goBack();
  });
  setInterval(() => {
    for (const f of store.floors) if (f.id !== store.floor && !f.cloning && listened.has(f.id)) void refetch(f.id);
    if (tab === 'status' && !document.hidden) void loadStatus();
  }, 45_000);
  void registerWorker();
  void loadMe();
  go(tab);

  return {
    route(msg) {
      routeChatter(msg);
      routeRosterMessage(msg);
      if (msg.t === 'chatter.new' && msg.message.from.kind !== 'human') pending = pending.filter((p) => !(p.thread === msg.message.ref?.thread && msg.message.from.workerId === p.workerId));
      if (msg.t === 'welcome' || msg.t === 'floor.enter' || msg.t === 'roster.changed') drawLater();
    },
    openChat,
  };
}

