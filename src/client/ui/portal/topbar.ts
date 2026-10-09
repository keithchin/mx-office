// The Portal themes' top bar (styles/theme-portal-parts.css, ./topbar.css): the flat pages' own bar
// (.lite-bar), drawn like a low-code platform's portal header. Its pieces are added here on every flat
// page that has one (the 1D and 2D views, Home, The Firm) and shown only while a Portal theme is on, so
// switching themes is CSS alone and the other themes' bars stay exactly as they were:
//
//   ⋮⋮⋮ launcher · "Mx Office" | SECTION · [ search ] · bell · help · dark mode · 🎨 · avatar (☰)
//
// - The launcher opens a menu of where to go: Home's projects, every project, The Firm, the docs and
//   Settings.
// - The wordmark goes Home; the section is the page's name in capitals (PROJECTS on Home), or the floor
//   picker on the 2D view, drawn as a capitalised title (on the 1D view the page's name: the floor picker
//   is in the left navigation's project card there, ./layout.ts).
// - The search (./search.ts) finds a project, a page of this project (or a tab of this page), its agents,
//   issues and pull requests (the page says, opts.search), a page of the office or a docs page.
// - The bell opens the team phone and shows its count (pages with the phone); the ? opens the docs;
//   the moon switches between Portal (Light) and Portal (Dark); the 🎨 still lists every theme, and the
//   ☰ (the office's menu, with Settings and the rest) is drawn as your initials, like a profile menu.
// Everything the bar had stays where it was in the page, so every function is still reachable; the 1D
// view's left navigation, page header and Overview are ./layout.ts.

import { store } from '../../state';
import { rememberFloor } from '../../state/persist';
import { settingsHref } from '../../../shared/settings-sections';
import { h } from '../dom';
import { currentTheme, DARK_TWIN, isDarkTheme, onThemeChange, pickTheme } from '../colortheme';
import { icon } from './icons';
import { openPop, type PopItem } from './pop';
import { portalSearch } from './search';
import { tabLabel, type SearchItem } from './search-logic';
import './topbar.css';

export interface PortalBarOpts {
  /** The page's name for the bar, in capitals (Home: "Projects"). Left out on a floor's pages, whose floor picker is the section. */
  section?: string;
  /** The wordmark clicked on the page it leads to (Home: back to the projects, rather than a reload). */
  onHome?: () => void;
  /** Settings, as the page opens it (the 1D view's tab; elsewhere its address). */
  settings?: () => void;
  /** What else the search finds on this page (the 1D view: its pages, agents, issues and pull requests), in place of the tab row's buttons. */
  search?: () => SearchItem[];
}

/** A floor's 1D board. */
const floorHref = (id: string) => `/lite?floor=${encodeURIComponent(id)}`;
const goFloor = (id: string) => {
  rememberFloor(id);
  location.assign(floorHref(id));
};

/** The initials for the avatar: "Ada Lovelace" → "AL", "ada" → "A". */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return '?';
  const first = [...words[0]][0] ?? '';
  const last = words.length > 1 ? ([...words[words.length - 1]][0] ?? '') : '';
  return (first + last).toUpperCase();
}

/** The office's pages, for the launcher and the search. */
function pages(opts: PortalBarOpts): { label: string; hint: string; href: string; run?: () => void }[] {
  return [
    { label: 'Projects', hint: 'Home: every project', href: '/home', run: location.pathname === '/home' ? opts.onHome : undefined },
    { label: 'The Firm', hint: 'Independent Reviewer Agents', href: '/firm' },
    { label: 'Documentation', hint: 'Guides, reference and FAQ', href: '/docs' },
    { label: 'Settings', hint: 'You, the workers, the team, the look', href: settingsHref(undefined, store.floor ?? undefined), run: opts.settings },
  ];
}

