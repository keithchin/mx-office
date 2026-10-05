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
  /** A second, picked answer under the box (the hire's model): its options as buttons, one lit. */
  pick?: { label: string; options: string[]; value: string };
}

export function askText(o: AskOptions, done: (text: string, picked?: string) => void) {
  const box = o.long
    ? h('textarea.ro-ask-input', { rows: 4, placeholder: o.placeholder ?? '', 'aria-label': o.label })
    : h('input.ro-ask-input', { type: 'text', placeholder: o.placeholder ?? '', 'aria-label': o.label, maxlength: 64 });
  box.value = o.value ?? '';
  let picked = o.pick?.value;
  const pickRow = o.pick
    ? h('div.ro-pick', { role: 'radiogroup', 'aria-label': o.pick.label }, h('span.ro-ask-label', {}, o.pick.label), ...o.pick.options.map((opt) => {
        const b = h('button.btn.small', { type: 'button', role: 'radio', 'aria-checked': String(opt === picked), class: opt === picked ? 'on' : '' }, opt);
        b.addEventListener('click', () => {
          picked = opt;
          for (const x of pickRow!.querySelectorAll('button')) { x.classList.toggle('on', x === b); x.setAttribute('aria-checked', String(x === b)); }
        });
        return b;
      }))
    : null;
  const send = () => {
    const v = box.value.trim();
    if (!v && !o.optional) return box.focus();
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
      h('label.ro-ask-label', {}, o.label),
      box,
      pickRow,
      o.choices?.length ? h('div.ro-choices', {}, ...o.choices.map((c) => h('button.btn.small', { type: 'button', onclick: () => ((box.value = c), box.focus()) }, c))) : null,
    ),
    h('footer', {}, h('button.btn', { type: 'button', onclick: () => modal.close() }, 'Cancel'), h('button.btn.primary', { type: 'button', onclick: send }, o.ok)),
  );
  const modal = openModal(content);
  setTimeout(() => box.focus(), 0);
}
