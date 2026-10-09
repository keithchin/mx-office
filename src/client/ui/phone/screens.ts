// The team phone's screens, drawn from what the phone knows (PhoneModel): the channel list (Needs you
// pinned on top, All projects, a channel per floor, DMs with the floor's agents), a project channel
// with its threads and its notifications, All projects, a DM, a thread, and the Needs you section.

import { isGroup, matchesFilter, type ChatterFilter, type ChatterMessage, type ChatterParty } from '../../../shared/chatter';
import { badgeOf, channelView, dmMessages, type PhoneAgent, type ThreadView } from '../../../shared/phone';
import type { FloorInfo, WorkerStatus } from '../../../shared/protocol';
import type { Escalation } from '../../../shared/roster/escalation';
import type { TeamId } from '../../../shared/roster/roles';
import { ZONE_BY_TEAM } from '../../../shared/zones';
import { inTeam } from '../chatter/compact';
import { avatar } from '../chatter/message';
import { h } from '../dom';
import type { PendingReply } from './api';
import type { PhoneNote } from './notes';
import { dayRow, follows, messageRow, noteRow, sameDay, typingRow, type RowActions } from './rows';
import { newest, STREAM_CAP } from './cap';
export { STREAM_CAP } from './cap';

export type Screen = { s: 'home' } | { s: 'needs' } | { s: 'all' } | { s: 'floor'; floor: string } | { s: 'dm'; workerId: string } | { s: 'thread'; floor: string; key: string; back: Screen };

export interface PhoneAgentView extends PhoneAgent {
  status: WorkerStatus;
  color: string;
  title?: string;
}

export interface PhoneModel {
  floor?: string;
  floors: readonly FloorInfo[];
  agents: PhoneAgentView[];
  /** This floor's notifications, and the other floors where someone waits. */
  notes: PhoneNote[];
  red: number;
  pending: PendingReply[];
  escalations: Map<string, Escalation>;
  /** A floor's messages so far (newest first), and whether there are older ones. */
  feed(floor: string): { list: readonly ChatterMessage[]; loaded: boolean; more: boolean; error?: string };
  unreadFloor(floor: string): number;
  unreadDm(workerId: string): number;
  filter: ChatterFilter;
  team?: TeamId;
  /** How many of the newest messages a log draws (STREAM_CAP at first; Load older adds more). */
  limit?: number;
}

const WORKING = new Set<WorkerStatus>(['working', 'starting']);
const name = (m: PhoneModel, id: string) => m.floors.find((f) => f.id === id)?.name ?? id;

function count(b: ReturnType<typeof badgeOf>, label: string): HTMLElement | null {
  if (b.kind === 'none') return null;
  return b.kind === 'count' ? h('span.tp-count.tp-red', { 'aria-label': `${b.n} ${label}` }, String(b.n)) : h('span.tp-count.tp-dot', { 'aria-label': 'unread' });
}

/** The channel list. `on` is what's open (in the wide window, beside it). */
export function homeList(m: PhoneModel, on: Screen, go: (s: Screen) => void): HTMLElement {
  const isOn = (s: Screen) => JSON.stringify(s) === JSON.stringify(on);
  const chan = (s: Screen, key: string, label: (HTMLElement | string | null)[], b: HTMLElement | null, title?: string) =>
    h('li', {}, h('button.tp-chan', { type: 'button', 'data-chan': key, 'aria-current': isOn(s) ? 'true' : undefined, title, onclick: () => go(s) }, ...label, b));
  const floors = m.floors.filter((f) => !f.cloning);
  const allUnread = floors.reduce((n, f) => n + m.unreadFloor(f.id), 0);
  return h(
    'nav.tp-list',
    { 'aria-label': 'Channels' },
    h(
      'ul.tp-chans',
      {},
      chan({ s: 'needs' }, 'needs', [h('span.tp-chan-ico.tp-needs-ico', { 'aria-hidden': 'true' }, '!'), h('span.tp-chan-name', {}, 'Needs you')], count(badgeOf(m.red, 0), 'need you'), 'Everything waiting on you, with what to press'),
      chan({ s: 'all' }, 'all', [h('span.tp-chan-ico', { 'aria-hidden': 'true' }, '∗'), h('span.tp-chan-name', {}, 'All projects')], count(badgeOf(0, allUnread), 'unread'), 'Every floor’s chatter in one stream'),
    ),
    h('h3.tp-sect', {}, 'Channels'),
    h(
      'ul.tp-chans',
      {},
      ...floors.map((f) => {
        const red = f.id === m.floor ? m.notes.filter((n) => n.kind !== 'floor').length : f.waiting;
        return chan({ s: 'floor', floor: f.id }, `floor:${f.id}`, [h('span.tp-chan-ico', { 'aria-hidden': 'true' }, '#'), h('span.tp-chan-name', {}, f.name)], count(badgeOf(red, m.unreadFloor(f.id)), 'need you'));
      }),
    ),
    h('h3.tp-sect', {}, `Direct messages${m.floor ? ` · ${name(m, m.floor)}` : ''}`),
    m.agents.length
      ? h(
          'ul.tp-chans',
          {},
          ...m.agents.map((a) =>
            chan(
              { s: 'dm', workerId: a.workerId },
              `dm:${a.workerId}`,
              [
                h('span.tp-dm-face', { class: `tp-st-${a.status}` }, avatar({ name: a.name, kind: 'agent', workerId: a.workerId, ...(a.role ? { roleId: a.role } : {}) }, 22)),
                h('span.tp-chan-name', {}, a.name, h('small.tp-dim', {}, WORKING.has(a.status) ? ' working…' : a.status === 'needs_input' ? ' asking you' : a.role === 'pm' ? ' Coordinator' : a.role ? ' Lead' : '')),
              ],
              count(badgeOf(0, m.unreadDm(a.workerId)), 'unread'),
            ),
          ),
        )
      : h('p.tp-dim.tp-pad', {}, 'No agents on this floor yet.'),
  );
}

