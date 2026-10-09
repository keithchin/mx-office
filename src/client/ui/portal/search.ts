// The Portal top bar's search: a wide field in the middle of the navy bar that finds a project, a tab of
// the page you're on or one of the office's pages as you type, and goes there on Enter or a click. It's
// a combobox: ↑ ↓ walk the results, Enter picks, Esc clears and closes. Everything it searches is
// already on the page (the floors in the store, the tab buttons), so it asks the office nothing. On a
// phone it folds into a magnifier that opens the field across the bar. What it finds and in what order
// is ui/portal/search-logic.ts.

import { h } from '../dom';
import { icon } from './icons';
import { searchItems, type SearchItem } from './search-logic';

const KIND_WORD = { project: 'Project', tab: 'Tab', page: 'Page' } as const;

export function portalSearch(bar: HTMLElement, items: () => SearchItem[]): HTMLElement {
  const listId = 'pt-search-list';
  const input = h('input.pt-search-input', {
    type: 'search',
    placeholder: 'Search',
    'aria-label': 'Search projects, tabs and pages',
    role: 'combobox',
    'aria-autocomplete': 'list',
    'aria-expanded': 'false',
    'aria-controls': listId,
    autocomplete: 'off',
    spellcheck: 'false',
  }) as HTMLInputElement;
  const list = h('ul.pt-results.pt-pagecolors', { id: listId, role: 'listbox', 'aria-label': 'Search results', hidden: true });
  const field = h('div.pt-search', { role: 'search' }, input, icon('search', 'pt-search-ico'), list);
  // The phone's magnifier: opens the field over the bar.
  const opener = h('button.pt-iconbtn.pt-search-btn', { type: 'button', 'aria-label': 'Search', title: 'Search projects, tabs and pages' }, icon('search'));
  opener.addEventListener('click', () => {
    bar.classList.add('pt-searching');
    input.focus();
  });
  let found: SearchItem[] = [];
  let at = -1;

  const mark = (i: number) => {
    at = i;
    [...list.children].forEach((li, j) => li.classList.toggle('active', j === i));
    if (i >= 0) input.setAttribute('aria-activedescendant', `${listId}-${i}`);
    else input.removeAttribute('aria-activedescendant');
  };
  const close = () => {
    list.hidden = true;
    input.setAttribute('aria-expanded', 'false');
    mark(-1);
  };
  const draw = () => {
    found = searchItems(items(), input.value);
    list.replaceChildren(
      ...(found.length
        ? found.map((it, i) =>
            h(
              'li.pt-result',
              { id: `${listId}-${i}`, role: 'option', 'aria-selected': 'false', 'data-i': i },
              h('span.pt-result-l', {}, it.label),
              h('small.pt-result-k', {}, it.hint ? `${KIND_WORD[it.kind]} · ${it.hint}` : KIND_WORD[it.kind]),
            ),
          )
        : [h('li.pt-result.pt-none', { role: 'option', 'aria-disabled': 'true' }, `Nothing called “${input.value.trim()}”`)]),
    );
    list.hidden = false;
    input.setAttribute('aria-expanded', 'true');
    mark(found.length && input.value.trim() ? 0 : -1);
  };
  const pick = (i: number) => {
    const it = found[i];
    if (!it) return;
    input.value = '';
    close();
    bar.classList.remove('pt-searching');
    input.blur();
    it.go();
  };
  input.addEventListener('input', draw);
  input.addEventListener('focus', draw);
  input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (list.hidden) draw();
      if (!found.length) return;
      mark(e.key === 'ArrowDown' ? (at + 1) % found.length : (at - 1 + found.length) % found.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      pick(at >= 0 ? at : 0);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      if (input.value) input.value = '';
      close();
      bar.classList.remove('pt-searching');
      input.blur();
    }
  });
  // A pick by pointer: before the field's blur closes the list.
  list.addEventListener('pointerdown', (e) => {
    const li = (e.target as HTMLElement).closest<HTMLElement>('.pt-result[data-i]');
    if (!li) return;
    e.preventDefault();
    pick(Number(li.dataset.i));
  });
  input.addEventListener('blur', () => {
    close();
    if (!input.value) bar.classList.remove('pt-searching');
  });
  return h('div.pt-search-wrap.pt-only', {}, field, opener);
}
