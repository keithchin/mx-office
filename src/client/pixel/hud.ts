// The 2D view's HUD pieces (pixel.ts): a worker's little menu (its terminal, its changes, a prompt,
// sending it home), the chat in the corner, and the hover card. They're game-style panels: chunky
// pixel frames, buttons that press down (see pixel/game.css).

import type { Net } from '../net';
import { store } from '../state';
import { h, modalOpen } from '../ui/dom';
import { isAsleep } from '../../shared/status';
import { DESK_BY_ID } from '../../shared/layout';
import type { WorkerActions } from '../shared/workers';

// ---- A worker's menu ---------------------------------------------------------------------------------
let menu: HTMLElement | null = null;

export function closeMenu() {
  menu?.remove();
  menu = null;
}

/** The menu for worker `id`, at (x, y) in `host`: each item a pressable button, the arrows and Esc to get about it. */
export function openWorkerMenu(host: HTMLElement, id: string, x: number, y: number, actions: WorkerActions) {
  closeMenu();
  const w = store.workers.get(id);
  if (!w) return;
  const station = DESK_BY_ID.get(w.deskId)?.station;
  const item = (label: string, run: () => void, hint?: string) =>
    h('button.px-btn.px-menu-item', { type: 'button', role: 'menuitem', onclick: () => (closeMenu(), run()) }, label, hint ? h('kbd', {}, hint) : null);
  const items = [
    item('⌨️ Terminal', () => actions.open(id), 'Click'),
    w.worktree ? item('📝 Changes', () => actions.changes(id)) : null,
    station ? item('💬 Ask', () => actions.askStation(station, w.deskId)) : !isAsleep(w.status) && w.status !== 'needs_input' && !w.lost ? item('✍️ Prompt', () => actions.prompt(id)) : null,
    item('🏠 Send home', () => actions.home(id)),
  ].filter((x): x is HTMLButtonElement => !!x);
  menu = h('div.px-panel.px-menu', { role: 'menu', 'aria-label': `${w.name}` }, h('div.px-menu-title', {}, w.name), ...items);
  host.append(menu);
  const r = host.getBoundingClientRect();
  menu.style.left = `${Math.min(x, r.width - menu.offsetWidth - 8)}px`;
  menu.style.top = `${Math.min(y, r.height - menu.offsetHeight - 8)}px`;
  items[0].focus();
  menu.addEventListener('keydown', (e) => {
    const i = items.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      items[(i + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length].focus();
    } else if (e.key === 'Escape') {
      e.stopPropagation();
      closeMenu();
    }
  });
}

// Anywhere else clicked, or the window losing focus: the menu goes.
addEventListener('pointerdown', (e) => {
  if (menu && !menu.contains(e.target as Node)) closeMenu();
});

// ---- Chat ----------------------------------------------------------------------------------------------
/**
 * The chat in the corner: the building's latest lines, and a box to say something. T opens it, Enter sends, Esc puts it away.
 */
export function mountChat(host: HTMLElement, net: Net) {
  const log = h('ol.px-chat-log', { 'aria-live': 'polite' });
  const input = h('input.px-chat-input', { type: 'text', maxlength: 300, placeholder: 'Say something to everyone…', 'aria-label': 'Chat' }) as HTMLInputElement;
  const toggle = h('button.px-btn.px-chat-toggle', { type: 'button', title: 'Chat (T)', 'aria-label': 'Chat' }, '💬 Chat', h('kbd', {}, 'T'));
  const panel = h('div.px-panel.px-chat.hidden', {}, log, input);
  host.append(panel, toggle);
  const render = () => {
    log.replaceChildren(...store.chat.slice(-8).map((c) => h('li', {}, h('b', { style: `color:${c.color}` }, c.name), ': ', c.text)));
    log.scrollTop = log.scrollHeight;
  };
  const open = (on: boolean) => {
    panel.classList.toggle('hidden', !on);
    toggle.classList.toggle('on', on);
    if (on) {
      render();
      setTimeout(() => input.focus(), 0);
    } else input.blur();
  };
  toggle.addEventListener('click', () => open(panel.classList.contains('hidden')));
  input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Escape') return open(false);
    if (e.key !== 'Enter' || e.isComposing) return;
    const text = input.value.trim();
    if (text) net.send({ t: 'chat', text });
    input.value = '';
  });
  store.on('chat', () => {
    if (!panel.classList.contains('hidden')) render();
    // A new line while it's put away: the button says so.
    else toggle.classList.add('news');
  });
  toggle.addEventListener('click', () => toggle.classList.remove('news'));
  return { open: () => open(true), get typing() { return document.activeElement === input; } };
}

/** Whether a key press is for the office: not while typing somewhere, or with a window open. */
export function officeKeys(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null;
  if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return false;
  // The team phone (ui/phone/) keeps its own keys.
  if (t?.closest?.('.tp-win')) return false;
  return !modalOpen() && !e.altKey && !e.metaKey;
}
