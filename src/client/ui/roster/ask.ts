// A small window asking for one line of text (a role's new name, its model, why a proposal is
// rejected): ✕ and Esc close it, Enter sends it.

import { h, openModal } from '../dom';

export interface AskOptions {
  title: string;
  label: string;
  value?: string;
  placeholder?: string;
  /** A textarea instead of a one-line box. */
  long?: boolean;
  ok: string;
  /** Empty is allowed (the hire's optional task). */
  optional?: boolean;
  /** Choices offered under the box, as buttons that fill it in. */
  choices?: string[];
  /** A second, picked answer under the box (the hire's model), as a dropdown: each option's value and what it's called. */
  pick?: { label: string; options: { value: string; label: string }[]; value: string };
  /** Only the dropdown, no text box (changing a role's model). */
  pickOnly?: boolean;
}

export function askText(o: AskOptions, done: (text: string, picked?: string) => void) {
  const box = o.long
    ? h('textarea.ro-ask-input', { rows: 4, placeholder: o.placeholder ?? '', 'aria-label': o.label })
    : h('input.ro-ask-input', { type: 'text', placeholder: o.placeholder ?? '', 'aria-label': o.label, maxlength: 64 });
  box.value = o.value ?? '';
  let picked = o.pick?.value;
  const pickRow = o.pick
    ? (() => {
        const sel = h('select.ro-pick-select', { 'aria-label': o.pick.label }, ...o.pick.options.map((opt) => h('option', { value: opt.value, selected: opt.value === picked }, opt.label))) as HTMLSelectElement;
        // A model saved as an id the list doesn't have (set by hand) still shows as itself.
        if (picked && !o.pick.options.some((opt) => opt.value === picked)) sel.prepend(h('option', { value: picked, selected: true }, picked));
        sel.addEventListener('change', () => (picked = sel.value));
        return h('label.ro-pick', {}, h('span.ro-ask-label', {}, o.pick.label), sel);
      })()
    : null;
  const send = () => {
    const v = box.value.trim();
    if (!v && !o.optional && !o.pickOnly) return box.focus();
    modal.close();
    done(v, picked);
  };
  box.addEventListener('keydown', (e) => {
    const k = e as KeyboardEvent;
    if (k.key === 'Enter' && (!o.long || k.ctrlKey || k.metaKey)) {
      k.preventDefault();
      send();
    }
  });
  const content = h(
    'div.modal.ro-ask',
    { role: 'dialog', 'aria-label': o.title },
    h('header', {}, h('h2', { title: o.title }, o.title)),
    h(
      'div.body',
      {},
      o.pickOnly ? h('p.ro-ask-label', {}, o.label) : h('label.ro-ask-label', {}, o.label),
      o.pickOnly ? null : box,
      pickRow,
      o.choices?.length ? h('div.ro-choices', {}, ...o.choices.map((c) => h('button.btn.small', { type: 'button', onclick: () => ((box.value = c), box.focus()) }, c))) : null,
    ),
    h('footer', {}, h('button.btn', { type: 'button', onclick: () => modal.close() }, 'Cancel'), h('button.btn.primary', { type: 'button', onclick: send }, o.ok)),
  );
  const modal = openModal(content);
  setTimeout(() => box.focus(), 0);
}