/** Messages and notifications in time order, with day lines and same-speaker rows folded together. */
function stream(items: ({ at: number; el: (follow: boolean) => HTMLElement; m?: ChatterMessage })[], limit = STREAM_CAP): HTMLElement[] {
  const out: HTMLElement[] = [];
  let prev: ChatterMessage | undefined;
  let last: number | undefined;
  for (const it of newest(items, limit)) {
    if (last === undefined || !sameDay(last, it.at)) {
      out.push(dayRow(it.at));
      prev = undefined;
    }
    out.push(it.el(!!it.m && follows(prev, it.m)));
    prev = it.m;
    last = it.at;
  }
  return out;
}


const keep = (m: PhoneModel) => (x: ChatterMessage) => matchesFilter(x, m.filter) && (!m.team || inTeam(x, m.team));

/** Who's mid-turn among `ids`, and whose reply to you is on its way. */
export function typingLines(m: PhoneModel, ids: readonly string[] | 'all', thread?: string): string[] {
  const lines: string[] = [];
  const waiting = m.pending.filter((p) => (thread ? p.thread === thread : true) && (ids === 'all' || ids.includes(p.workerId)));
  for (const p of waiting) {
    const a = m.agents.find((x) => x.workerId === p.workerId);
    if (!a) continue;
    lines.push(WORKING.has(a.status) ? `${a.name} is working on your message…` : a.status === 'needs_input' ? `${a.name} is asking something in its terminal first` : `${a.name} has your message: it's read once its turn is over`);
  }
  const busy = m.agents.filter((a) => WORKING.has(a.status) && (ids === 'all' || ids.includes(a.workerId)) && !waiting.some((p) => p.workerId === a.workerId));
  if (busy.length) lines.push(`${busy.map((a) => a.name).join(', ')} ${busy.length === 1 ? 'is' : 'are'} working…`);
  return lines;
}

/** A project channel: its chatter, threads folded under their roots, and (on your floor) its notifications. */
export function channelLog(m: PhoneModel, floor: string, act: RowActions): HTMLElement[] {
  const got = m.feed(floor);
  const shown = got.list.filter(keep(m));
  const threads = channelView(shown);
  const items: { at: number; el: (f: boolean) => HTMLElement; m?: ChatterMessage }[] = threads.map((t: ThreadView) => ({ at: t.root.at, m: t.replies.length ? undefined : t.root, el: (f: boolean) => messageRow(t.root, act, { thread: t, follow: f && !t.replies.length }) }));
  if (floor === m.floor && m.filter.with === 'all' && !m.team) for (const n of m.notes.filter((x) => x.kind !== 'floor')) items.push({ at: n.since ?? Date.now(), el: () => noteRow(n, act) });
  const out = stream(items, m.limit);
  if (!out.length) out.push(h('li.tp-empty', {}, !got.loaded ? 'Loading…' : got.error ? `Couldn't load the chatter: ${got.error}` : m.filter.with === 'all' && !m.team ? 'Nobody has said anything yet. Escalations, relays, journal entries and your messages show up here.' : 'Nothing like that yet.'));
  const typing = floor === m.floor ? typingRow(typingLines(m, 'all')) : null;
  if (typing) out.push(typing);
  return out;
}

/** Every floor's chatter as one stream, each message tagged with its floor. */
export function allLog(m: PhoneModel, act: RowActions): HTMLElement[] {
  const items: { at: number; el: (f: boolean) => HTMLElement; m?: ChatterMessage }[] = [];
  for (const f of m.floors.filter((x) => !x.cloning)) {
    for (const t of channelView(m.feed(f.id).list.filter(keep(m)))) items.push({ at: t.root.at, el: () => messageRow(t.root, act, { thread: t, floor: true }) });
  }
  const out = stream(items);
  return out.length ? out : [h('li.tp-empty', {}, 'Nothing on any floor yet.')];
}

