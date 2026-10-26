// Words on an action card (real-build finding: "Can't now: tell Carl" went off instantly, with nothing the
// Project Manager wanted to say). Every action card's buttons that send an answer (I've done it, Can't now, a
// Marketplace request's Decline) take an optional note typed in this one field: sent with whichever button is
// pressed, and cleared once it went. Empty is fine: the button works as before.

import { h } from '../dom';

export interface CardWords {
  el: HTMLElement;
  /** What was typed, trimmed ('' for nothing). */
  value(): string;
  clear(): void;
}

/** The field, with its label naming who reads it ("Add a note for Carl"). */
export function cardWords(owner: string, hint = 'optional: sent with the button you press'): CardWords {
  const id = `pt-words-${Math.random().toString(36).slice(2, 9)}`;
  const area = h('textarea.pt-dc-words', { id, rows: 1, maxlength: 2000, placeholder: `A note for ${owner} (${hint})`, 'aria-label': `A note for ${owner}, ${hint}` }) as HTMLTextAreaElement;
  // Grows with what's typed, up to a few lines.
  area.addEventListener('input', () => {
    area.style.height = 'auto';
    area.style.height = `${Math.min(area.scrollHeight, 120)}px`;
  });
  return {
    el: h('div.pt-dc-wordsbox', {}, area),
    value: () => area.value.trim(),
    clear: () => {
      area.value = '';
      area.style.height = '';
    },
  };
}
