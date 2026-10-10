// The visual tab next to the MDL for documents the server sends as MDL: pages, snippets and layouts get
// "Page | MDL" (page-view.ts, the structure preview), the navigation "Navigation | MDL" (nav-view.ts). The
// choice is per viewer, remembered in this browser; the visual view is the default. The visual view is
// worked out only when it's the one on screen.

import type { TextDoc } from '../../../shared/model';
import { h } from '../dom';
import type { MdlItem } from './mdl-tree';
import { navProfiles, navView } from './nav-view';
import { pageView, type PageView } from './page-view';

const KEY = 'agent-office.model.docview';
const PAGES = new Set(['page', 'snippet', 'layout', 'buildingblock']);
const NAV = new Set(['navigation', 'navprofile']);

export type Visual = 'page' | 'nav';

/** Which visual view a document has, if any. */
export const visualOf = (type: string): Visual | null => (PAGES.has(type) ? 'page' : NAV.has(type) ? 'nav' : null);

const recall = (): boolean => {
  try {
    return localStorage.getItem(KEY) !== 'mdl';
  } catch {
    return true;
  }
};
const remember = (visual: boolean) => {
  try {
    localStorage.setItem(KEY, visual ? 'visual' : 'mdl');
  } catch {
    // just for this visit, then
  }
};

export interface DocViewEvents {
  /** The viewer switched between the visual view and the MDL: draw the document again. */
  switched(): void;
  /** A widget was picked in the Page view (null: none). */
  select(item: MdlItem | null): void;
  open(type: string, qn: string): void;
}

export interface DocViews {
  /** The toggle for the bar (hidden unless the open document has a visual view). */
  readonly seg: HTMLElement;
  /** The views' hosts, for the stage. */
  readonly hosts: HTMLElement[];
  readonly page: PageView;
  /** The visual view on screen, if any. */
  readonly active: Visual | null;
  /** Shows `doc` in its visual view when it has one and that's chosen; false: show its MDL. */
  show(doc: TextDoc): boolean;
  /** Another kind of document: the toggle and the views go. */
  hide(): void;
}

export function docViews(on: DocViewEvents): DocViews {
  let visual = recall();
  let active: Visual | null = null;
  const page = pageView({ select: (it) => on.select(it) });
  const nav = h('div.nv-host');
  nav.hidden = true;
  const btn = (isVisual: boolean, label: string) => h('button.btn', { type: 'button', onclick: () => set(isVisual) }, label);
  const visualBtn = btn(true, 'Page');
  const mdlBtn = btn(false, 'MDL');
  const seg = h('span.mx-seg', { role: 'group', 'aria-label': 'View' }, visualBtn, mdlBtn);
  seg.hidden = true;

  function paint() {
    visualBtn.classList.toggle('on', visual);
    mdlBtn.classList.toggle('on', !visual);
    visualBtn.setAttribute('aria-pressed', String(visual));
    mdlBtn.setAttribute('aria-pressed', String(!visual));
  }
  function set(v: boolean) {
    if (v === visual) return;
    visual = v;
    remember(v);
    paint();
    on.switched();
  }
  paint();

  return {
    seg,
    hosts: [page.el, nav],
    page,
    get active() {
      return active;
    },
    show(doc: TextDoc) {
      const kind = visualOf(doc.type);
      seg.hidden = !kind || !doc.mdl;
      visualBtn.textContent = kind === 'nav' ? 'Navigation' : doc.type === 'snippet' ? 'Snippet' : doc.type === 'layout' ? 'Layout' : doc.type === 'buildingblock' ? 'Building block' : 'Page';
      visualBtn.title = kind === 'nav' ? 'The profiles, their home pages and menus' : 'A structure preview of the page (not the running page)';
      active = null;
      page.clear();
      nav.hidden = true;
      if (!kind || !doc.mdl || !visual) return false;
      if (kind === 'page') {
        if (!page.show(doc.mdl)) return false;
      } else {
        nav.replaceChildren(navView(navProfiles(doc.mdl), { open: on.open }));
        nav.hidden = false;
      }
      active = kind;
      return true;
    },
    hide() {
      seg.hidden = true;
      active = null;
      page.clear();
      nav.hidden = true;
    },
  };
}
