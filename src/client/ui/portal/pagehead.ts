// The Portal page header of the 1D view (pagehead.css): the band at the top of every page, in a
// Portal theme only, as the portal's app pages have it.
//
//   Overview:  [tile] Project name                                  [Pin project] [New task]
//                     What the project is for
//   Board:     Board                                     [Issues] [PRs] [Queue] [New task]
//   Audit log: Audit log                           [Call an audit] [The Firm →] [New task]
//   ▓▓ ⎇ main · repo · 👥 1 here · [$ budget] [● Running | Pause] ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓
//   ▓▓ [ the progress bar ]                                                         ▓▓
//
// Under it, the band (.pt-band): the floor's line (branch, folder, who's here, the budget chip and the
// run-state toggle, .bud-meta-row) and the progress bar together on a mid dark grey, the same on every
// page. Nothing in either is new: they, the Firm's banner and the bottom bar's buttons (#btn-issues,
// #btn-pulls, #btn-queue, #btn-new) are the page's own elements, moved here while Portal is on
// (./slot.ts) and back in the other themes, so what draws, counts and clicks them is unchanged. Pin is
// Home's pin (shared/project-prefs.ts).

import { store } from '../../state';
import { floorPalette } from '../../../shared/floors';
import { tileLetters } from '../../home/portal-logic';
import { isPinned, onProjectPrefs, setPinned } from '../../shared/project-prefs';
import { h } from '../dom';
import { icon } from './icons';
import { navItem, pageTitle } from './nav-logic';
import { portalSlot } from './slot';
import './pagehead.css';

export interface PageHead {
  el: HTMLElement;
  /** The page showing now. */
  page(tab: string): void;
  /** What the project is for (the summary's goal), for the Overview's line. */
  describe(goal: string | undefined): void;
}

export function pageHead(main: HTMLElement): PageHead {
  let tab = 'command';
  let goal: string | undefined;
  const tile = h('span.pt-head-tile', { 'aria-hidden': 'true' });
  const title = h('h1.pt-head-title');
  const desc = h('p.pt-head-desc');
  const pinBtn = h('button.btn.pt-head-pin', { type: 'button' }, icon('pin', 'pt-btn-ico pt-pin-off'), icon('pinned', 'pt-btn-ico pt-pin-on'), h('span.pt-pin-l'));
  pinBtn.addEventListener('click', () => store.floor && setPinned(store.floor, !isPinned(store.floor)));
  const firm = h('div.pt-head-firm');
  const board = h('div.pt-head-board');
  const fresh = h('div.pt-head-new');
  const actions = h('div.pt-head-actions', {}, pinBtn, firm, board, fresh);
  const el = h('header.pt-head.pt-only', { id: 'pt-head' }, h('div.pt-head-id', {}, tile, h('div.pt-head-text', {}, title, desc)), actions);
  const band = h('div.pt-band.pt-only');
  main.prepend(el, band);

  // The page's own pieces, moved in while Portal is on.
  portalSlot(document.querySelector('.bud-meta-row') ?? document.getElementById('floor-meta'), band);
  portalSlot(document.getElementById('progress-bar'), band);
  portalSlot(document.getElementById('firm-banner'), firm);
  for (const id of ['btn-issues', 'btn-pulls', 'btn-queue']) portalSlot(document.getElementById(id), board);
  portalSlot(document.getElementById('btn-new'), fresh);

  const drawPin = () => {
    const on = !!store.floor && isPinned(store.floor);
    pinBtn.classList.toggle('on-pin', on);
    pinBtn.setAttribute('aria-pressed', String(on));
    pinBtn.querySelector('.pt-pin-l')!.textContent = on ? 'Pinned' : 'Pin project';
    pinBtn.title = on ? 'Pinned: it comes first on Home’s Projects page. Click to unpin' : 'Pin this project: it comes first on Home’s Projects page';
  };
  const draw = () => {
    const overview = tab === 'command';
    el.dataset.page = tab;
    el.classList.toggle('pt-head-ov', overview);
    const f = store.currentFloor();
    tile.hidden = !overview;
    tile.textContent = f ? tileLetters(f.name) : '?';
    el.style.setProperty('--tile', f ? floorPalette(f.palette).trim : 'var(--accent)');
    const text = overview ? (f?.name ?? 'Overview') : pageTitle(tab);
    if (title.textContent !== text) title.textContent = text;
    const line = overview ? (goal ?? (f?.repo ? `${f.repo} on GitHub` : (f?.dir ?? ''))) : (navItem(tab)?.hint ?? '');
    if (desc.textContent !== line) desc.textContent = line;
    desc.hidden = !line;
    drawPin();
  };
  store.on('floor', () => ((goal = undefined), draw()));
  store.on('floors', draw);
  onProjectPrefs(drawPin);
  draw();
  return {
    el,
    page(t) {
      tab = t;
      draw();
    },
    describe(g) {
      goal = g?.trim() || undefined;
      draw();
    },
  };
}
