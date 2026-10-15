// The team-lead panel's contents (./index.ts docks them beside every project tab): the agent who leads
// the team (whoever covers Management: shared/roster/coverage.ts) with its real name and role, a status
// line, and two views, Chat (its conversation as messages, ui/pm/chat/) and Terminal (its screen, live and
// read-only, ui/pm/term.ts). Above the chat, "N waiting on you →" (every actionable Needs you item,
// ui/needsyou/feed.ts) takes you to the Overview's Needs you card. Below it the composer (./composer.ts).
// With nobody covering Management it says so and offers to hire one; with a benched lead its handoff
// note and Hire again. This is what the project console in the middle of the Command Center used to be.
//
// The terminal is attached only while something on screen shows it (./logic.ts terminalWanted): the
// Terminal view of an open panel, the expanded overlay, or the chat's terminal-text fallback, with the
// browser tab visible. The team comes from the page's one roster (ui/teams/world.ts), the conversation
// from the convo slice, the waiting count from the Needs-you strip: no fetches or timers of its own.

import type { Net } from '../../net';
import type { ServerMsg } from '../../../shared/protocol';
import { workingFor } from '../../../shared/roster/interrupt';
import type { RosterView } from '../../../shared/roster/types';
import { store } from '../../state';
import { h, toast } from '../dom';
import { act } from '../roster/api';
import { askText } from '../roster/ask';
import { checkStandup, checkTeamAsk } from '../roster/interrupt-check';
import { shapeText } from '../roster/coverage';
import { currentRoster, onRoster, setRoster } from '../teams/world';
import { pmView, type PmView } from '../pm/state';
import { PmTerminal } from '../pm/term';
import { termTheme } from '../termtheme';
import { ChatView } from '../pm/chat/view';
import { onPmcView, PMC_VIEW_LABEL, PMC_VIEWS, savedPmcView, savePmcView, type PmcView } from '../pm/chat/pref';
import { onNeeds, waitingCount } from '../needsyou/feed';
import { Composer } from './composer';
import { initialsOf, lastAgentId, leadHeading, leadOf, statusLine, terminalWanted, unreadSince, type Lead, type QUICK, type SendPlan } from './logic';

export interface PanelDeps {
  net: Net;
  openWorker(id: string): void;
  /** Goes to the Overview's Needs you (switching tab first) and highlights it. */
  toNeeds(): void;
  /** Whether the panel is open on screen now (not collapsed; on a phone, its sheet up). */
  open(): boolean;
  phone(): boolean;
  /** The expanded overlay: opened from `opener`, with the terminal's box moved into it. */
  expand(opener: HTMLElement, host: HTMLElement, title: string): void;
  expanded(): boolean;
  /** Something the frame shows changed (the avatar, the name, the unread count). */
  changed(): void;
  /** What you typed for a project, kept; and the kept draft. */
  draft(floor: string, text?: string): string;
  /** The last of the lead's messages you saw (by worker), kept. */
  seen(workerId: string, id?: string): string | undefined;
  /** Where you'd scrolled the chat on this project last time, kept. */
  scroll?(floor: string): number | undefined;
  /** The panel has what it shows for `floor` (the floor's loading overlay, ui/loading/). */
  onLoaded?(floor: string): void;
}

export class LeadPanel {
  readonly el: HTMLElement;
  readonly avatar: () => HTMLElement;
  lead: Lead | undefined;
  unread = 0;
  private floor: string | undefined;
  private roster: RosterView | undefined;
  private view: PmView = pmView(undefined, undefined);
  private mode: PmcView = savedPmcView();
  private watching: string | null = null;
  private waiting = 0;
  private readonly term: PmTerminal;
  private readonly chat: ChatView;
  private readonly composer: Composer;
  private readonly head = { av: h('span.lp-av', { 'aria-hidden': 'true' }), name: h('span.lp-name-n'), role: h('span.lp-name-r'), status: h('div.lp-status', { role: 'status', 'aria-live': 'polite' }) };
  private readonly tabs: HTMLButtonElement[];
  private readonly expandBtn: HTMLButtonElement;
  private readonly termLink: HTMLButtonElement;
  private readonly wakeBtn: HTMLButtonElement;
  private readonly waitBtn: HTMLButtonElement;
  private readonly chatPane: HTMLElement;
  private readonly termPane: HTMLElement;
  private readonly termHost: HTMLElement;
  private readonly termNote: HTMLElement;
  private readonly conn: HTMLElement;
  private readonly emptyEl: HTMLElement;
  private readonly tabRow: HTMLElement;
  /** What placed the terminal last: measuring its box forces a layout, so only a change does. */
  private placed = '';
  /** What the connection badge and the note last said. */
  private connKey = '';
  private convoFor: string | undefined;
  /** The project whose kept scroll position is still to be put back. */
  private restoreFor: string | undefined;

