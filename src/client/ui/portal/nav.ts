// The Portal left navigation of the 1D view (nav.css; what it lists and remembers is ./nav-logic.ts):
// a pane down the left like a low-code platform's app pane, only in a Portal theme (.pt-only; the other
// themes keep the tab row exactly as it was).
//
//   [tile] Project name ⌄        the floor picker (#floor), moved here from the top bar (./slot.ts)
//   General ⌃                     groups that open and close, remembered per viewer in this browser
//     Overview            (8)     the picked page in the portal's grey pill, the tabs' badges mirrored
//     Team …
//   Project Management ›          a closed group shows its items in a flyout on hover, and its badge
//   ─────────────
//   ⚙ Settings · View App · Edit in Studio Pro
//
// Every item is one of the tabs (the same ids: lite.ts's showTab opens it, so ?tab= links, the tabs'
// badges and every other way in still work) or an action. The chevron on the pane's edge folds it to an
// icon rail, whose groups open as flyouts. On a phone it's a drawer, opened from the ☰ at the bar's left.
// Drawn once; a badge changing (the tab row's, watched with a MutationObserver) touches only its item.

import { store } from '../../state';
import { floorPalette } from '../../../shared/floors';
import { tileLetters } from '../../home/portal-logic';
import { h } from '../dom';
import { icon, type PortalIcon } from './icons';
import { portalSlot } from './slot';
import {
  groupBadge,
  groupOpen,
  NAV_BOTTOM,
  NAV_GROUPS,
  NAV_KEY,
  parseNavState,
  readBadge,
  revealGroup,
  serializeNavState,
  showsFlyout,
  toggleGroup,
  visibleItems,
  type GroupId,
  type NavAction,
  type NavBadge,
  type NavItem,
  type NavState,
  type NavTab,
} from './nav-logic';
import './nav.css';

export interface PortalNavDeps {
  /** Opens a tab (lite.ts's showTab). */
  show(tab: NavTab): void;
  /** Does an action: the deliverables window, the live app, Studio Pro. */
  run(action: NavAction): void;
  /** Whether an action is offered now (Studio Pro only on a Mendix project). */
  offered?(action: NavAction): boolean;
}

export interface PortalNav {
  /** The page showing now (showTab calls it). */
  selected(tab: string): void;
  /** Opens or closes the phone's drawer. */
  drawer(open?: boolean): void;
}

const BOTTOM_ICON: Record<string, PortalIcon> = { settings: 'gear', 'view-app': 'cube', studio: 'studio' };
const MOBILE = '(max-width: 760px)';

function loadState(): NavState {
  try {
    return parseNavState(localStorage.getItem(NAV_KEY));
  } catch {
    return parseNavState(null);
  }
}
function saveState(s: NavState) {
  try {
    localStorage.setItem(NAV_KEY, serializeNavState(s));
  } catch {
    // Only for this visit.
  }
}

