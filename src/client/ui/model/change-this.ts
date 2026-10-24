// "Change this" (shared/model-change.ts): the compact dialog the Model tab opens for the element(s) you
// picked. It says what's selected (qualified name and kind) and the branch and commit it was read at,
// asks "What should change?" (with quick chips per kind), who it goes to (whoever covers Development, or
// Design for a page's look, from the team's coverage; any hired member in the drop-down) and when (after
// their current turn, the default, or now). Send makes the change request: the office hands it to that
// member as a task (POST /api/model/change-request). ✕ and Esc close it and give focus back to the element.

import { chipsFor, defaultMember, KIND_WORD, type ChangeElement, type ChangeRequestView, type ChangeWhen } from '../../../shared/model-change';
import type { RoleId } from '../../../shared/roster/roles';
import type { MemberView, RosterView } from '../../../shared/roster/types';
import { store } from '../../state';
import { h, openModal, toast } from '../dom';
import { coverageOf } from '../roster/coverage';
import { fetchRoster } from '../roster/api';
import './change.css';

export const changeApi = {
  async list(floor: string, signal?: AbortSignal): Promise<ChangeRequestView[]> {
    const res = await fetch(`/api/model/change-requests?floor=${encodeURIComponent(floor)}`, { credentials: 'same-origin', signal });
    if (!res.ok) throw new Error(`${res.status}`);
    return ((await res.json()) as { requests: ChangeRequestView[] }).requests ?? [];
  },
  /** The request as kept, with the request id it's linked as (DC-n, its alias MCR-n) when the office made one. */
  async create(body: Record<string, unknown>): Promise<ChangeRequestView & { linked?: string }> {
    const res = await fetch('/api/model/change-request', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const out = (await res.json().catch(() => ({}))) as { request?: ChangeRequestView; change?: string; error?: string };
    if (!res.ok || !out.request) throw new Error(out.error ?? `${res.status} ${res.statusText}`);
    return { ...out.request, ...(out.change ? { linked: out.change } : {}) };
  },
};

export interface ChangeAskOpts {
  floor: string;
  ref: string;
  sha?: string;
  elements: ChangeElement[];
  /** Where focus goes back to when it closes (the element's button, row or the drawing). */
  back: () => void;
  sent?: (r: ChangeRequestView) => void;
}

/** The members a change can go to: hired and at work (asleep ones wake for it). */
export const hiredMembers = (v: RosterView | undefined): MemberView[] => (v?.members ?? []).filter((m) => !!m.workerId && m.status !== 'not-hired' && m.status !== 'benched' && m.status !== 'benching');

/** What a chip starts the text with, when it's more than the chip's words. */
const CHIP_START: Record<string, string> = { Rename: 'Rename to ', 'Add value': 'Add a value ', 'Change default': 'Change the default to ', 'Change type': 'Change the type to ', 'Change caption': 'Change the caption to ' };

const STATE: Partial<Record<MemberView['status'], string>> = { working: 'is working', 'needs-you': 'is waiting on an answer', idle: 'is ready', asleep: 'is asleep (it wakes for this)' };

export function openChangeThis(o: ChangeAskOpts): void {
  let roster: RosterView | undefined;
  let chosen: RoleId | undefined;
  let byHand = false;
  let when: ChangeWhen = 'after';
  const text = h('textarea.mxc-text', { rows: 3, placeholder: 'For example: add a Cancelled value, rename to RequestDate, make it required', 'aria-label': 'What should change?' }) as HTMLTextAreaElement;
  const who = h('select.mxc-who', { 'aria-label': 'Who it goes to' }) as HTMLSelectElement;
  const whoNote = h('p.mxc-note', { role: 'status' }, 'Reading the team…');
  const status = h('p.mxc-status', { role: 'status' });
  const send = h('button.btn.primary.mxc-send', { type: 'button', disabled: true, onclick: () => void submit() }, 'Send');
  const whenBtn = (v: ChangeWhen, label: string) => h('button.btn.small.mxc-when', { type: 'button', role: 'radio', 'data-v': v, onclick: () => ((when = v), paint()) }, label);
  const whens = [whenBtn('after', 'After their current turn'), whenBtn('now', 'Now')];
  const chips = chipsFor(o.elements).map((c) =>
    h('button.btn.small.mxc-chip', { type: 'button', onclick: () => {
      const start = CHIP_START[c] ?? c.replace(/…$/, ' ');
      text.value = text.value.trim() ? `${text.value.trim()}\n${start}` : start;
      text.focus();
      text.setSelectionRange(text.value.length, text.value.length);
      route();
    } }, c),
  );
  const sha = o.sha ? o.sha.slice(0, 7) : 'unknown commit';
  const content = h(
    'div.modal.mxc',
    { role: 'dialog', 'aria-label': 'Change this' },
    h('header', {}, h('h2', {}, o.elements.length > 1 ? `Change these ${o.elements.length}` : 'Change this')),
    h(
      'div.body',
      {},
      h('ul.mxc-els', {}, ...o.elements.map((e) => h('li', {}, h('code', {}, e.qn), h('span.mxc-kind', {}, KIND_WORD[e.kind])))),
      h('p.mxc-at', { title: o.sha ?? '' }, 'Read at ', h('b', {}, o.ref), ` @ ${sha}`),
      h('label.mxc-label', {}, 'What should change?'),
      text,
      chips.length ? h('div.mxc-chips', { role: 'group', 'aria-label': 'Quick changes' }, ...chips) : null,
      h('div.mxc-row', {}, h('label.mxc-label', {}, 'Goes to'), who),
      whoNote,
      h('div.mxc-row', {}, h('span.mxc-label', {}, 'When'), h('div.mxc-whens', { role: 'radiogroup', 'aria-label': 'When it goes in' }, ...whens)),
      status,
    ),
    h('footer', {}, h('button.btn.mxc-cancel', { type: 'button', onclick: () => modal.close() }, 'Cancel'), send),
  );

  function paint() {
    for (const b of whens) {
      const on = b.dataset.v === when;
      b.setAttribute('aria-checked', String(on));
      b.classList.toggle('on', on);
    }
    const m = roster?.members.find((x) => x.role === chosen);
    if (!roster) return;
    if (!m) {
      whoNote.textContent = 'Nobody on the team is at work: hire someone on the Team tab first.';
      send.disabled = true;
      return;
    }
    const busy = m.status === 'working' || m.status === 'needs-you';
    const goes = busy ? (when === 'after' ? 'it goes in when that turn ends' : 'it goes into the turn now') : 'it goes in now';
    whoNote.textContent = `${m.name} ${STATE[m.status] ?? `is ${m.status}`}${m.status === 'working' && m.task ? ` on ${m.task}` : ''}: ${goes}.`;
    send.disabled = false;
  }

  /** The default member for what's typed so far, unless one was picked by hand. */
  function route() {
    if (!roster || byHand) return paint();
    const hired = hiredMembers(roster).map((m) => m.role);
    chosen = defaultMember(coverageOf(roster), o.elements, text.value, hired);
    if (chosen) who.value = chosen;
    paint();
  }

  who.addEventListener('change', () => {
    chosen = who.value as RoleId;
    byHand = true;
    paint();
  });
  text.addEventListener('input', () => route());
  text.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) void submit();
  });

  async function submit() {
    const request = text.value.trim();
    if (!request) {
      status.textContent = 'Say what should change first.';
      return text.focus();
    }
    if (!chosen) return;
    send.disabled = true;
    status.textContent = 'Sending…';
    try {
      const r = await changeApi.create({ floor: o.floor, elements: o.elements, ref: o.ref, sha: o.sha, request, role: chosen, when, by: store.me.account?.name ?? store.profile.name });
      toast(`✎ ${r.member} has the change request ${r.id}${r.linked ? ` (request ${r.linked})` : ''}${r.delivery === 'held' ? ' (after their current turn)' : ''}`);
      modal.close();
      o.sent?.(r);
    } catch (err) {
      send.disabled = false;
      status.textContent = `Not sent: ${(err as Error).message}`;
    }
  }

  const modal = openModal(content, { onClose: () => o.back() });
  paint();
  setTimeout(() => text.focus(), 0);
  fetchRoster(o.floor).then(
    (v) => {
      roster = v;
      const coverage = coverageOf(v);
      const hired = hiredMembers(v);
      who.replaceChildren(
        ...hired.map((m) => {
          const covers = (Object.keys(coverage) as (keyof typeof coverage)[]).filter((t) => coverage[t] === m.role);
          return h('option', { value: m.role }, `${m.icon} ${m.name} (${m.title})${covers.length ? ` · covers ${covers.map((t) => t[0].toUpperCase() + t.slice(1)).join(', ')}` : ''}`);
        }),
      );
      route();
    },
    (err) => {
      whoNote.textContent = `Couldn't read the team: ${(err as Error).message}`;
    },
  );
}