  constructor(private readonly deps: PanelDeps, frameButtons: HTMLElement[]) {
    const { net } = deps;
    this.termHost = h('div.lp-termhost', { role: 'log', 'aria-live': 'off', tabindex: '0' });
    this.term = new PmTerminal(net, this.termHost);
    this.chat = new ChatView({ openTerminal: () => this.view.workerId && deps.openWorker(this.view.workerId), lines: () => this.term.lines(), page: 24 });
    this.term.onWrite = () => this.chat.terminalChanged();
    this.composer = new Composer({ send: (t, p) => this.send(t, p), quick: (q) => void this.quick(q), draft: (t) => this.floor && deps.draft(this.floor, t) });

    this.tabs = PMC_VIEWS.map((v) =>
      h('button.lp-tab', { type: 'button', role: 'tab', id: `lp-tab-${v}`, 'aria-controls': `lp-pane-${v}`, 'data-v': v, onclick: () => this.pick(v) }, PMC_VIEW_LABEL[v]),
    ) as HTMLButtonElement[];
    this.tabRow = h('div.lp-tabs', { role: 'tablist', 'aria-label': 'Panel view' }, ...this.tabs);
    this.tabRow.addEventListener('keydown', (e) => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
      e.preventDefault();
      const next = PMC_VIEWS[(PMC_VIEWS.indexOf(this.mode) + 1) % PMC_VIEWS.length];
      this.pick(next);
      this.tabs[PMC_VIEWS.indexOf(next)].focus();
    });
    this.expandBtn = h('button.btn.small.lp-expand', { type: 'button', title: 'Expand the terminal (Esc returns)', hidden: true }, '⤢ Expand') as HTMLButtonElement;
    this.expandBtn.addEventListener('click', () => this.expand(this.expandBtn));
    this.termLink = h('button.lp-termlink', { type: 'button' }, 'Open terminal') as HTMLButtonElement;
    this.termLink.addEventListener('click', () => this.expand(this.termLink));
    this.wakeBtn = h('button.btn.small.lp-wake', { type: 'button', hidden: true, onclick: () => this.wake() }, '⏰ Wake') as HTMLButtonElement;
    const header = h(
      'header.lp-h',
      {},
      h('div.lp-top', {}, this.head.av, h('div.lp-who', {}, h('div.lp-name', { id: 'lp-name' }, this.head.name, this.head.role), this.head.status), this.wakeBtn, this.expandBtn, this.termLink, ...frameButtons),
      this.tabRow,
    );
    this.waitBtn = h('button.lp-wait', { type: 'button', hidden: true, onclick: () => deps.toNeeds() }) as HTMLButtonElement;
    this.chatPane = h('section.lp-pane.lp-chat', { id: 'lp-pane-chat', role: 'tabpanel', 'aria-labelledby': 'lp-tab-chat' }, this.waitBtn, this.chat.el, this.composer.el);
    this.conn = h('span.lp-conn');
    this.termNote = h('p.lp-term-off', { hidden: true });
    this.termPane = h(
      'section.lp-pane.lp-term',
      { id: 'lp-pane-terminal', role: 'tabpanel', 'aria-labelledby': 'lp-tab-terminal', hidden: true },
      h('div.lp-term-bar', {}, h('span', { 'aria-hidden': 'true' }, '🔒'), h('span.lp-grow', {}, 'Read-only · live'), this.conn),
      h('div.lp-term-frame', {}, this.termHost, this.termNote),
      h('p.lp-term-note', {}, 'Connects only while this tab is visible. To steer the agent, use Chat.'),
    );
    this.emptyEl = h('div.lp-empty', { hidden: true });
    this.el = h('div.lp-body', {}, header, this.chatPane, this.termPane, this.emptyEl);
    this.avatar = () => this.avatarEl();