export function portalNav(deps: PortalNavDeps): PortalNav {
  let state = loadState();
  let current = 'command';
  const body = document.body;
  body.classList.add('pt-has-nav');

  // ---- The project card: the floor's tile and name over the floor picker -----------------------------
  const tile = h('span.pt-proj-tile', { 'aria-hidden': 'true' });
  const name = h('span.pt-proj-name');
  const card = h('div.pt-proj', {}, tile, name, icon('chevron', 'pt-proj-chev'));
  const drawCard = () => {
    const f = store.currentFloor();
    name.textContent = f?.name ?? 'No project';
    tile.textContent = f ? tileLetters(f.name) : '?';
    card.style.setProperty('--tile', f ? floorPalette(f.palette).trim : 'var(--accent)');
    card.title = f ? `${f.name}: pick another project` : 'Pick a project';
  };
  store.on('floor', drawCard);
  store.on('floors', drawCard);
  store.on('project', drawCard);
  drawCard();

  // ---- The groups ---------------------------------------------------------------------------------
  const itemEls = new Map<string, HTMLButtonElement>();
  const badgeEls = new Map<string, HTMLElement>();
  const groupEls = new Map<GroupId, { li: HTMLElement; head: HTMLButtonElement; badge: HTMLElement; list: HTMLElement }>();

  const badgeEl = () => h('span.pt-nbadge', { hidden: true, 'aria-hidden': 'true' });
  const itemButton = (it: NavItem, withIcon?: PortalIcon) => {
    const b = badgeEl();
    const btn = h(
      'button.pt-item',
      { type: 'button', 'data-nav': it.id, title: it.hint },
      withIcon ? icon(withIcon, 'pt-item-ico') : null,
      h('span.pt-item-l', {}, it.label),
      b,
    ) as HTMLButtonElement;
    btn.addEventListener('click', () => pick(it));
    itemEls.set(it.id, btn);
    badgeEls.set(it.id, b);
    return btn;
  };
  const groupsList = h('ul.pt-groups');
  for (const g of NAV_GROUPS) {
    const list = h('ul.pt-items', { id: `pt-g-${g.id}`, role: 'list' }, ...g.items.map((it) => h('li', { 'data-li': it.id }, itemButton(it))));
    const badge = badgeEl();
    const head = h(
      'button.pt-group-h',
      { type: 'button', 'aria-controls': `pt-g-${g.id}`, 'data-group': g.id },
      icon(g.icon, 'pt-group-ico'),
      h('span.pt-group-l', {}, g.label),
      badge,
      icon('chevronUp', 'pt-chev-open'),
      icon('chevronRight', 'pt-chev-closed'),
    ) as HTMLButtonElement;
    const li = h('li.pt-group', { 'data-group': g.id }, head, list);
    groupEls.set(g.id, { li, head, badge, list });
    head.addEventListener('click', () => {
      if (state.rail && !mobile()) return toggleFlyout(g.id, head, true);
      closeFlyout();
      state = toggleGroup(state, g.id, current);
      saveState(state);
      drawGroups();
    });
    head.addEventListener('pointerenter', (e) => e.pointerType === 'mouse' && hoverFlyout(g.id, head));
    head.addEventListener('pointerleave', leaveSoon);
    groupsList.append(li);
  }
  const bottom = h('ul.pt-bottom', {}, ...NAV_BOTTOM.map((it) => h('li', { 'data-li': it.id }, itemButton(it, BOTTOM_ICON[it.id]))));
  // A phone's drawer also has where the launcher goes (the launcher gives way to the ☰ there).
  const goTo = h(
    'ul.pt-goto',
    {},
    h('li', {}, h('a.pt-item', { href: '/home' }, icon('launcher', 'pt-item-ico'), h('span.pt-item-l', {}, 'All projects'))),
    h('li', {}, h('a.pt-item', { href: '/firm' }, icon('audit', 'pt-item-ico'), h('span.pt-item-l', {}, 'The Firm'))),
    h('li', {}, h('a.pt-item', { href: '/docs' }, icon('help', 'pt-item-ico'), h('span.pt-item-l', {}, 'Documentation'))),
  );
  const fold = h('button.pt-nav-fold', { type: 'button' }, icon('chevronLeft', 'pt-fold-l'), icon('chevronRight', 'pt-fold-r'));
  fold.addEventListener('click', () => {
    state = { ...state, rail: !state.rail };
    saveState(state);
    closeFlyout();
    drawRail();
  });
  const pane = h('nav.pt-nav.pt-only', { id: 'pt-nav', 'aria-label': 'Project navigation' }, h('div.pt-nav-in', {}, card, groupsList, h('hr.pt-nav-rule'), bottom, goTo), fold);
  const scrim = h('div.pt-scrim.pt-only', { 'aria-hidden': 'true' });
  scrim.addEventListener('click', () => drawer(false));
  const main = document.querySelector('.lite-main');
  (main ?? body).before(pane, scrim);

  // The floor picker goes into the card while Portal is on (back to the bar in the other themes).
  const picker = document.querySelector('.lite-bar .lite-floor');
  portalSlot(picker, card, (el) => card.append(el));

  const mobile = () => matchMedia(MOBILE).matches;

  function drawGroups() {
    const admin = store.me.admin;
    for (const g of NAV_GROUPS) {
      const els = groupEls.get(g.id)!;
      const open = groupOpen(state, g.id, current);
      els.li.classList.toggle('open', open);
      els.head.setAttribute('aria-expanded', String(open));
      els.list.hidden = !open;
      const shown = new Set(visibleItems(g, admin).map((i) => i.id));
      for (const li of els.list.children) (li as HTMLElement).hidden = !shown.has((li as HTMLElement).dataset.li as NavTab);
    }
    for (const it of NAV_BOTTOM) {
      const li = bottom.querySelector<HTMLElement>(`[data-li="${it.id}"]`)!;
      li.hidden = it.kind === 'action' && deps.offered ? !deps.offered(it.id as NavAction) : false;
    }
    drawGroupBadges();
  }
  function drawRail() {
    body.classList.toggle('pt-rail', state.rail);
    fold.setAttribute('aria-label', state.rail ? 'Expand the navigation' : 'Collapse the navigation');
    fold.title = state.rail ? 'Expand the navigation' : 'Collapse the navigation to icons';
    fold.setAttribute('aria-expanded', String(!state.rail));
    for (const [, els] of groupEls) els.head.title = state.rail ? els.head.textContent ?? '' : '';
    for (const it of NAV_BOTTOM) {
      const el = itemEls.get(it.id)!;
      if (state.rail) el.setAttribute('aria-label', it.label);
      else el.removeAttribute('aria-label');
    }
  }
  function drawSelected() {
    for (const [id, el] of itemEls) {
      const on = id === current;
      el.classList.toggle('on', on);
      if (on) el.setAttribute('aria-current', 'page');
      else el.removeAttribute('aria-current');
    }
    for (const g of NAV_GROUPS) groupEls.get(g.id)!.li.classList.toggle('has-current', g.items.some((i) => i.id === current));
  }

  // ---- Badges: the tab row's, mirrored ----------------------------------------------------------
  const badges = new Map<string, NavBadge>();
  const paintBadge = (el: HTMLElement, b: NavBadge) => {
    const text = b?.text ?? '';
    if (el.textContent !== text) el.textContent = text;
    el.hidden = !b;
    el.classList.toggle('dot', b?.kind === 'dot');
    el.classList.toggle('bang', b?.kind === 'bang');
  };
  function readBadges(): boolean {
    let changed = false;
    for (const id of itemEls.keys()) {
      const src = document.getElementById(`tab-${id}`)?.querySelector<HTMLElement>('.ro-tab-n');
      const b = src ? readBadge(src.textContent ?? '', src.classList.contains('dot'), src.classList.contains('bang')) : null;
      const was = badges.get(id) ?? null;
      if (was?.text === b?.text && was?.kind === b?.kind) continue;
      changed = true;
      badges.set(id, b);
      paintBadge(badgeEls.get(id)!, b);
      const label = itemEls.get(id)!.querySelector('.pt-item-l')!.textContent ?? '';
      const tip = src?.getAttribute('aria-label');
      itemEls.get(id)!.setAttribute('aria-label', b ? `${label}, ${b.kind === 'count' ? b.text : 'new'}${tip ? `: ${tip}` : ''}` : label);
    }
    return changed;
  }
  function drawGroupBadges() {
    const admin = store.me.admin;
    for (const g of NAV_GROUPS) {
      const els = groupEls.get(g.id)!;
      const closed = !groupOpen(state, g.id, current) || state.rail;
      paintBadge(els.badge, closed ? groupBadge(visibleItems(g, admin).map((i) => badges.get(i.id) ?? null)) : null);
    }
  }
  const tabs = document.querySelector('.lite-tabs');
  if (tabs) {
    new MutationObserver(() => {
      if (readBadges()) drawGroupBadges();
      if (flyout.dataset.group) syncFlyout();
    }).observe(tabs, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['class'] });
  }

  // ---- The flyout: a closed group's (or the rail's) items beside the pane -------------------------
  const flyout = h('div.pt-flyout.pt-only.pt-pagecolors', { role: 'menu', hidden: true });
  body.append(flyout);
  let hoverT: ReturnType<typeof setTimeout> | undefined;
  let leaveT: ReturnType<typeof setTimeout> | undefined;
  function leaveSoon() {
    clearTimeout(hoverT);
    clearTimeout(leaveT);
    leaveT = setTimeout(closeFlyout, 220);
  }
  flyout.addEventListener('pointerenter', () => clearTimeout(leaveT));
  flyout.addEventListener('pointerleave', leaveSoon);
  function hoverFlyout(g: GroupId, head: HTMLElement) {
    clearTimeout(leaveT);
    if (mobile() || !showsFlyout(state.rail, groupOpen(state, g, current))) return;
    clearTimeout(hoverT);
    hoverT = setTimeout(() => openFlyout(g, head, false), flyout.hidden ? 120 : 0);
  }
  function syncFlyout() {
    for (const el of flyout.querySelectorAll<HTMLElement>('[data-nav]')) {
      const id = el.dataset.nav!;
      el.classList.toggle('on', id === current);
      paintBadge(el.querySelector('.pt-nbadge')!, badges.get(id) ?? null);
    }
  }
  function openFlyout(g: GroupId, head: HTMLElement, focus: boolean) {
    const group = NAV_GROUPS.find((x) => x.id === g)!;
    const items = visibleItems(group, store.me.admin);
    flyout.replaceChildren(
      h('div.pt-fly-h', { 'aria-hidden': 'true' }, group.label),
      ...items.map((it) => {
        const b = h('button.pt-fly-item', { type: 'button', role: 'menuitem', 'data-nav': it.id, title: it.hint }, h('span', {}, it.label), badgeEl());
        b.addEventListener('click', () => (closeFlyout(), pick(it)));
        return b;
      }),
    );
    flyout.setAttribute('aria-label', group.label);
    flyout.dataset.group = g;
    syncFlyout();
    flyout.hidden = false;
    const r = head.getBoundingClientRect();
    const paneR = pane.getBoundingClientRect();
    flyout.style.left = `${Math.round(paneR.right + 4)}px`;
    flyout.style.top = `${Math.round(Math.min(r.top - 6, innerHeight - flyout.offsetHeight - 8))}px`;
    for (const [id, els] of groupEls) els.head.classList.toggle('flying', id === g);
    if (focus) flyout.querySelector<HTMLElement>('.pt-fly-item')?.focus();
  }
  function toggleFlyout(g: GroupId, head: HTMLElement, focus: boolean) {
    if (!flyout.hidden && flyout.dataset.group === g) return closeFlyout();
    openFlyout(g, head, focus);
  }
  function closeFlyout(refocus = false) {
    clearTimeout(hoverT);
    if (flyout.hidden) return;
    const g = flyout.dataset.group as GroupId | undefined;
    flyout.hidden = true;
    delete flyout.dataset.group;
    for (const [, els] of groupEls) els.head.classList.remove('flying');
    if (refocus && g) groupEls.get(g)?.head.focus();
  }
  flyout.addEventListener('keydown', (e) => {
    const list = [...flyout.querySelectorAll<HTMLElement>('.pt-fly-item')];
    const i = list.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      list[(i + (e.key === 'ArrowDown' ? 1 : -1) + list.length) % list.length]?.focus();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      closeFlyout(true);
    } else if (e.key === 'Tab') closeFlyout();
  });
  document.addEventListener('pointerdown', (e) => {
    if (!flyout.hidden && !flyout.contains(e.target as Node) && !pane.contains(e.target as Node)) closeFlyout();
  });

  // ---- The phone's drawer ---------------------------------------------------------------------------
  const navBtn = h('button.pt-iconbtn.pt-navbtn.pt-only', { type: 'button', 'aria-label': 'Navigation', title: 'The project’s pages', 'aria-controls': 'pt-nav', 'aria-expanded': 'false' }, icon('menu'));
  navBtn.addEventListener('click', () => drawer());
  document.querySelector('.lite-bar .pt-launch')?.before(navBtn);
  function drawer(open = !body.classList.contains('pt-drawer-open')) {
    body.classList.toggle('pt-drawer-open', open);
    navBtn.setAttribute('aria-expanded', String(open));
    if (open) (pane.querySelector<HTMLElement>('.pt-item.on') ?? pane.querySelector<HTMLElement>('.pt-item'))?.focus({ preventScroll: true });
  }
  pane.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && body.classList.contains('pt-drawer-open')) {
      e.stopPropagation();
      drawer(false);
      navBtn.focus();
    }
  });

  function pick(it: NavItem) {
    if (mobile()) drawer(false);
    if (it.kind === 'tab') deps.show(it.id as NavTab);
    else deps.run(it.id as NavAction);
  }

  store.on('me', drawGroups);
  readBadges();
  drawGroups();
  drawRail();
  drawSelected();
  return {
    selected(tab) {
      if (tab === current) return;
      current = tab;
      const next = revealGroup(state, tab);
      if (next !== state) ((state = next), saveState(state));
      drawGroups();
      drawSelected();
      syncFlyout();
    },
    drawer,
  };
}
