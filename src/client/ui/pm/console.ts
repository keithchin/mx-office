// The project console: the middle column of the project summary on the 1D view's Command Center (ui/summary.ts
// draws the columns either side of it), where you, the Project Manager, run the project. The floor's
// Project Coordinator (the agent, role id `pm`; docs/teams.md) at a glance, its terminal live and
// read-only, the escalations the team raised to you (ui/pm/escalations.ts, above the prompt box), and a
// box to ask the Coordinator things without opening its terminal. With no Coordinator hired it says what
// it's for and offers to hire one; with a benched one, its latest handoff note and "Hire again". No
// three.js here: the 1D view imports it. Its screen has two views (Chat | Terminal on the header, the
// default in ⚙️ Settings): the conversation as messages (ui/pm/chat/), or the terminal as it is.
//
// The element is made once and kept: the summary is drawn again every few seconds and only moves the
// columns round it, so what you're typing (and the terminal) survives the redraws.

import type { Net } from '../../net';
import type { ServerMsg } from '../../../shared/protocol';
import type { MemberView, RosterView } from '../../../shared/roster/types';
import { store } from '../../state';
import { h, toast } from '../dom';
import { act, fetchRoster } from '../roster/api';
import { askText } from '../roster/ask';
import { EscalationList } from './escalations';
import { PM_STATE_TEXT, PromptHistory, pmView, type PmView } from './state';
import { PmTerminal } from './term';
import { ChatView } from './chat/view';
import { PMC_VIEWS, PMC_VIEW_LABEL, onPmcView, savePmcView, savedPmcView, type PmcView } from './chat/pref';
import './console.css';
import { managerIn, shapeText } from '../roster/coverage';

export interface PmConsoleDeps {
  net: Net;
  /** The worker's full terminal window, the way the rest of the page opens it (waking it if asleep). */
  openWorker(id: string): void;
  /** Whether the console is on screen now: the Command Center tab, with the floors page not over it. */
  visible(): boolean;
}

export interface PmConsole {
  /** The column, for ui/summary.ts to place between the project details and the recent activity. */
  readonly el: HTMLElement;
  /** Catches up with the floor and whether it's on screen (lite.ts calls it when the tab changes). */
  sync(): void;
  /** Every server message: the team changing, the Coordinator's terminal output, a reconnect. */
  route(msg: ServerMsg): void;
  /** Shows the escalation cards in place of the screen (the fitted Command Center keeps them behind a bar). */
  showEscalations(): void;
}

/** Whether this browser last had the escalation cards showing in place of the Coordinator's screen. */
const ESC_KEY = 'agent-office.pmc-escalations';
const savedEsc = () => {
  try {
    return localStorage.getItem(ESC_KEY) === '1';
  } catch {
    return false;
  }
};

/** The quick questions under the box; `standup` runs the team's standup instead of sending a prompt. */
const CHIPS: { label: string; prompt?: string; standup?: true }[] = [
  { label: '📊 Status update', prompt: "Give me a short status update on the project: what's done, what's in progress and who's on it, and anything that needs me." },
  { label: "🚧 What's blocking?", prompt: "What's blocking the team right now? For each blocker: who it affects and what would unblock it, including anything you need from me." },
  { label: '🗺️ Plan next steps', prompt: 'Plan the next steps: the next 3 to 5 tasks in priority order, which Lead should take each, and why.' },
  { label: '📋 Run standup', standup: true },
];

/** How long "Sent ✓" stays up. */
const ACK_MS = 5000;