    onPmcView((v) => ((this.mode = v), this.draw()));
    onRoster(() => this.draw());
    store.on('floor', () => this.sync());
    store.on('workers', () => this.draw());
    store.on('convo', () => this.convoChanged());
    document.addEventListener('visibilitychange', () => this.draw());
    onNeeds((s) => {
      const n = s.floor === this.floor ? waitingCount(s.items) : 0;
      if (n === this.waiting) return;
      this.waiting = n;
      this.drawWaiting();
    });
  }

  // ---- The floor and its team ---------------------------------------------------------------------
  sync() {
    const f = store.floor ?? undefined;
    if (f !== this.floor) {
      this.floor = f;
      this.roster = undefined;
      this.term.show(null);
      this.composer.set(f ? this.deps.draft(f) : '');
      this.convoFor = f;
      this.restoreFor = f;
    }
    this.draw();
  }

  private member() {
    return this.lead && this.lead.kind !== 'none' ? this.lead.member : undefined;
  }

  private worker() {
    const m = this.member();
    return m?.workerId ? store.workers.get(m.workerId) : undefined;
  }

  /** Does a team action and takes in the team it answers (act toasts why, when it's refused). */
  private run(action: string, extra: Record<string, unknown> = {}) {
    const f = this.floor;
    if (!f) return Promise.resolve(undefined);
    return act(f, action, extra).then((r) => {
      if (r && r.floor === this.floor) setRoster(r);
      return r;
    });
  }

  // ---- Drawing -------------------------------------------------------------------------------------
  draw() {
    const r = currentRoster();
    this.roster = r && r.floor === this.floor ? r : undefined;
    this.lead = leadOf(this.roster);
    const w = this.worker();
    this.view = pmView(this.roster ? this.lead?.member : undefined, w);
    if (!this.roster) this.view = { ...this.view, hire: undefined };
    this.drawHead();
    const chatOk = this.lead?.kind === 'lead';
    this.tabRow.hidden = !chatOk;
    this.emptyEl.hidden = chatOk;
    if (!chatOk) this.drawEmpty();
    const chatting = this.mode === 'chat' || this.deps.phone();
    this.chatPane.hidden = !chatOk || !chatting;
    this.termPane.hidden = !chatOk || chatting;
    this.expandBtn.hidden = !chatOk || chatting || this.deps.phone();
    this.termLink.hidden = !chatOk || !this.deps.phone() || !this.view.live;
    for (const b of this.tabs) {
      const on = b.dataset.v === this.mode;
      b.setAttribute('aria-selected', String(on));
      b.tabIndex = on ? 0 : -1;
      b.classList.toggle('lp-dot', b.dataset.v === 'chat' && !on && this.unread > 0);
    }
    this.drawComposer(w);
    this.attach();
    this.drawChat();
    this.drawWaiting();
    if (this.floor && this.roster && this.convoFor === this.floor && (!this.watching || store.convo.has(this.watching))) {
      this.convoFor = undefined;
      this.deps.onLoaded?.(this.floor);
    }
    this.deps.changed();
  }

  private avatarEl(size = 34): HTMLElement {
    const l = this.lead;
    const w = this.worker();
    const name = l && l.kind !== 'none' ? l.name : '?';
    return h('span.lp-face', { class: l?.kind === 'lead' ? '' : 'lp-face-off', style: `--face:${w?.color ?? 'var(--accent)'};--size:${size}px` }, h('span.lp-face-emo', {}, this.member()?.icon ?? '🧭'), h('span.lp-face-i', {}, l && l.kind !== 'none' ? initialsOf(name) : '?'));
  }

  /** What the avatar shows, to tell a change from a redraw that would draw the same. */
  avatarKey(): string {
    const l = this.lead;
    return `${l?.kind}|${l && l.kind !== 'none' ? l.name : ''}|${this.worker()?.color ?? ''}|${this.member()?.icon ?? ''}`;
  }

  private headKey = '';
  private avKey = '';
  private drawHead() {
    const hd = leadHeading(this.lead);
    const w = this.worker();
    const st = statusLine(this.lead, this.view.state, w?.activity ?? this.member()?.activity);
    const facts = this.roster && this.lead?.kind === 'lead' ? shapeText(this.roster) : '';
    const key = JSON.stringify([this.avatarKey(), hd, st, facts, this.view.canWake]);
    if (key === this.headKey) return;
    this.headKey = key;
    // The face only when it changed (the status line changes with every tool call).
    if (this.avKey !== this.avatarKey()) ((this.avKey = this.avatarKey()), this.head.av.replaceChildren(this.avatarEl()));
    this.head.name.textContent = hd.name;
    this.head.role.textContent = this.lead?.kind === 'none' ? '' : ` · ${hd.role}`;
    this.head.status.replaceChildren(h('span.lp-st', { class: `lp-st-${st.dot}` }, h('i', { 'aria-hidden': 'true' }), h('span.lp-st-t', {}, st.text)));
    // One line; the whole of it (and the team's shape) on hover.
    this.head.status.title = `${st.text}${facts ? ` · Team: ${facts}` : ''}`;
    this.wakeBtn.hidden = !(this.view.canWake && this.member());
  }

  private waitKey = '';
  private drawWaiting() {
    const n = this.waiting;
    const key = `${n}|${this.lead?.kind}`;
    if (key === this.waitKey) return;
    this.waitKey = key;
    this.waitBtn.hidden = !n || this.lead?.kind !== 'lead';
    this.waitBtn.replaceChildren(h('span', { 'aria-hidden': 'true' }, '⚑'), h('span.lp-grow', {}, h('b', {}, `${n} waiting on you`), ' · on the Overview'), h('span', { 'aria-hidden': 'true' }, '→'));
    this.waitBtn.setAttribute('aria-label', `${n} waiting on you: go to Needs you on the Overview`);
  }

  private drawComposer(w: ReturnType<LeadPanel['worker']>) {
    const name = this.lead && this.lead.kind !== 'none' ? this.lead.name : 'the lead';
    const busy = !!w && w.status === 'working' && this.view.canPrompt;
    const hint = this.view.hint?.replace('The Project Coordinator', name);
    this.composer.show({ name, canPrompt: this.view.canPrompt, team: !!this.roster, midTurn: busy ? workingFor(w.workingSince, Date.now()).replace(/^working,?\s*/, '') || 'now' : undefined, hint, bad: this.view.state === 'needs-you' });
  }

  private emptyKey = '';
  private drawEmpty() {
    const r = this.roster;
    const l = this.lead;
    const admin = !!r?.admin;
    const key = JSON.stringify([!!r, l?.kind, l?.member?.role, l?.member?.lastJournal, l?.member?.handoffAt, admin, r?.paused]);
    if (key === this.emptyKey) return;
    this.emptyKey = key;
    if (!r || !l) return void this.emptyEl.replaceChildren(h('p.lp-dim', {}, 'Loading the team…'));
    const paused = r.paused ? h('p.lp-warn', {}, `💸 ${r.paused}`) : '';
    if (l.kind === 'benched') {
      const note = l.member.lastJournal;
      this.emptyEl.replaceChildren(
        h('div.lp-big', { 'aria-hidden': 'true' }, '🪑'),
        h('h3.lp-empty-h', {}, `${l.name} is benched`),
        h('p.lp-dim', {}, 'Its session was cleared to save money. Hiring it again starts fresh from its Playbook and this note.'),
        note ? h('blockquote.lp-handoff', {}, h('span.lp-hh', {}, l.member.handoffAt ? '📝 Latest handoff note' : '📓 Latest journal entry'), h('b', {}, note.heading), ' ', note.excerpt) : '',
        paused,
        admin ? h('button.btn.primary', { type: 'button', onclick: () => this.hire(l.member, true) }, 'Hire again') : h('p.lp-dim', {}, `Ask the Project Manager (an admin) to hire ${l.name} again.`),
      );
      return;
    }
    if (l.kind !== 'none') return;
    const m = l.member;
    this.emptyEl.replaceChildren(
      h('div.lp-big', { 'aria-hidden': 'true' }, '🧭'),
      h('h3.lp-empty-h', {}, 'No one leads the team yet'),
      h('p.lp-dim', {}, m?.role === 'pm' || !m ? 'No one on this team covers Management. A Project Coordinator keeps the plan, coordinates the Leads, runs the standup and relays their escalations to you. Hire one and ask it anything from here.' : `On this team the ${m.title} covers Management: it runs the standup and hears the escalations. Hire it and ask it anything from here.`),
      paused,
      m && admin ? h('button.btn.primary.lp-hire', { type: 'button', onclick: () => this.hire(m, false) }, `Hire a ${m.role === 'pm' ? 'Coordinator' : m.title}`) : h('p.lp-dim', {}, `Ask the Project Manager (an admin) to hire the ${m?.title ?? 'Project Coordinator'}.`),
    );
  }

  private hire(m: NonNullable<ReturnType<LeadPanel['member']>> | { role: string; name: string; title: string }, again: boolean) {
    askText(
      { title: `${again ? 'Hire again' : 'Hire'}: ${m.name}, the ${m.title}`, label: 'A task to start on (optional): it reads its Playbook and journal first', long: true, ok: '🤝 Hire', optional: true },
      (task) => void this.run('hire', { role: m.role, ...(task ? { task } : {}) }),
    );
  }

  private wake() {
    const m = this.member();
    if (!m) return;
    // An admin wakes it through the team (which keeps the record); anyone can carry its session on.
    if (this.roster?.admin) void this.run('hire', { role: m.role });
    else if (m.workerId) this.deps.net.send({ t: 'worker.resume', workerId: m.workerId });
  }

  // ---- Chat | Terminal -----------------------------------------------------------------------------
  private pick(v: PmcView) {
    if (v !== this.mode) savePmcView(v);
  }

  /** Attaches the terminal while something on screen shows it, and lets it go otherwise (./logic.ts). */
  attach() {
    const c = this.watching ? store.convo.get(this.watching) : undefined;
    const want = terminalWanted({
      open: this.deps.open(),
      phone: this.deps.phone(),
      view: this.mode,
      expanded: this.deps.expanded(),
      pageHidden: document.hidden,
      live: this.lead?.kind === 'lead' && this.view.live,
      fallback: !!c && !c.available,
    });
    const id = want ? (this.view.workerId ?? null) : null;
    this.term.show(id);
    // The box round the screen in the screen's own colour (the theme's terminal colours), not a strip of the page's.
    if (id) this.termHost.style.background = termTheme().background ?? '';
    const w = this.worker();
    if (w && this.term.showing === w.id) this.term.sizeTo(w.cols, w.rows);
    // The conversation is watched whenever there's a lead to talk to: the unread badge counts it while collapsed.
    this.watch(this.lead?.kind === 'lead' && !document.hidden ? (this.view.workerId ?? null) : null);
    const note = this.view.live ? '' : this.view.state === 'asleep' ? `💤 ${this.lead && this.lead.kind !== 'none' ? this.lead.name : 'The lead'} is asleep` : 'Not at a desk on this project';
    const shown = `${!!id}|${note}`;
    if (shown !== this.connKey) {
      this.connKey = shown;
      this.conn.replaceChildren(id ? h('span.lp-conn-b', {}, h('i'), 'connected') : h('span.lp-conn-b.lp-conn-off', {}, h('i'), 'not connected'));
      this.termNote.hidden = !note;
      this.termNote.textContent = note;
    }
    const key = `${this.term.showing}|${this.termPane.hidden}|${this.deps.open()}|${this.deps.expanded()}`;
    if (key !== this.placed) {
      this.placed = key;
      this.term.place();
    }
  }

  private watch(id: string | null) {
    if (id === this.watching) return;
    if (this.watching) this.deps.net.send({ t: 'convo.unwatch', workerId: this.watching });
    this.watching = id;
    if (id) this.deps.net.send({ t: 'convo.watch', workerId: id });
  }

  private drawChat() {
    const id = this.watching;
    // Only while you can see it: collapsed (or on a phone, with the sheet down) it draws nothing; opening it catches up.
    if (this.chatPane.hidden || !id || !this.deps.open() || document.hidden) return;
    const m = this.member();
    const w = store.workers.get(id);
    const convo = store.convo.get(id);
    this.chat.show({ workerId: id, who: { name: m?.name ?? w?.name ?? 'Team lead', icon: m?.icon ?? '🧭', color: w?.color }, status: w?.status, activity: w?.activity, convo });
    // Where you'd scrolled on your last visit to this project, once its conversation is in.
    const list = this.list;
    if (this.restoreFor === this.floor && convo?.messages.length && list) {
      this.restoreFor = undefined;
      const at = this.deps.scroll?.(this.floor!);
      if (at !== undefined && at < list.scrollHeight - list.clientHeight - 40) list.scrollTop = at;
    }
  }

  /** The conversation changed: the chat, and the unread count when you can't see it. */
  private convoChanged() {
    this.drawChat();
    this.countUnread();
    if (this.convoFor) this.draw();
  }

  /** Marks the lead's messages as seen while the chat is in front of you; counts the rest. */
  countUnread() {
    const id = this.watching;
    const msgs = id ? store.convo.get(id)?.messages : undefined;
    if (!id || !msgs) return;
    const newest = lastAgentId(msgs);
    const seen = this.deps.seen(id);
    const looking = this.deps.open() && (this.mode === 'chat' || this.deps.phone()) && !document.hidden;
    if (seen === undefined || looking) {
      if (newest && newest !== seen) this.deps.seen(id, newest);
      if (this.unread) ((this.unread = 0), this.deps.changed(), this.draw());
      return;
    }
    const n = unreadSince(msgs, seen);
    if (n === this.unread) return;
    this.unread = n;
    this.deps.changed();
    for (const b of this.tabs) b.classList.toggle('lp-dot', b.dataset.v === 'chat' && this.mode !== 'chat' && n > 0);
  }

  private expand(opener: HTMLElement) {
    if (this.lead?.kind !== 'lead') return;
    this.deps.expand(opener, this.termHost, `${this.lead.name}'s terminal`);
  }

  /** The terminal's box comes back from the overlay. */
  returnHost() {
    this.termPane.querySelector('.lp-term-frame')?.prepend(this.termHost);
    this.placed = '';
    this.attach();
  }

  // ---- Asking -------------------------------------------------------------------------------------
  private async send(text: string, plan: SendPlan): Promise<boolean> {
    if (!this.view.canPrompt || !this.view.workerId) return false;
    if (plan.via === 'tell') {
      const r = await this.run('tell', { prompt: text, when: 'after' });
      if (r) toast('Queued for after their turn ⏳');
      return !!r;
    }
    this.deps.net.send({ t: 'worker.prompt', workerId: this.view.workerId, prompt: text });
    if (this.view.ack !== 'sent') toast('Queued while busy ⏳');
    return true;
  }

  /** A quick action: the "OK to interrupt?" check first when anyone it reaches is mid-turn. */
  private async quick(q: (typeof QUICK)[number]) {
    const r = this.roster;
    if (!r) return;
    if (q.standup) {
      const choices = await checkStandup(r);
      if (choices) void this.run('standup', { choices }).then((x) => x && toast('📋 Standup started'));
      return;
    }
    const m = this.member();
    const choices = await checkTeamAsk(r, q.label, m?.name ?? 'the lead');
    if (!choices || !m || !q.prompt) return;
    // The office sends it (a question, never the lead's task), now or after its turn, and holds its relays to the Leads as picked.
    const { [m.role]: own, ...leads } = choices;
    this.composer.remember(q.prompt);
    void this.run('tell', { prompt: q.prompt, when: own === 'after' ? 'after' : 'now', leads }).then((x) => x && toast(own === 'after' ? 'Queued for after their turn ⏳' : 'Sent ✓'));
  }

  /** "Ask <name>" from somewhere else (an escalation in Needs you): the box, prefilled and focused. */
  ask(text: string) {
    if (this.mode !== 'chat') savePmcView('chat');
    this.composer.set(text, true);
    if (this.floor) this.deps.draft(this.floor, text);
  }

  route(msg: ServerMsg) {
    this.term.route(msg);
    if (msg.t === 'welcome') {
      this.term.reattach();
      // The office forgot what this page watched, as it forgot the terminal.
      if (this.watching) this.deps.net.send({ t: 'convo.watch', workerId: this.watching });
    }
  }

  get canChat(): boolean {
    return this.lead?.kind === 'lead';
  }

  /** Whether the chat's list is where to keep the scroll (per project). */
  get list(): HTMLElement | null {
    return this.chat.el.querySelector('.pmc-chat-list');
  }

  get project(): string | undefined {
    return this.floor;
  }
}