/** Adds the Portal pieces to the page's `.lite-bar` (once). */
export function portalBar(opts: PortalBarOpts = {}) {
  const bar = document.querySelector<HTMLElement>('.lite-bar');
  if (!bar || bar.querySelector('.pt-launch')) return;
  bar.classList.add('pt-bar');

  // ---- Left: the launcher, the wordmark and the section -------------------------------------------
  const launch = h('button.pt-iconbtn.pt-launch.pt-only', { type: 'button', 'aria-label': 'Go to', title: 'Go to: projects, The Firm, docs, settings', 'aria-haspopup': 'menu', 'aria-expanded': 'false' }, icon('launcher'));
  launch.addEventListener('click', () => {
    const items: PopItem[] = [{ label: 'Go to', heading: true }, ...pages(opts).map((p) => ({ label: p.label, hint: p.hint, href: p.href, run: p.run }))];
    const floors = store.floors.filter((f) => !f.cloning);
    if (floors.length) {
      items.push({ label: 'Projects', heading: true });
      for (const f of floors.slice(0, 12)) items.push({ label: f.name, hint: f.id === store.floor && location.pathname !== '/home' ? 'You’re here' : undefined, href: floorHref(f.id), run: () => goFloor(f.id) });
      if (floors.length > 12) items.push({ label: `All ${floors.length} projects…`, href: '/home', run: location.pathname === '/home' ? opts.onHome : undefined });
    }
    openPop(launch, items, { label: 'Go to', cls: 'pt-launcher' });
  });
  const brand = h('a.pt-brand.pt-only', { href: '/home', title: 'Mx Office: every project', 'aria-label': 'Mx Office: home' }, h('span.pt-wordmark', {}, 'Mx', h('b', {}, 'Office')));
  if (opts.onHome) {
    const home = opts.onHome;
    brand.addEventListener('click', (e) => {
      e.preventDefault();
      home();
    });
  }
  const sep = h('span.pt-sep.pt-only', { 'aria-hidden': 'true' });
  const section = opts.section ? h('span.pt-section.pt-only', {}, opts.section) : null;
  bar.prepend(launch, brand, sep, ...(section ? [section] : []));

  // ---- The middle: the search ---------------------------------------------------------------------
  const search = portalSearch(bar, () => searchSources(opts));
  (section ?? sep).after(search);
  // On a floor's pages the floor picker is the section: it goes right after the wordmark.
  const floor = bar.querySelector<HTMLElement>('.lite-floor');
  if (floor && !section) sep.after(floor);

  // ---- Right: notifications, help, dark mode, and the ☰ as your avatar -----------------------------
  const help = h('a.pt-iconbtn.pt-help.pt-only', { href: '/docs', title: 'Help: the documentation', 'aria-label': 'Help: the documentation' }, icon('help'));
  const dark = h('button.pt-iconbtn.pt-dark.pt-only', { type: 'button', 'aria-pressed': 'false' }, icon('moon', 'pt-moon'), icon('sun', 'pt-sun'));
  const drawDark = () => {
    const on = isDarkTheme(currentTheme());
    dark.setAttribute('aria-pressed', String(on));
    dark.setAttribute('aria-label', 'Dark mode');
    dark.title = on ? 'Dark mode is on: switch to light' : 'Switch to dark mode';
  };
  dark.addEventListener('click', () => {
    pickTheme(DARK_TWIN[currentTheme()]);
    drawDark();
  });
  onThemeChange(drawDark);
  drawDark();
  const icons = h('div.pt-icons.pt-only', {}, phoneBell(), help, dark);
  const theme = bar.querySelector('#theme');
  if (theme) theme.before(icons);
  else bar.append(icons);

  const menu = bar.querySelector<HTMLElement>('#menu');
  if (menu) {
    menu.classList.add('pt-avatar');
    const drawMe = () => {
      menu.dataset.ptInitials = initials(store.profile.name);
      menu.style.setProperty('--pt-me', store.profile.color);
    };
    drawMe();
    store.on('me', drawMe);
  }
}

/** The bell: opens the team phone (ui/phone/) and shows its badge, on pages that have it (its floating button stays too). */
function phoneBell(): HTMLElement | null {
  const launcher = document.querySelector<HTMLButtonElement>('button.tp-launch');
  if (!launcher) return null;
  const count = h('span.pt-count', { 'aria-hidden': 'true' });
  const bell = h('button.pt-iconbtn.pt-bell', { type: 'button', title: 'Notifications: the team phone', 'aria-haspopup': 'dialog' }, icon('bell'), count);
  bell.addEventListener('click', () => launcher.click());
  const badge = launcher.querySelector<HTMLElement>('.tp-badge');
  const draw = () => {
    const n = (badge?.textContent ?? '').trim();
    count.textContent = n;
    count.hidden = !n;
    bell.setAttribute('aria-label', n ? `Notifications: ${n} new on the team phone` : 'Notifications: the team phone');
  };
  if (badge) new MutationObserver(draw).observe(badge, { childList: true, characterData: true, subtree: true });
  draw();
  return bell;
}

/** A tab button's own words, not its badge's count (a child of it). */
const ownText = (b: Element) => [...b.childNodes].filter((n) => n.nodeType === Node.TEXT_NODE).map((n) => n.textContent ?? '').join('');

/** What the search looks through: the tabs on this page, every project, the office's pages. */
function searchSources(opts: PortalBarOpts): SearchItem[] {
  const projects = store.floors
    .filter((f) => !f.cloning)
    .map((f): SearchItem => ({ kind: 'project', label: f.name, hint: f.repo ?? undefined, also: `${f.repo ?? ''} ${f.id}`, go: () => goFloor(f.id) }));
  const pageItems = pages(opts).map((p): SearchItem => ({ kind: 'page', label: p.label, hint: p.hint, go: () => (p.run ? p.run() : location.assign(p.href)) }));
  if (opts.search) return [...projects, ...opts.search(), ...pageItems];
  const where = location.pathname === '/home' ? 'Home' : store.floors.find((f) => f.id === store.floor)?.name;
  const tabs = [...document.querySelectorAll<HTMLButtonElement>('.lite-tabs [role=tab], .home-tabs [role=tab]')]
    .filter((b) => !b.hidden && !b.classList.contains('hidden'))
    .map((b): SearchItem => ({ kind: 'tab', label: tabLabel(ownText(b)), hint: where, go: () => b.click() }))
    .filter((t) => t.label);
  return [...projects, ...tabs, ...pageItems];
}
