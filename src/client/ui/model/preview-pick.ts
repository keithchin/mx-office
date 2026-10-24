// Select element: pointing at a widget on the Model preview. The preview stays in its sandboxed frame (its own
// opaque origin, nothing fetched); with picking available it also runs the small script below, allowed by a
// nonce made for each document (page-preview.ts previewDocument). The frame and the page talk only by
// postMessage:
//
//   page → frame   { mx: 'pick-cmd', on?: boolean, focus?: boolean, sel?: number | null, scroll?: boolean }
//                  checked in the frame: it comes from its parent, and has that shape
//   frame → page   { mx: 'pick', type: 'ready' | 'hover' | 'select' | 'leave', el?: number, w?: string }
//                  checked on the page (acceptPick): from this frame's window, an opaque origin ('null'), that
//                  shape, and an element the page drew itself (its index and name match the drawing's report)
//
// In the frame: hovering outlines a widget (every copy of it, in sample rows) with its plain label; a click
// selects it; Tab moves through the widgets (each once), Enter or Space selects, Esc leaves picking.
// Nothing is decided in the frame: the page keeps the selection and draws the chip (page-frame.ts).

import type { PreviewElement } from './page-preview';

/** The frame's side, as written into it (a function so it's type-checked and testable on a DOM; sent as its text). */
export function pickRuntime(win: Window = window): void {
  const doc = win.document;
  let on = false;
  let sel: string | null = null;
  const mk = (cls: string) => {
    const d = doc.createElement('div');
    d.className = cls;
    d.hidden = true;
    d.setAttribute('aria-hidden', 'true');
    doc.body.appendChild(d);
    return d;
  };
  const hoverLabel = mk('mx-pick-label');
  const selLabel = mk('mx-pick-label sel');
  const all = (key: string) => Array.from(doc.querySelectorAll<HTMLElement>(`[data-mx-el="${key}"]`));
  const post = (m: Record<string, unknown>) => win.parent.postMessage({ mx: 'pick', ...m }, '*');
  const place = (lab: HTMLElement, el: HTMLElement, text: string) => {
    const r = el.getBoundingClientRect();
    lab.textContent = text;
    lab.hidden = false;
    lab.style.left = `${Math.max(0, r.left + win.scrollX)}px`;
    const top = r.top + win.scrollY - 21;
    lab.style.top = `${top < 0 ? r.bottom + win.scrollY + 2 : top}px`;
  };
  const target = (e: Event): HTMLElement | null => {
    const t = e.target as Element | null;
    return t && typeof t.closest === 'function' ? (t.closest('[data-mx-el]') as HTMLElement | null) : null;
  };
  let hoverKey: string | null = null;
  const setHover = (el: HTMLElement | null) => {
    const key = el?.dataset.mxEl ?? null;
    if (key === hoverKey) return;
    if (hoverKey !== null) for (const x of all(hoverKey)) x.classList.remove('mx-hover');
    hoverKey = key;
    if (!el || key === null) return void (hoverLabel.hidden = true);
    for (const x of all(key)) x.classList.add('mx-hover');
    place(hoverLabel, el, el.dataset.mxLabel ?? '');
    post({ type: 'hover', el: Number(key), w: el.dataset.mxW ?? '' });
  };
  const setSel = (key: string | null, scroll: boolean) => {
    if (sel !== null) for (const x of all(sel)) x.classList.remove('mx-sel');
    sel = key;
    const list = key === null ? [] : all(key);
    if (!list.length) return void (selLabel.hidden = true);
    for (const x of list) x.classList.add('mx-sel');
    place(selLabel, list[0], list[0].dataset.mxLabel ?? '');
    if (scroll) list[0].scrollIntoView?.({ block: 'nearest' });
  };
  const choose = (el: HTMLElement) => {
    const key = el.dataset.mxEl ?? null;
    setSel(key, false);
    post({ type: 'select', el: Number(key), w: el.dataset.mxW ?? '' });
  };
  const setOn = (v: boolean, focus: boolean) => {
    on = v;
    doc.body.classList.toggle('mx-picking', v);
    const seen = new Set<string>();
    let first: HTMLElement | null = null;
    for (const el of Array.from(doc.querySelectorAll<HTMLElement>('[data-mx-el]'))) {
      const k = el.dataset.mxEl as string;
      if (v && !seen.has(k)) {
        seen.add(k);
        el.tabIndex = 0;
        el.setAttribute('role', 'button');
        el.setAttribute('aria-label', el.dataset.mxLabel ?? '');
        first ??= el;
      } else {
        el.removeAttribute('tabindex');
        el.removeAttribute('role');
        el.removeAttribute('aria-label');
      }
    }
    if (!v) setHover(null);
    if (v && focus) ((sel !== null ? all(sel)[0] : null) ?? first)?.focus();
  };
  doc.addEventListener('mouseover', (e) => on && setHover(target(e)));
  doc.addEventListener('mouseleave', () => on && setHover(null));
  doc.addEventListener('focusin', (e) => on && setHover(target(e)));
  doc.addEventListener(
    'click',
    (e) => {
      if (!on) return;
      const t = target(e);
      e.preventDefault();
      e.stopPropagation();
      if (t) choose(t);
    },
    true,
  );
  doc.addEventListener('keydown', (e) => {
    if (!on) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      post({ type: 'leave' });
      return;
    }
    const a = doc.activeElement as HTMLElement | null;
    if ((e.key === 'Enter' || e.key === ' ') && a?.dataset?.mxEl !== undefined) {
      e.preventDefault();
      choose(a);
    }
  });
  win.addEventListener('message', (e: MessageEvent) => {
    if (e.source !== win.parent) return;
    const d = e.data as { mx?: unknown; on?: unknown; focus?: unknown; sel?: unknown; scroll?: unknown } | null;
    if (!d || typeof d !== 'object' || d.mx !== 'pick-cmd') return;
    if (typeof d.on === 'boolean') setOn(d.on, d.focus === true);
    if ('sel' in d && (d.sel === null || (typeof d.sel === 'number' && Number.isInteger(d.sel) && d.sel >= 0))) setSel(d.sel === null ? null : String(d.sel), d.scroll === true);
  });
  post({ type: 'ready' });
}