export function pmConsole(deps: PmConsoleDeps): PmConsole {
  const { net } = deps;
  let floor: string | undefined;
  let roster: RosterView | undefined;
  let failed: string | undefined;
  let view: PmView = pmView(undefined, undefined);
  let fetchTimer: ReturnType<typeof setTimeout> | undefined;
  let ackTimer: ReturnType<typeof setTimeout> | undefined;
  const history = new PromptHistory();
  /** The prompt Up/Down last put in the box. */
  let recalled: string | undefined;

  const head = h('header.pmc-h');
  const termHost = h('div.pmc-term', { role: 'log', 'aria-label': "The Project Coordinator's terminal (live, read-only)" });
  const screenNote = h('p.pmc-screen-note');
  const chat = new ChatView({ openTerminal: () => view.workerId && deps.openWorker(view.workerId), lines: () => term.lines() });
  const screen = h('div.pmc-screen', {}, termHost, chat.el, screenNote);
  // Chat | Terminal: which view the screen shows, kept in this browser (ui/pm/chat/pref.ts).
  let mode: PmcView = savedPmcView();
  /** The worker whose conversation the office is sending this page now. */
  let watching: string | null = null;
  const modeOpts = PMC_VIEWS.map((v) => h('button.pmc-mode-opt', { type: 'button', role: 'radio', 'data-v': v, onclick: () => pickMode(v) }, PMC_VIEW_LABEL[v]));
  const modeToggle = h('div.pmc-mode', { role: 'radiogroup', 'aria-label': 'Console view: chat or terminal' }, ...modeOpts);
  const empty = h('div.pmc-empty');
  const hint = h('p.pmc-hint');
  const box = h('textarea.pmc-box', { rows: 2, placeholder: 'Ask the Project Coordinator…', 'aria-label': 'Ask the Project Coordinator', enterkeyhint: 'send' });
  const sendBtn = h('button.btn.primary.pmc-send', { type: 'button', title: 'Send (Enter); Shift+Enter for a new line', 'aria-label': 'Send to the Project Coordinator' }, '➤');
  const ack = h('span.pmc-ack', { role: 'status', 'aria-live': 'polite' });
  const chips = h('div.pmc-chips', { role: 'group', 'aria-label': 'Quick questions' });
  const foot = h('footer.pmc-foot', {}, hint, h('div.pmc-ask', {}, box, sendBtn), h('div.pmc-row', {}, chips, ack));
  // Escalations to you sit above the prompt box, and stay there when no Coordinator is hired.
  const escalations = new EscalationList((r) => {
    if (r.floor !== floor) return;
    roster = r;
    draw();
  });
  // On the fitted Command Center (ui/command-layout.css) the cards hide behind a one-line bar, and showing
  // them takes the screen's place, so the console has one area that scrolls, never two.
  const escText = h('span.pmc-esc-text');
  const escBtn = h('button.btn.small.pmc-esc-btn', { type: 'button', 'aria-expanded': 'false', onclick: () => setEsc(!showEsc) });
  const escBar = h('div.pmc-esc-bar', { hidden: true }, escText, escBtn);
  let showEsc = savedEsc();
  function setEsc(on: boolean) {
    showEsc = on;
    try {
      localStorage.setItem(ESC_KEY, on ? '1' : '0');
    } catch {
      // Only this visit.
    }
    drawEsc();
  }
  function drawEsc() {
    const list = roster?.escalations ?? [];
    const open = list.filter((e) => e.status === 'open');
    const loud = open.filter((e) => !e.fyi && (e.urgency === 'urgent' || e.urgency === 'critical')).length;
    escBar.hidden = !list.length;
    escBar.classList.toggle('pmc-esc-loud', loud > 0);
    escText.textContent = open.length ? `🚩 ${open.length} escalation${open.length === 1 ? '' : 's'} to you${loud ? ` · ${loud} need${loud === 1 ? 's' : ''} you now` : ''}` : `🚩 Escalations: ${list.length} answered`;
    el.classList.toggle('pmc-show-esc', showEsc && !!list.length);
    escBtn.textContent = showEsc ? 'Back to the chat ▴' : 'Show ▾';
    escBtn.setAttribute('aria-expanded', String(showEsc));
    // The cards take the screen's place: the terminal behind it is parked (term-park.ts).
    placeTerm();
  }
  const el = h('section.pmc', { 'aria-label': 'Project console' }, head, escBar, screen, empty, escalations.el, foot);
  const term = new PmTerminal(net, termHost);
  /** What hid or showed the terminal's box when it was last placed: measuring the box forces a layout, so only a change does. */
  let placed = '';
  function placeTerm() {
    const now = `${term.showing}|${termHost.hidden}|${screen.hidden}|${el.classList.contains('pmc-show-esc')}`;
    if (now === placed) return;
    placed = now;
    term.place();
  }
  term.onWrite = () => chat.terminalChanged();

  // ---- Chat | Terminal ---------------------------------------------------------------------------
  function pickMode(v: PmcView) {
    if (v !== mode) savePmcView(v);
  }
  modeToggle.addEventListener('keydown', (e) => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
    e.preventDefault();
    const next = PMC_VIEWS[(PMC_VIEWS.indexOf(mode) + 1) % PMC_VIEWS.length];
    pickMode(next);
    modeOpts[PMC_VIEWS.indexOf(next)].focus();
  });
  onPmcView((v) => {
    mode = v;
    draw();
  });
  /** Asks the office for `id`'s conversation (and stops the last one's), or for none. */
  function watch(id: string | null) {
    if (id === watching) return;
    if (watching) net.send({ t: 'convo.unwatch', workerId: watching });
    watching = id;
    if (id) net.send({ t: 'convo.watch', workerId: id });
  }
  function drawChat() {
    const chatting = mode === 'chat';
    termHost.hidden = chatting;
    screen.classList.toggle('pmc-chatting', chatting);
    chat.el.hidden = !chatting || !watching;
    // Hidden, the terminal is parked at once, before a frame can draw it into a box with no size (term-park.ts).
    placeTerm();
    for (const b of modeOpts) {
      const on = b.dataset.v === mode;
      b.setAttribute('aria-checked', String(on));
      b.tabIndex = on ? 0 : -1;
    }
    if (!chatting || !watching) return;
    const pm = pmOf(roster);
    const w = store.workers.get(watching);
    chat.show({ workerId: watching, who: { name: pm?.name ?? w?.name ?? 'Project Coordinator', icon: pm?.icon ?? '🧭', color: w?.color }, status: w?.status, activity: w?.activity, convo: store.convo.get(watching) });
  }

  // Whoever covers Management (shared/roster/coverage.ts): the Project Coordinator, or the Chief Analyst / Solo Lead.
  const pmOf = (r: RosterView | undefined): MemberView | undefined => managerIn(r);
  const worker = (pm: MemberView | undefined) => (pm?.workerId ? store.workers.get(pm.workerId) : undefined);

  // ---- The team, from the office ------------------------------------------------------------------
  function load() {
    const f = floor;
    if (!f) return;
    fetchRoster(f).then(
      (r) => {
        if (f !== floor) return;
        roster = r;
        failed = undefined;
        draw();
      },
      (err) => {
        if (f !== floor) return;
        failed = (err as Error).message;
        draw();
      },
    );
  }
  /** Does a team action and draws what it answers (act toasts why, when it's refused). */
  const run = (action: string, extra: Record<string, unknown> = {}) =>
    floor
      ? act(floor, action, extra).then((r) => {
          if (r && r.floor === floor) {
            roster = r;
            draw();
          }
          return r;
        })
      : Promise.resolve(undefined);

  function hire(pm: MemberView) {
    askText(
      { title: `Hire ${pm.name}, the ${pm.title}`, label: 'A task to start on (optional): it reads its Playbook and journal first', long: true, ok: '🤝 Hire', optional: true },
      (task) => void run('hire', { role: pm.role, ...(task ? { task } : {}) }),
    );
  }
  function wake(pm: MemberView) {
    // An admin wakes it through the team (which keeps the record); anyone can carry its session on.
    if (roster?.admin) void run('hire', { role: pm.role });
    else if (pm.workerId) net.send({ t: 'worker.resume', workerId: pm.workerId });
  }

  // ---- Asking ----------------------------------------------------------------------------------
  function say(how: string) {
    clearTimeout(ackTimer);
    ack.textContent = how;
    ack.classList.add('on');
    ackTimer = setTimeout(() => ack.classList.remove('on'), ACK_MS);
  }
  function send(text: string) {
    const prompt = text.trim();
    if (!prompt || !view.canPrompt || !view.workerId) return false;
    net.send({ t: 'worker.prompt', workerId: view.workerId, prompt });
    history.add(prompt);
    say(view.ack === 'sent' ? 'Sent ✓' : 'Queued while busy ⏳');
    return true;
  }
  function submit() {
    if (send(box.value)) box.value = '';
  }
  sendBtn.addEventListener('click', submit);
  box.addEventListener('keydown', (e) => {
    if (e.isComposing) return;
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
      return;
    }
    // Up at the top of the box (Down at its end), or on a recalled prompt not edited yet, walks what
    // you sent this visit, as a shell does; anywhere else they move the caret through your lines.
    const untouched = recalled !== undefined && box.value === recalled;
    const atStart = untouched || (box.selectionStart === 0 && box.selectionEnd === 0);
    const atEnd = untouched || box.selectionStart === box.value.length;
    const step = e.key === 'ArrowUp' && atStart ? history.back() : e.key === 'ArrowDown' && atEnd ? history.forward() : undefined;
    if (step === undefined) return;
    e.preventDefault();
    box.value = recalled = step;
    box.setSelectionRange(step.length, step.length);
  });
  for (const c of CHIPS) {
    const b = h('button.btn.small.pmc-chip', { type: 'button', 'data-standup': c.standup ? '1' : undefined, title: c.prompt ?? "Ask every Lead for its standup; the Project Coordinator compiles the page" }, c.label);
    b.addEventListener('click', () => {
      if (c.prompt) send(c.prompt);
      else void run('standup').then((r) => r && say('📋 Standup started'));
    });
    chips.append(b);
  }

  // ---- Drawing ---------------------------------------------------------------------------------
  function header(pm: MemberView | undefined, w: ReturnType<typeof worker>) {
    const facts = [view.model ? `🧠 ${view.model}` : null, view.cost !== undefined ? `💵 $${view.cost.toFixed(2)}` : null].filter(Boolean).join(' · ');
    head.replaceChildren(
      h('span.pmc-icon', { 'aria-hidden': 'true' }, pm?.icon ?? '🧭'),
      h('span.pmc-who', {}, h('span.pmc-name', {}, pm?.name ?? 'Project Coordinator'), h('span.pmc-role', {}, pm ? `${pm.title}${roster ? ` · ${shapeText(roster)}` : ''}${facts ? ` · ${facts}` : ''}` : 'Project console')),
      roster ? h('span.pmc-pill', { class: `pmc-${view.state}` }, PM_STATE_TEXT[view.state]) : '',
      roster && !view.hire ? modeToggle : '',
      view.canWake && pm ? h('button.btn.small.pmc-wake', { type: 'button', title: `Wake ${pm.name}: its session carries on`, onclick: () => wake(pm) }, '⏰ Wake') : '',
      w ? h('button.btn.small.pmc-open', { type: 'button', title: `Open ${pm?.name ?? 'the Project Coordinator'}'s full terminal`, onclick: () => deps.openWorker(w.id) }, '⤢ Open') : '',
    );
  }

  function emptyState(pm: MemberView | undefined) {
    const admin = !!roster?.admin;
    if (!roster) {
      empty.replaceChildren(h('p.pmc-dim', {}, failed ? `Couldn't load the team: ${failed}` : 'Loading the team…'));
      return;
    }
    if (!pm) return void empty.replaceChildren(h('p.pmc-dim', {}, 'This floor has no project team.'));
    const paused = roster.paused ? h('p.pmc-warn', {}, `💸 ${roster.paused}`) : '';
    if (view.hire === 'again') {
      const note = pm.lastJournal;
      empty.replaceChildren(
        h('p.pmc-empty-h', {}, `🪑 ${pm.name} is benched`),
        h('p.pmc-dim', {}, 'Its session was cleared to save money. Hiring it again starts fresh from its Playbook and this note.'),
        note ? h('blockquote.pmc-note', {}, h('span.pmc-note-h', {}, pm.handoffAt ? '📝 Latest handoff note' : '📓 Latest journal entry'), h('b', {}, note.heading), ' ', note.excerpt) : '',
        paused,
        admin ? h('button.btn.primary', { type: 'button', onclick: () => hire(pm) }, '🤝 Hire again') : h('p.pmc-dim', {}, 'Ask the Project Manager (an admin) to hire the Project Coordinator again.'),
      );
      return;
    }
    empty.replaceChildren(
      h('div.pmc-empty-ico', { 'aria-hidden': 'true' }, '🧭'),
      h('p.pmc-empty-h', {}, `No ${pm.title} yet`),
      h('p.pmc-dim', {}, pm.role === 'pm' ? 'The Project Coordinator is the agent that keeps the plan, coordinates the four Leads, runs the standup and relays their escalations to you, the Project Manager. Hire one and ask it anything from here: a status update, what is blocking, what to do next.' : `On this team the ${pm.title} covers Management: it runs the standup and hears the escalations. Hire it and ask it anything from here: a status update, what is blocking, what to do next.`),
      paused,
      admin
        ? h('button.btn.primary.pmc-hire', { type: 'button', title: `Hire ${pm.name}: a fresh session from its Playbook`, onclick: () => hire(pm) }, `🤝 Hire ${pm.title}`)
        : h('p.pmc-dim', {}, `Ask the Project Manager (an admin) to hire the ${pm.title}.`),
    );
  }

  function draw() {
    const pm = pmOf(roster);
    const w = worker(pm);
    view = pmView(roster ? pm : undefined, w);
    if (!roster) view = { ...view, hire: undefined };
    const emptyShown = !roster || !!view.hire;
    header(pm, w);
    el.dataset.state = roster ? view.state : 'loading';
    empty.hidden = !emptyShown;
    screen.hidden = emptyShown;
    foot.hidden = emptyShown;
    if (emptyShown) emptyState(pm);
    escalations.render(roster);
    drawEsc();
    screenNote.textContent = view.live ? '' : view.state === 'asleep' ? `💤 ${pm?.name ?? 'The Project Coordinator'} is asleep` : view.workerId ? '' : `${pm?.name ?? 'The Project Coordinator'} isn't at a desk on this floor`;
    screenNote.hidden = !screenNote.textContent;
    // On a Solo or Startup team the console talks to whoever covers Management: its name, not "the Project Coordinator".
    const who = pm && pm.role !== 'pm' ? pm.name : undefined;
    hint.textContent = who ? (view.hint ?? '').replace('The Project Coordinator', who) : (view.hint ?? '');
    box.placeholder = `Ask ${who ?? 'the Project Coordinator'}…`;
    box.setAttribute('aria-label', `Ask ${who ?? 'the Project Coordinator'}`);
    hint.hidden = !view.hint;
    hint.classList.toggle('bad', view.state === 'needs-you');
    box.disabled = !view.canPrompt;
    sendBtn.disabled = !view.canPrompt;
    for (const b of chips.querySelectorAll<HTMLButtonElement>('.pmc-chip')) b.disabled = b.dataset.standup ? !roster : !view.canPrompt;
    // The terminal only while it's on screen and the tab is in front: a watcher counts as someone at
    // the PM's terminal, which keeps it from being benched for idling (docs/teams.md).
    term.show(deps.visible() && !document.hidden && view.live ? (view.workerId ?? null) : null);
    if (w && term.showing === w.id) term.sizeTo(w.cols, w.rows);
    watch(mode === 'chat' ? term.showing : null);
    drawChat();
  }

  function sync() {
    const f = store.floor ?? undefined;
    if (f !== floor) {
      floor = f;
      roster = undefined;
      failed = undefined;
      term.show(null);
      load();
    }
    draw();
  }

  store.on('floor', sync);
  store.on('workers', draw);
  store.on('convo', drawChat);
  document.addEventListener('visibilitychange', draw);

  return {
    el,
    sync,
    showEscalations: () => setEsc(true),
    route(msg) {
      term.route(msg);
      if (msg.t === 'welcome') {
        term.reattach();
        // The office forgot what this page watched, as it forgot the terminal.
        if (watching) net.send({ t: 'convo.watch', workerId: watching });
      }
      if (msg.t !== 'roster.changed' || msg.floor !== floor) return;
      // A burst of changes (a standup asking four Leads) fetches once.
      clearTimeout(fetchTimer);
      fetchTimer = setTimeout(load, 300);
    },
  };
}
