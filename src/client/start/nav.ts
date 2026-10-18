// Home's left navigation in a Portal theme (start.css; the items' look is the 1D view's, ui/portal/nav.css):
// the office's own pages rather than a project's, with Home on top and picked. The 1D view's navigation
// has the same Home item on top (ui/portal/nav.ts), so Home is one click from every project page.
// Shown only while a Portal theme is on (.pt-only); on a phone the top bar's launcher goes there instead.

import { HOME_PAGE } from '../../shared/start';
import { h } from '../ui/dom';
import { icon, type PortalIcon } from '../ui/portal/icons';
import '../ui/portal/nav.css';

/** The office's pages, top to bottom: Home first. */
export const OFFICE_NAV: readonly { id: string; label: string; href: string; icon: PortalIcon; hint: string }[] = [
  { id: 'home', label: 'Home', href: HOME_PAGE, icon: 'home', hint: 'What needs you, and how every project is going' },
  { id: 'projects', label: 'Projects', href: '/home', icon: 'launcher', hint: 'Every project’s card' },
  { id: 'clients', label: 'Clients', href: '/clients', icon: 'users', hint: 'Every client (company) and its projects' },
  { id: 'firm', label: 'The Firm', href: '/firm', icon: 'audit', hint: 'Independent Reviewer Agents that audit a project' },
  { id: 'docs', label: 'Documentation', href: '/docs', icon: 'help', hint: 'Guides, reference and FAQ' },
];

/** Draws the pane before `.lite-main`, with `current` picked. */
export function officeNav(current = 'home'): HTMLElement {
  const items = OFFICE_NAV.map((it) => {
    const on = it.id === current;
    return h('li', {}, h(`a.pt-item${on ? '.on' : ''}`, { href: it.href, title: it.hint, 'data-nav': it.id, ...(on ? { 'aria-current': 'page' } : {}) }, icon(it.icon, 'pt-item-ico'), h('span.pt-item-l', {}, it.label)));
  });
  const pane = h('nav.pt-nav.pt-only.st-nav', { 'aria-label': 'Office navigation' }, h('div.pt-nav-in', {}, h('ul.pt-bottom', {}, ...items)));
  document.body.classList.add('st-has-nav');
  (document.querySelector('.lite-main') ?? document.body).before(pane);
  return pane;
}
