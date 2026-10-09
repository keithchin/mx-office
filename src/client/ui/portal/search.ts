// The Portal top bar's search: a wide field in the middle of the navy bar that finds a project, a page
// of the project you're on, an agent, an issue, a pull request, one of the office's pages or a docs page
// as you type, in groups, and goes there on Enter or a click. It's a combobox: ↑ ↓ walk the results
// (over the group headings), Enter picks, Esc clears and closes. Everything but the docs is already on
// the page (the store, the left navigation), so it asks the office nothing; the docs' titles come once,
// the first time the field is focused (./docs-index.ts). On a phone it folds into a magnifier that opens
// the field across the bar. What it finds and in what order is ui/portal/search-logic.ts.

import { h } from '../dom';
import { icon, type PortalIcon } from './icons';
import { docItems, loadDocs } from './docs-index';
import { searchGroups, type SearchItem, type SearchKind } from './search-logic';

const KIND_ICON: Record<SearchKind, PortalIcon> = { project: 'cube', tab: 'tab', agent: 'agent', issue: 'issue', pr: 'pr', page: 'launcher', doc: 'doc' };

export function portalSearch(bar: HTMLElement, items: () => SearchItem[]): HTMLElement {
  const listId = 'pt-search-list';
  const input = h('input.pt-search-input', {
    type: 'search',
    placeholder: 'Search',
    'aria-label': 'Search projects, pages, agents, issues, pull requests and docs',
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
  const opener = h('button.pt-iconbtn.pt-search-btn', { type: 'button', 'aria-label': 'Search', title: 'Search projects, pages, agents, issues and docs' }, icon('search'));
  opener.addEventListener('click', () => {
    bar.classList.add('pt-searching');
    input.focus();
  });
  let found: SearchItem[] = [];
  let at = -1;

  const options = () => [...list.querySelectorAll<HTMLElement>('.pt-result[data-i]')];
  const mark = (i: number) => {
    at = i;
    for (const li of options()) {
      const on = Number(li.dataset.i) === i;
      li.classList.toggle('active', on);
      li.setAttribute('aria-selected', String(on));
      if (on) li.scrollIntoView({ block: 'nearest' });
    }
    if (i >= 0) input.setAttribute('aria-activedescendant', `${listId}-${i}`);
    else input.removeAttribute('aria-activedescendant');
  };
  const close = () => {
    list.hidden = true;
    input.setAttribute('aria-expanded', 'false');
    mark(-1);
  };
  const draw = () => {
    const groups = searchGroups([...items(), ...docItems()], input.value);
    found = groups.flatMap((g) => g.items);
    let i = 0;
    list.replaceChildren(
      ...(found.length
        ? groups.flatMap((g) => [
            h('li.pt-result-group', { role: 'presentation', 'aria-hidden': 'true' }, g.label),
            ...g.items.map((it) => {
              const n = i++;
              return h(
                'li.pt-result',
                { id: `${listId}-${n}`, role: 'option', 'aria-selected': 'false', 'data-i': n, 'aria-label': `${it.label}${it.hint ? `, ${it.hint}` : ''} (${g.label})` },
                icon(KIND_ICON[it.kind], 'pt-result-ico'),
                h('span.pt-result-l', {}, it.label),
                it.hint ? h('small.pt-result-k', {}, it.hint) : null,
              );
            }),
          ])
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
  input.addEventListener('focus', () => {
    // The docs' titles, once: the list draws again when they're in, if it's still open.
    loadDocs(() => !list.hidden && draw());
    draw();
  });
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
    if (!li) return void e.preventDefault();
    e.preventDefault();
    pick(Number(li.dataset.i));
  });
  input.addEventListener('blur', () => {
    close();
    if (!input.value) bar.classList.remove('pt-searching');
  });
  return h('div.pt-search-wrap.pt-only', {}, field, opener);
}
