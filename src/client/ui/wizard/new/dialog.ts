// The New project flow's dialogs (add files, approve with assumptions, add a user role) and its side panel:
// a ✕ top-right, Esc closes the top one, Tab stays inside a dialog, and closing gives focus back to where
// it was opened from, with no extra click (AGENTS.md). They live inside the flow's own layer.
import { h } from '../../dom';
import { icon } from './parts';

export interface Dialog {
  el: HTMLElement;
  close(): void;
}

const stack: { el: HTMLElement; close: () => void; trap: boolean }[] = [];

/** Esc for the flow: closes the top dialog, if there's one open (true when it did). */
export function closeTopDialog(): boolean {
  const top = stack[stack.length - 1];
  if (!top) return false;
  top.close();
  return true;
}

export const dialogOpen = () => stack.length > 0;

const FOCUSABLE = 'button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex="0"], a[href]';

/**
 * Opens `body` as a dialog (or, with `side`, a side panel that doesn't trap focus) in `host`, titled
 * `title`. `opener` gets focus back when it closes.
 */
export function openDialog(host: HTMLElement, title: string, body: HTMLElement | HTMLElement[], opts: { opener?: HTMLElement | null; side?: boolean; onClose?: () => void; foot?: HTMLElement[]; titleId?: string } = {}): Dialog {
  const opener = opts.opener ?? (document.activeElement as HTMLElement | null);
  const titleId = opts.titleId ?? `nw-dlg-${Math.random().toString(36).slice(2, 8)}`;
  const x = h('button.nw-iconbtn.nw-x', { type: 'button', 'aria-label': 'Close' }, icon('x'));
  const parts = Array.isArray(body) ? body : [body];
  const box = h(
    opts.side ? 'aside.nw-side' : 'div.nw-modal',
    { role: 'dialog', 'aria-modal': opts.side ? 'false' : 'true', 'aria-labelledby': titleId },
    h('div.nw-dlg-h', {}, h('h2', { id: titleId }, title), x),
    h('div.nw-dlg-b', {}, ...parts),
    opts.foot?.length ? h('div.nw-dlg-f', {}, ...opts.foot) : null,
  );
  const el = opts.side ? box : h('div.nw-overlay', {}, box);
  let closed = false;
  const entry = {
    el,
    trap: !opts.side,
    close: () => {
      if (closed) return;
      closed = true;
      el.classList.remove('show');
      const i = stack.indexOf(entry);
      if (i >= 0) stack.splice(i, 1);
      setTimeout(() => el.remove(), 180);
      opts.onClose?.();
      if (opener && document.contains(opener)) opener.focus();
    },
  };
  x.addEventListener('click', entry.close);
  if (!opts.side) el.addEventListener('mousedown', (e) => e.target === el && entry.close());
  el.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab' || !entry.trap) return;
    const f = [...box.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((n) => n.offsetParent !== null);
    if (!f.length) return;
    if (e.shiftKey && document.activeElement === f[0]) (e.preventDefault(), f[f.length - 1].focus());
    else if (!e.shiftKey && document.activeElement === f[f.length - 1]) (e.preventDefault(), f[0].focus());
  });
  host.append(el);
  stack.push(entry);
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => (box.querySelector<HTMLElement>('[autofocus], input, textarea, .nw-drop') ?? x).focus(), 20);
  return { el: box, close: entry.close };
}

/** Closes every dialog (the flow is closing). */
export function closeAllDialogs() {
  while (stack.length) stack[stack.length - 1].close();
}
