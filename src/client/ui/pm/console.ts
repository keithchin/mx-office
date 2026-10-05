// The project console: the middle column of the project summary above the 1D view's board (ui/summary.ts
// draws the columns either side of it), where you, the Project Manager, run the project. The floor's
// Project Coordinator (the agent, role id `pm`; docs/teams.md) at a glance, its terminal live and
// read-only, the escalations the team raised to you (ui/pm/escalations.ts, above the prompt box), and a
// box to ask the Coordinator things without opening its terminal. With no Coordinator hired it says what
// it's for and offers to hire one; with a benched one, its latest handoff note and "Hire again". No
// three.js here: the 1D view imports it.
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
import './console.css';

export interface PmConsoleDeps {
  net: Net;
  /** The worker's full terminal window, the way the rest of the page opens it (waking it if asleep). */
  openWorker(id: string): void;
  /** Whether the console is on screen now: the Board tab, with the floors page not over it. */
  visible(): boolean;
}

export interface PmConsole {
  /** The column, for ui/summary.ts to place between the project details and the recent activity. */
  readonly el: HTMLElement;
  /** Catches up with the floor and whether it's on screen (lite.ts calls it when the tab changes). */
  sync(): void;
  /** Every server message: the team changing, the Coordinator's terminal output, a reconnect. */
  route(msg: ServerMsg): void;
}

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
  const screen = h('div.pmc-screen', {}, termHost, screenNote);
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
  const el = h('section.pmc', { 'aria-label': 'Project console' }, head, screen, empty, escalations.el, foot);
  const term = new PmTerminal(net, termHost);

  const pmOf = (r: RosterView | undefined): MemberView | undefined => r?.members.find((m) => m.role === 'pm');
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
      (task) => void run('hire', { role: 'pm', ...(task ? { task } : {}) }),
    );
  }
  function wake(pm: MemberView) {
    // An admin wakes it through the team (which keeps the record); anyone can carry its session on.
    if (roster?.admin) void run('hire', { role: 'pm' });
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
      h('span.pmc-who', {}, h('span.pmc-name', {}, pm?.name ?? 'Project Coordinator'), h('span.pmc-role', {}, pm ? `${pm.title}${facts ? ` · ${facts}` : ''}` : 'Project console')),
      roster ? h('span.pmc-pill', { class: `pmc-${view.state}` }, PM_STATE_TEXT[view.state]) : '',
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
      h('p.pmc-empty-h', {}, 'No Project Coordinator yet'),
      h('p.pmc-dim', {}, 'The Project Coordinator is the agent that keeps the plan, coordinates the four Leads, runs the standup and relays their escalations to you, the Project Manager. Hire one and ask it anything from here: a status update, what is blocking, what to do next.'),
      paused,
      admin
        ? h('button.btn.primary.pmc-hire', { type: 'button', title: `Hire ${pm.name}: a fresh session from its Playbook`, onclick: () => hire(pm) }, '🤝 Hire Project Coordinator')
        : h('p.pmc-dim', {}, 'Ask the Project Manager (an admin) to hire the Project Coordinator.'),
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
    screenNote.textContent = view.live ? '' : view.state === 'asleep' ? `💤 ${pm?.name ?? 'The Project Coordinator'} is asleep` : view.workerId ? '' : `${pm?.name ?? 'The Project Coordinator'} isn't at a desk on this floor`;
    screenNote.hidden = !screenNote.textContent;
    hint.textContent = view.hint ?? '';
    hint.hidden = !view.hint;
    hint.classList.toggle('bad', view.state === 'needs-you');
    box.disabled = !view.canPrompt;
    sendBtn.disabled = !view.canPrompt;
    for (const b of chips.querySelectorAll<HTMLButtonElement>('.pmc-chip')) b.disabled = b.dataset.standup ? !roster : !view.canPrompt;
    // The terminal only while it's on screen and the tab is in front: a watcher counts as someone at
    // the PM's terminal, which keeps it from being benched for idling (docs/teams.md).
    term.show(deps.visible() && !document.hidden && view.live ? (view.workerId ?? null) : null);
    if (w && term.showing === w.id) term.sizeTo(w.cols, w.rows);
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
  document.addEventListener('visibilitychange', draw);

  return {
    el,
    sync,
    route(msg) {
      term.route(msg);
      if (msg.t === 'welcome') term.reattach();
      if (msg.t !== 'roster.changed' || msg.floor !== floor) return;
      // A burst of changes (a standup asking four Leads) fetches once.
      clearTimeout(fetchTimer);
      fetchTimer = setTimeout(load, 300);
    },
  };
}
