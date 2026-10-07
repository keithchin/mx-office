// The floor's one run-state control (ui/project-run/index.ts says where it goes and what a click does):
// a dot and an icon for the state, its words, and for a run going a thin bar of its progress. An admin
// gets a button; everyone else the same state as a status they can hover. The emoji sit in an
// .ao-emo span the Clean themes hide, beside a line icon only they show (no emoji there).

import type { FloorToggle } from '../../home/run-state-logic';
import { ICONS } from '../clean/icons';
import { h } from '../dom';

/** Each control's latest click (for the state it was last drawn in). */
const clicks = new WeakMap<HTMLElement, () => void>();

const ICON_OF: Record<FloorToggle['kind'], string> = { running: 'play', paused: 'pause', pausing: 'hourglass', resuming: 'hourglass' };

function lineIcon(name: string): HTMLElement {
  const span = h('span.pr-tg-svg', { 'aria-hidden': 'true' });
  span.innerHTML = `<svg viewBox="0 0 16 16">${ICONS[name] ?? ''}</svg>`;
  return span;
}

/** An empty control, before the floor's state comes (hidden until then). */
export const toggleEl = (): HTMLElement => h('span.pr-toggle', { hidden: true });

/** Draws `t` into the control; it becomes a button for an admin (a status otherwise), so it may be replaced: use what comes back. */
export function drawToggle(el: HTMLElement, t: FloorToggle | undefined, click: () => void): HTMLElement {
  if (!t) {
    el.hidden = true;
    return el;
  }
  const tag = t.admin ? 'button' : 'span';
  let out = el;
  if (el.tagName.toLowerCase() !== tag) {
    out = t.admin ? h('button.pr-toggle', { type: 'button' }) : h('span.pr-toggle', { role: 'status' });
    const me = out;
    me.addEventListener('click', () => me.dataset.action && clicks.get(me)?.());
    el.replaceWith(out);
  }
  clicks.set(out, click);
  out.hidden = false;
  if (!t.admin) out.setAttribute('role', 'status');
  const key = `${t.kind}|${t.word}|${t.title}|${t.admin}`;
  if (out.dataset.key === key) return out;
  out.dataset.key = key;
  out.dataset.kind = t.kind;
  if (t.admin) out.dataset.action = t.action;
  out.title = t.title;
  out.setAttribute('aria-label', t.admin ? `${t.label}. ${t.action === 'pause' ? 'Pause project' : t.action === 'resume' ? 'Resume project' : 'Show its progress'}` : t.label);
  if (t.action === 'progress') out.setAttribute('aria-disabled', 'true');
  else out.removeAttribute('aria-disabled');
  const busy = t.action === 'progress';
  const m = /(\d+)\/(\d+)/.exec(t.word);
  const pct = busy && m && +m[2] ? Math.round((+m[1] / +m[2]) * 100) : 0;
  out.style.setProperty('--pr-pct', `${pct}%`);
  out.replaceChildren(
    h('span.pr-tg-dot', { 'aria-hidden': 'true' }),
    h('span.ao-emo.pr-tg-emo', { 'aria-hidden': 'true' }, t.icon),
    lineIcon(ICON_OF[t.kind]),
    h('span.pr-tg-word', {}, t.word),
    t.admin && !busy ? h('span.pr-tg-act', { 'aria-hidden': 'true' }, t.action === 'pause' ? 'Pause' : 'Resume') : '',
    busy ? h('span.pr-tg-bar', { 'aria-hidden': 'true' }) : '',
  );
  return out;
}