export function dmLog(m: PhoneModel, workerId: string, act: RowActions): HTMLElement[] {
  const list = m.floor ? dmMessages(m.feed(m.floor).list, workerId) : [];
  const out = stream(list.map((x) => ({ at: x.at, m: x, el: (f: boolean) => messageRow(x, act, { follow: f }) })), m.limit);
  const a = m.agents.find((x) => x.workerId === workerId);
  if (!out.length) out.push(h('li.tp-empty', {}, `This is the start of your messages with ${a?.name ?? 'this agent'}. What you send goes to it once its current turn is over, and its reply comes back here.`));
  const typing = typingRow(typingLines(m, [workerId]));
  if (typing) out.push(typing);
  return out;
}

/** A thread: its root, every reply, and for an open escalation its Approve and Reject. */
export function threadLog(m: PhoneModel, floor: string, key: string, act: RowActions, answer: (id: string, verdict: 'approve' | 'reject') => void): HTMLElement[] {
  const t = channelView(m.feed(floor).list).find((x) => x.key === key);
  if (!t) return [h('li.tp-empty', {}, 'That thread is not in the messages loaded here.')];
  const out = stream([t.root, ...t.replies].map((x) => ({ at: x.at, m: x, el: (f: boolean) => messageRow(x, act, { follow: f }) })));
  const esc = key.startsWith('esc:') ? m.escalations.get(key.slice(4)) : undefined;
  if (esc?.status === 'open') {
    out.push(
      h(
        'li.tp-esc-bar',
        {},
        h('span.tp-dim', {}, `Open escalation from ${esc.by}${esc.recommendation ? ` · recommends: ${esc.recommendation}` : ''}`),
        h('button.btn.small.tp-act-approve', { type: 'button', onclick: () => answer(esc.id, 'approve') }, 'Approve'),
        h('button.btn.small.tp-act-reject', { type: 'button', onclick: () => answer(esc.id, 'reject') }, 'Reject'),
      ),
    );
  } else if (esc?.resolution) out.push(h('li.tp-dim.tp-esc-done', {}, `Answered by ${esc.resolution.by}`));
  const ids = [...new Set([t.root, ...t.replies].flatMap((x) => [x.from, x.to]).filter((p): p is ChatterParty => !isGroup(p) && !!p.workerId).map((p) => p.workerId!))];
  const typing = floor === m.floor ? typingRow(typingLines(m, ids, key)) : null;
  if (typing) out.push(typing);
  return out;
}

/** The pinned Needs you section: every item, most urgent first, and the other floors where someone waits. */
export function needsLog(m: PhoneModel, act: RowActions): HTMLElement[] {
  if (!m.notes.length) return [h('li.tp-empty.tp-calm', {}, 'Nothing needs you right now.')];
  return m.notes.map((n) => noteRow(n, act));
}

/** The filter chips over a channel: All, Between agents, With me, one person, and a team when one was picked. */
export function filterChips(m: PhoneModel, floor: string, set: (f: ChatterFilter, team?: TeamId) => void): HTMLElement {
  const people = new Map<string, ChatterParty>();
  for (const x of m.feed(floor).list) for (const p of [x.from, x.to]) if (!isGroup(p) && p.kind !== 'office') people.set(`${p.kind}:${p.name}`, p);
  const pick = h(
    'select.tp-person',
    { 'aria-label': 'Only one person', onchange: (e: Event) => {
      const v = (e.target as HTMLSelectElement).value;
      const p = people.get(v);
      set(p ? { with: 'person', name: p.name, kind: p.kind } : { with: 'all' }, m.team);
    } },
    h('option', { value: '' }, 'Anyone'),
    ...[...people.entries()].sort((a, b) => a[1].name.localeCompare(b[1].name)).map(([k, p]) => h('option', { value: k, selected: m.filter.with === 'person' && m.filter.name === p.name && m.filter.kind === p.kind }, p.kind === 'human' ? `${p.name} (you)` : p.name)),
  );
  const chip = (w: 'all' | 'agents' | 'me', label: string) => h('button.tp-chip', { type: 'button', 'aria-pressed': String(m.filter.with === w), onclick: () => set({ with: w }, m.team) }, label);
  const team = m.team ? h('button.tp-chip.tp-team-chip', { type: 'button', 'aria-pressed': 'true', title: 'Show every team', style: `--tc:${ZONE_BY_TEAM.get(m.team)?.color ?? 'var(--accent)'}`, onclick: () => set(m.filter, undefined) }, `${m.team} ✕`) : null;
  return h('div.tp-chips', { role: 'group', 'aria-label': 'Show' }, chip('all', 'All'), chip('agents', 'Between agents'), chip('me', 'With me'), pick, team);
}
