// The overlay over the project brief while the Chief Analyst folds a chat answer into it: the brief stays
// underneath, dimmed and inert (no Confirm, Edit or Answer in chat meanwhile), under the drafting card the
// first brief was drafted with (parts.ts), kept in view as the plan scrolls. It fades in and out (no motion
// with reduced motion: new.css), is made once, and says nothing itself: the chat's status pill announces it.
// When it's done, the changed items pulse once and the first one is scrolled to if it's out of sight; when
// nothing changed, a note says so for a moment.
import './brief-overlay.css';
import { h } from '../../dom';
import { draftingCard } from './parts';

const FADE_MS = 220;
const NOTE_MS = 2200;

export function briefOverlay(panel: HTMLElement, content: HTMLElement) {
  let ov: HTMLElement | undefined;
  let note: HTMLElement | undefined;
  let hideT: ReturnType<typeof setTimeout> | undefined;
  let noteT: ReturnType<typeof setTimeout> | undefined;

  function make(): HTMLElement {
    const card = draftingCard('Updating the brief…', 'Folding your answer into the brief; changed items will be highlighted.');
    card.removeAttribute('role');
    const el = h('div.nw-upd', { 'aria-hidden': 'true', hidden: true }, h('div.nw-upd-card', {}, card));
    panel.append(el);
    return el;
  }

  return {
    show() {
      ov ??= make();
      if (hideT) clearTimeout(hideT);
      hideT = undefined;
      ov.hidden = false;
      // The card stays just under the plan's sticky header, whatever its height (read once per update).
      const head = panel.closest('.nw-doc')?.querySelector<HTMLElement>('.nw-dochead');
      ov.style.setProperty('--nw-upd-top', `${(head?.offsetHeight ?? 0) + 16}px`);
      panel.classList.add('nw-updating');
      panel.setAttribute('aria-busy', 'true');
      content.inert = true;
      // One style flush (once per update, not per poll), so the fade runs from hidden.
      void ov.offsetWidth;
      ov.classList.add('on');
    },
    hide() {
      panel.classList.remove('nw-updating');
      panel.removeAttribute('aria-busy');
      content.inert = false;
      if (!ov) return;
      ov.classList.remove('on');
      hideT = setTimeout(() => ov && (ov.hidden = true), FADE_MS);
    },
    /** The changed items' pulse, the first one scrolled into view when it's out of sight. */
    pulse(ids: string[]) {
      const nodes = ids.map((id) => panel.querySelector<HTMLElement>(`#nw-it-${CSS.escape(id)}`)).filter((n): n is HTMLElement => !!n);
      for (const n of nodes) n.classList.add('nw-changed');
      setTimeout(() => nodes.forEach((n) => n.classList.remove('nw-changed')), 1700);
      const first = nodes[0];
      const scroller = panel.closest<HTMLElement>('.nw-doc');
      if (!first || !scroller) return;
      const r = first.getBoundingClientRect();
      const box = scroller.getBoundingClientRect();
      const head = scroller.querySelector<HTMLElement>('.nw-dochead')?.offsetHeight ?? 0;
      if (r.top < box.top + head || r.bottom > box.bottom) first.scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    },
    /** A short note on the panel ("No changes to the brief"). */
    note(text: string) {
      note ??= panel.appendChild(h('div.nw-upd-note', { 'aria-hidden': 'true', hidden: true }));
      note.textContent = text;
      note.hidden = false;
      if (noteT) clearTimeout(noteT);
      noteT = setTimeout(() => note && (note.hidden = true), NOTE_MS);
    },
  };
}
