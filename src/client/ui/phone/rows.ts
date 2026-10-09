// The team phone's rows, Slack-like: a message (the speaker's face, name and role, when, who it's to,
// the words, Markdown for a phone message and its reply), a thread's root with its reply count, a
// notification (a Needs-you item from Jeff or the office, with its buttons) and the typing line.

import { CHATTER_WORD, isGroup, type ChatterMessage, type ChatterTo } from '../../../shared/chatter';
import type { ThreadView } from '../../../shared/phone';
import { store } from '../../state';
import { avatar } from '../chatter/message';
import type { ChatterActions } from '../chatter/message';
import { h, timeAgo } from '../dom';
import { markdown } from '../markdown';
import type { NoteAction, PhoneNote } from './notes';

export interface RowActions extends ChatterActions {
  openThread(key: string): void;
  /** A worker's Chat view (its transcript as a conversation). */
  openChat(workerId: string): void;
  /** A notification's button. */
  act(note: PhoneNote, a: NoteAction): void;
  /** A floor's name, for the All projects channel. */
  floorName(id: string): string;
}

const clock = (at: number) => new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

const time = (at: number) => h('time.tp-time', { datetime: new Date(at).toISOString(), 'data-at': String(at), title: `${new Date(at).toLocaleString()} (${timeAgo(at)})` }, clock(at));

function toLabel(t: ChatterTo): string {
  if (isGroup(t)) return t.group === 'pm' ? 'to you' : 'to the team';
  return t.kind === 'human' ? 'to you' : `to ${t.name}`;
}

/** The worker a message is from or about, when it's on this floor: for Open terminal and Open Chat view. */
function workerOf(m: ChatterMessage): string | undefined {
  const here = (p: ChatterMessage['from'] | ChatterTo) => (!isGroup(p) && p.kind === 'agent' && p.workerId && store.workers.has(p.workerId) ? p.workerId : undefined);
  if (m.ref?.worker && store.workers.has(m.ref.worker)) return m.ref.worker;
  return m.kind === 'message' ? here(m.from) : undefined;
}

/** What the words open, like the Command Center's bubbles did: the escalation, the PR, the journal, the standup. */
function opener(m: ChatterMessage, act: RowActions): { label: string; go: () => void } | undefined {
  const r = m.ref ?? {};
  if (r.pr) return { label: `Open PR #${r.pr}`, go: () => act.openPull(r.pr!) };
  if (r.journal) {
    const i = r.journal.indexOf('#');
    return { label: 'Read the journal entry', go: () => act.openJournal(r.journal!.slice(0, i < 0 ? undefined : i), i < 0 ? '' : r.journal!.slice(i + 1)) };
  }
  if (r.standup) return { label: 'Open the standup', go: () => act.openStandup() };
  if (r.engagement) return { label: 'Open The Firm', go: () => location.assign('/firm') };
  return undefined;
}

export interface RowOpts {
  /** Under the one before, by the same speaker a moment later: no face or name again. */
  follow?: boolean;
  /** The All projects channel: which floor it's from. */
  floor?: boolean;
  /** Shown as a thread's root, with its reply count. */
  thread?: ThreadView;
}