/** The frame's script: the runtime above, called once. */
export const PICK_SCRIPT = `(${pickRuntime.toString()})(window);`;

/** A message from the frame, once checked. */
export type PickMessage = { type: 'ready' } | { type: 'leave' } | { type: 'hover' | 'select'; el: PreviewElement };

const TYPES = new Set(['ready', 'hover', 'select', 'leave']);

/**
 * The page's check of a message: from this frame's window, an opaque origin (the sandbox gives the frame none of
 * the office's), the expected shape, and for hover/select an element this drawing made (index and name match).
 * Anything else is ignored (null).
 */
export function acceptPick(e: Pick<MessageEvent, 'source' | 'origin' | 'data'>, frame: Window | null | undefined, elements: readonly PreviewElement[]): PickMessage | null {
  if (!frame || e.source !== frame || e.origin !== 'null') return null;
  const d = e.data as Record<string, unknown> | null;
  if (!d || typeof d !== 'object' || Array.isArray(d) || d.mx !== 'pick' || typeof d.type !== 'string' || !TYPES.has(d.type)) return null;
  if (d.type === 'ready' || d.type === 'leave') return { type: d.type };
  if (typeof d.el !== 'number' || !Number.isInteger(d.el) || typeof d.w !== 'string' || d.w.length > 100) return null;
  const el = elements[d.el];
  if (!el || el.name !== d.w) return null;
  return { type: d.type as 'hover' | 'select', el };
}

/** A fresh nonce for one preview document (32 hex characters). */
export function newNonce(): string {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}
