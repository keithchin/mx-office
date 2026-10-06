// The phone version's lists: the projects (each floor's channel, with what needs you and what's unread)
// and the DMs (the floor's agents, what each is doing, its terminal read-only), and `swap`, which only
// redraws what changed.

import { badgeOf } from '../../shared/phone';
import { avatar } from '../ui/chatter/message';
import { h } from '../ui/dom';
import type { PhoneModel } from '../ui/phone/screens';

function badge(red: number, unread: number): HTMLElement | null {
  const b = badgeOf(red, unread);
  if (b.kind === 'none') return null;
  return b.kind === 'count' ? h('span.m-count.m-red', { 'aria-label': `${b.n} need you` }, String(b.n)) : h('span.m-count.m-grey', { 'aria-label': 'unread' });
}

export function floorList(m: PhoneModel, open: (floor: string) => void): HTMLElement {
  const floors = m.floors.filter((f) => !f.cloning);
  if (!floors.length) return h('p.m-empty', {}, 'No projects yet.');
  return h(
    'ul.m-list',
    { 'aria-label': 'Projects' },
    ...floors.map((f) => {
      const red = f.id === m.floor ? m.notes.filter((n) => n.kind !== 'floor').length : f.waiting;
      return h(
        'li',
        {},
        h('button.m-item', { type: 'button', 'data-floor': f.id, onclick: () => open(f.id) }, h('span.m-item-ico', { 'aria-hidden': 'true' }, '#'), h('span.m-item-main', {}, h('b', {}, f.name), h('small.m-dim', {}, f.id === m.floor ? 'You’re here' : f.waiting ? `${f.waiting} waiting` : f.repo ?? '')), badge(red, m.unreadFloor(f.id))),
      );
    }),
  );
}

const DOING: Record<string, string> = { working: 'working…', starting: 'starting…', needs_input: 'asking you', done: 'finished its turn', idle: 'idle', exited: 'asleep', offline: 'asleep' };

export function agentList(m: PhoneModel, open: (workerId: string) => void, terminal: (workerId: string) => void): HTMLElement {
  if (!m.agents.length) return h('p.m-empty', {}, 'No agents on this floor yet.');
  return h(
    'ul.m-list',
    { 'aria-label': 'Direct messages' },
    ...m.agents.map((a) =>
      h(
        'li.m-agent',
        {},
        h(
          'button.m-item',
          { type: 'button', 'data-worker': a.workerId, onclick: () => open(a.workerId) },
          h('span.m-face', { class: `tp-st-${a.status}` }, avatar({ name: a.name, kind: 'agent', workerId: a.workerId, ...(a.role ? { roleId: a.role } : {}) }, 30)),
          h('span.m-item-main', {}, h('b', {}, a.name, a.role === 'pm' ? h('small.m-dim', {}, ' · Coordinator') : a.role ? h('small.m-dim', {}, ' · Lead') : null), h('small.m-dim', { class: a.status === 'needs_input' ? 'm-ask' : '' }, DOING[a.status] ?? a.status)),
          badge(0, m.unreadDm(a.workerId)),
        ),
        h('button.m-hbtn.m-term', { type: 'button', 'aria-label': `${a.name}'s terminal, read-only`, title: 'Terminal (read-only)', onclick: () => terminal(a.workerId) }, '🖥️'),
      ),
    ),
  );
}

const drawn = new WeakMap<HTMLElement, string>();

/** Puts `children` in `el` only when they differ from what's there. True when it did. */
export function swap(el: HTMLElement, children: HTMLElement[]): boolean {
  const sig = children.map((c) => c.outerHTML).join('');
  if (drawn.get(el) === sig) return false;
  drawn.set(el, sig);
  el.replaceChildren(...children);
  return true;
}