export function messageRow(m: ChatterMessage, act: RowActions, o: RowOpts = {}): HTMLElement {
  const words = m.kind === 'message' ? markdown(m.text) : h('p.tp-plain', {}, m.text);
  words.classList.add('tp-words');
  const open = opener(m, act);
  const wid = workerOf(m);
  const links: (HTMLElement | null)[] = [];
  if (open) links.push(h('button.tp-link', { type: 'button', onclick: open.go }, open.label));
  if (wid) {
    links.push(h('button.tp-link', { type: 'button', onclick: () => act.openWorker(wid) }, 'Open terminal'));
    links.push(h('button.tp-link', { type: 'button', onclick: () => act.openChat(wid) }, 'Open Chat view'));
  }
  const t = o.thread;
  const replies = t && t.replies.length ? h('button.tp-replies', { type: 'button', onclick: () => act.openThread(t.key), 'aria-label': `${t.replies.length} repl${t.replies.length === 1 ? 'y' : 'ies'}: open the thread` }, `${t.replies.length} repl${t.replies.length === 1 ? 'y' : 'ies'}`, h('span.tp-dim', {}, ` · last ${timeAgo(t.last)}`)) : null;
  const threadable = t && !replies && (m.ref?.escalationId || m.ref?.thread) ? h('button.tp-link', { type: 'button', onclick: () => act.openThread(t.key) }, 'Reply in thread') : null;
  return h(
    'li.tp-msg',
    { class: `tp-by-${m.from.kind} tp-k-${m.kind}${o.follow ? ' tp-follow' : ''}`, 'data-id': m.id },
    o.follow ? h('span.tp-gutter', {}, time(m.at)) : h('figure.tp-face', { title: m.from.role ? `${m.from.name}, ${m.from.role}` : m.from.name }, avatar(m.from, 32)),
    h(
      'div.tp-main',
      {},
      o.follow
        ? null
        : h(
            'div.tp-line',
            {},
            h('b.tp-name', {}, m.from.name),
            m.from.kind === 'human' ? h('span.tp-you', {}, 'you') : m.from.role ? h('small.tp-role', {}, m.from.role) : null,
            h('span.tp-to', { title: CHATTER_WORD[m.kind] }, toLabel(m.to)),
            o.floor ? h('span.tp-floor', {}, `#${act.floorName(m.floor)}`) : null,
            time(m.at),
          ),
      words,
      links.length || replies || threadable ? h('div.tp-acts', {}, replies, threadable, ...links) : null,
    ),
  );
}

/** A notification: Jeff or the office telling you something needs you, with what to press. */
export function noteRow(n: PhoneNote, act: RowActions): HTMLElement {
  const face = n.voice === 'jeff' ? avatar({ name: 'Jeff', kind: 'jeff', role: 'Router' }, 32) : avatar({ name: 'The office', kind: 'office' }, 32);
  return h(
    'li.tp-msg.tp-note',
    { class: `tp-note-${n.level} tp-note-${n.kind}`, 'data-key': n.key },
    h('figure.tp-face', {}, face),
    h(
      'div.tp-main',
      {},
      h('div.tp-line', {}, h('b.tp-name', {}, n.who), h('small.tp-role', {}, n.voice === 'jeff' ? 'Router' : 'needs you'), n.tag ? h('span.tp-tag', {}, n.tag) : null, n.since ? time(n.since) : null),
      h('p.tp-plain.tp-words', {}, n.text),
      h(
        'div.tp-acts.tp-note-acts',
        {},
        ...n.actions.map((a) => h(`button.btn.small.tp-act.tp-act-${a.do}`, { type: 'button', onclick: () => act.act(n, a) }, a.label)),
      ),
    ),
  );
}

/** "Hedy is working…": who's mid-turn in what's shown, and whose reply is on its way. */
export function typingRow(lines: string[]): HTMLElement | null {
  if (!lines.length) return null;
  return h('li.tp-typing', { role: 'status' }, h('span.tp-dots', { 'aria-hidden': 'true' }, h('i'), h('i'), h('i')), lines.join(' · '));
}

/** A day line between messages of different days. */
export const dayRow = (at: number) => h('li.tp-day', {}, h('span', {}, new Date(at).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' })));

/** Whether two times are on the same day (local). */
export function sameDay(a: number, b: number) {
  const x = new Date(a);
  const y = new Date(b);
  return x.getFullYear() === y.getFullYear() && x.getMonth() === y.getMonth() && x.getDate() === y.getDate();
}

/** Whether `m` follows `prev` closely enough to go under it without the face and name again. */
export const follows = (prev: ChatterMessage | undefined, m: ChatterMessage) => !!prev && prev.from.name === m.from.name && prev.from.kind === m.from.kind && m.at - prev.at < 5 * 60_000 && sameDay(prev.at, m.at);
