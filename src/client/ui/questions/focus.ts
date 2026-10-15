// Opening the Questions page at one question (a decision card's Answer, a stuck client question's Answer):
// the key is kept until the page has drawn it, then its card is scrolled to, focused and flashed. Loaded
// with the page's opener, so asking costs nothing until the page is there.

let wanted: string | undefined;

/** The next draw of the Questions page shows this question (`<file>#<id>`). */
export function wantQuestion(key: string | undefined) {
  wanted = key;
}

/** The page's: after drawing, go to the wanted question if it's there (its filter may hide it: then all). */
export function takeWantedQuestion(root: HTMLElement): boolean {
  if (!wanted) return false;
  const card = [...root.querySelectorAll<HTMLElement>('article.qs-card')].find((c) => c.getAttribute('data-key') === wanted);
  if (!card) return false;
  wanted = undefined;
  card.scrollIntoView?.({ block: 'center' });
  card.setAttribute('tabindex', '-1');
  card.focus?.({ preventScroll: true });
  card.classList.add('pt-flash');
  setTimeout(() => card.classList.remove('pt-flash'), 1400);
  return true;
}

/** Whether a question is wanted (the page shows every question then, so its filter can't hide it). */
export const questionWanted = () => !!wanted;
