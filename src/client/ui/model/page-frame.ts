// The Preview on screen: page-preview.ts's HTML in a sandboxed frame (`sandbox=""`: no scripts, no forms, its
// own opaque origin; a Content-Security-Policy that fetches nothing), so neither its CSS nor anything in a
// page's text can reach the office. A Desktop / Tablet / Phone switch sets the frame's width. Snippets, the
// layout and the navigation menu are asked for (`fetch`) only while the Preview is on screen, and the page
// is drawn again as they arrive; each is read once (page-model.ts) and kept for the visit.

import { h } from '../dom';
import { navProfiles } from './nav-view';
import { pageModel, type PageModel } from './page-model';
import { previewBody, previewDocument, wants, type PreviewContext } from './page-preview';

export type Fetch = (type: string, qn: string) => Promise<string | null>;

const WIDTHS = { desktop: 0, tablet: 820, phone: 390 } as const;
type Width = keyof typeof WIDTHS;
const KEY = 'agent-office.model.previewwidth';

export interface PageFrame {
  readonly el: HTMLElement;
  /** Draws the page in `mdl`; false when it isn't a page. */
  show(mdl: string): boolean;
  clear(): void;
  /** How long the last drawing took (ms: reading the MDL and writing the HTML). */
  readonly lastMs: number;
}

export function pageFrame(fetch: Fetch): PageFrame {
  const docs = new Map<string, PageModel | null>();
  const asked = new Set<string>();
  let menu: string[] | undefined;
  let menuAsked = false;
  let current: string | null = null;
  let lastMs = 0;
  let width: Width = 'desktop';
  try {
    const w = localStorage.getItem(KEY) as Width | null;
    if (w && w in WIDTHS) width = w;
  } catch {
    // the default, then
  }
  const frame = h('iframe.pv-frame', { sandbox: '', referrerpolicy: 'no-referrer', title: 'Page preview' }) as HTMLIFrameElement;
  const btns = (Object.keys(WIDTHS) as Width[]).map((w) => h('button.btn', { type: 'button', 'aria-pressed': String(w === width), onclick: () => setWidth(w) }, w[0].toUpperCase() + w.slice(1)));
  const stage = h('div.pv-stage', {}, frame);
  const el = h('div.pv-host', {}, h('div.pv-bar', {}, h('span.mx-seg', { role: 'group', 'aria-label': 'Width' }, ...btns), h('span.pv-note', {}, 'Sample data · drawn from the model')), stage);
  el.hidden = true;

  function setWidth(w: Width) {
    width = w;
    try {
      localStorage.setItem(KEY, w);
    } catch {
      // just for this visit
    }
    paintWidth();
  }
  function paintWidth() {
    btns.forEach((b, i) => {
      const on = (Object.keys(WIDTHS) as Width[])[i] === width;
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', String(on));
    });
    frame.style.width = WIDTHS[width] ? `${WIDTHS[width]}px` : '100%';
    stage.classList.toggle('pv-narrow', !!WIDTHS[width]);
  }
  paintWidth();

  const ctx = (): PreviewContext => ({ docs, menu });

  function draw(mdl: string): boolean {
    const t = performance.now();
    const m = pageModel(mdl);
    if (!m) return false;
    frame.srcdoc = previewDocument(previewBody(m, ctx()), m.name);
    lastMs = performance.now() - t;
    void more(m, mdl);
    return true;
  }

  /** What the page needs that isn't read yet (its layout, snippets, the menu): asked for, then drawn again. */
  async function more(m: PageModel, mdl: string) {
    const need = wants(m, ctx()).filter((w) => !asked.has(w.qn));
    const jobs: Promise<void>[] = need.map(async (w) => {
      asked.add(w.qn);
      const text = await fetch(w.type, w.qn).catch(() => null);
      docs.set(w.qn, text ? pageModel(text) : null);
    });
    if (!menuAsked && m.kind === 'page') {
      menuAsked = true;
      jobs.push(
        fetch('navigation', 'Navigation')
          .then((t) => void (menu = t ? navProfiles(t)[0]?.menu.map((i) => i.caption).filter(Boolean) : undefined))
          .catch(() => undefined),
      );
    }
    if (!jobs.length) return;
    await Promise.all(jobs);
    if (current === mdl) draw(mdl);
  }

  return {
    el,
    get lastMs() {
      return lastMs;
    },
    show(mdl: string) {
      current = mdl;
      const ok = draw(mdl);
      el.hidden = !ok;
      return ok;
    },
    clear() {
      current = null;
      el.hidden = true;
      frame.removeAttribute('srcdoc');
    },
  };
}
