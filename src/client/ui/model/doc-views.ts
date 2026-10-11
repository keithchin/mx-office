// The visual tabs next to the MDL for documents the server sends as MDL. Pages, snippets and layouts get
// "Structure | Preview | MDL": Structure is the wireframe of their widgets (page-view.ts), Preview the page as
// the running app would look, with sample data (page-frame.ts). The navigation gets "Navigation | MDL"
// (nav-view.ts). The choice is per viewer, remembered in this browser; Structure is the default. A view is
// worked out only when it's the one on screen. A small "Live app" link sits beside the switch for pages.

import type { TextDoc } from '../../../shared/model';
import { h } from '../dom';
import type { MdlItem } from './mdl-tree';
import { navProfiles, navView } from './nav-view';
import { pageFrame, type Fetch, type PageFrame } from './page-frame';
import { pageView, type PageView } from './page-view';

const KEY = 'agent-office.model.docview';
const PAGES = new Set(['page', 'snippet', 'layout', 'buildingblock']);
const NAV = new Set(['navigation', 'navprofile']);

/** What's on screen: the structure wireframe ('page'), the preview, or the navigation. */
export type Visual = 'page' | 'preview' | 'nav';
export type Mode = 'structure' | 'preview' | 'mdl';

/** Which kind of visual view a document has, if any. */
export const visualOf = (type: string): 'page' | 'nav' | null => (PAGES.has(type) ? 'page' : NAV.has(type) ? 'nav' : null);

/** The remembered mode ('visual', from before Preview came, is Structure). */
export function recallMode(store: Pick<Storage, 'getItem'> | null = typeof localStorage === 'undefined' ? null : localStorage): Mode {
  try {
    const v = store?.getItem(KEY);
    return v === 'mdl' ? 'mdl' : v === 'preview' ? 'preview' : 'structure';
  } catch {
    return 'structure';
  }
}
const remember = (m: Mode) => {
  try {
    localStorage.setItem(KEY, m);
  } catch {
    // just for this visit, then
  }
};

export interface DocViewEvents {
  /** The viewer switched views: draw the document again. */
  switched(): void;
  /** A widget was picked in the Structure view (null: none). */
  select(item: MdlItem | null): void;
  open(type: string, qn: string): void;
  /** A snippet's, layout's or the navigation's MDL, for the Preview (null when there's none). */
  fetch: Fetch;
}

export interface DocViews {
  /** The switch for the bar (hidden unless the open document has a visual view), and the Live app link. */
  readonly seg: HTMLElement;
  /** The views' hosts, for the stage. */
  readonly hosts: HTMLElement[];
  readonly page: PageView;
  readonly preview: PageFrame;
  /** The visual view on screen, if any. */
  readonly active: Visual | null;
  /** Shows `doc` in its visual view when it has one and that's chosen; false: show its MDL. */
  show(doc: TextDoc): boolean;
  /** Another kind of document: the switch and the views go. */
  hide(): void;
}

export function docViews(on: DocViewEvents): DocViews {
  let mode = recallMode();
  let active: Visual | null = null;
  const page = pageView({ select: (it) => on.select(it) });
  const preview = pageFrame(on.fetch);
  const nav = h('div.nv-host');
  nav.hidden = true;
  const btn = (m: Mode, label: string, title: string) => h('button.btn', { type: 'button', title, onclick: () => set(m) }, label);
  const structureBtn = btn('structure', 'Structure', 'The page\'s widgets laid out as a wireframe');
  const previewBtn = btn('preview', 'Preview', 'How the running app would show the page, with sample data');
  const mdlBtn = btn('mdl', 'MDL', 'The page\'s MDL');
  const live = h('button.mx-link.mx-live-link', { type: 'button', title: 'Open the Live app, where the page runs', onclick: () => document.getElementById('tab-live')?.click() }, 'Live app ↗');
  const switcher = h('span.mx-seg', { role: 'group', 'aria-label': 'View' }, structureBtn, previewBtn, mdlBtn);
  const seg = h('span.mx-views', {}, switcher, live);
  seg.hidden = true;
  let isNav = false;

  function paint() {
    const shown: Mode = isNav && mode === 'preview' ? 'structure' : mode;
    for (const [b, m] of [[structureBtn, 'structure'], [previewBtn, 'preview'], [mdlBtn, 'mdl']] as const) {
      b.classList.toggle('on', shown === m);
      b.setAttribute('aria-pressed', String(shown === m));
    }
    previewBtn.hidden = isNav;
    live.hidden = isNav;
  }
  function set(m: Mode) {
    if (m === mode) return;
    mode = m;
    remember(m);
    paint();
    on.switched();
  }

  return {
    seg,
    hosts: [page.el, preview.el, nav],
    page,
    preview,
    get active() {
      return active;
    },
    show(doc: TextDoc) {
      const kind = visualOf(doc.type);
      isNav = kind === 'nav';
      seg.hidden = !kind || !doc.mdl;
      structureBtn.textContent = isNav ? 'Navigation' : 'Structure';
      structureBtn.title = isNav ? 'The profiles, their home pages and menus' : 'The page\'s widgets laid out as a wireframe';
      paint();
      active = null;
      page.clear();
      preview.clear();
      nav.hidden = true;
      if (!kind || !doc.mdl || mode === 'mdl') return false;
      if (kind === 'nav') {
        nav.replaceChildren(navView(navProfiles(doc.mdl), { open: on.open }));
        nav.hidden = false;
        active = 'nav';
      } else if (mode === 'preview') {
        if (!preview.show(doc.mdl)) return false;
        active = 'preview';
      } else {
        if (!page.show(doc.mdl)) return false;
        active = 'page';
      }
      return true;
    },
    hide() {
      seg.hidden = true;
      active = null;
      page.clear();
      preview.clear();
      nav.hidden = true;
    },
  };
}
