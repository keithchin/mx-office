// The Preview on screen: page-preview.ts's HTML in a sandboxed frame (its own opaque origin; a
// Content-Security-Policy that fetches nothing), so neither its CSS nor anything in a page's text can reach the
// office. A Desktop / Tablet / Phone switch sets the frame's width. Snippets, the layout and the navigation menu
// are asked for (`fetch`) only while the Preview is on screen, and the page is drawn again as they arrive; each
// is read once (page-model.ts) and kept until `forget` (another revision).
//
// Under the bar, one line says what the drawing left out or labelled (nothing disappears silently): widgets
// it can't draw (by type), conditional parts tagged, cases and rows not drawn, a cut past the budget.
//
// With `pick` (the Developer view), the frame also runs Select element (preview-pick.ts): the frame gets
// `allow-scripts` and nothing else, the page's own script is allowed by a nonce per document, and the two talk by
// checked postMessage. The selection is kept here by document + widget name: drawn again (the layout arriving,
// another revision), it's found again by name, or said to be gone. Without `pick` (the Model tab) the frame is
// `sandbox=""` with no script at all.

import { h } from '../dom';
import { navProfiles } from './nav-view';
import { pageModel, type PageModel } from './page-model';
import { previewDocument, previewRender, wants, type PreviewContext, type PreviewElement, type PreviewReport } from './page-preview';
import { acceptPick, newNonce, PICK_SCRIPT } from './preview-pick';

export type Fetch = (type: string, qn: string) => Promise<string | null>;

const WIDTHS = { desktop: 0, tablet: 820, phone: 390 } as const;
type Width = keyof typeof WIDTHS;
const KEY = 'agent-office.model.previewwidth';

/** The picked widget, as the page keeps it (found again by document + name after a redraw). */
export interface PickedElement extends PreviewElement {
  /** The page it was picked on, and its title. */
  page: string;
  pageTitle: string;
  /** Not on the page as drawn now (renamed or removed at this revision). */
  gone?: boolean;
}

export interface PickOptions {
  /** The selection changed (null: cleared). */
  change(sel: PickedElement | null): void;
  /** The project's layout CSS for this page, when it can be read (asked once per revision). */
  theme?(qn: string): Promise<string | undefined>;
}

export interface PageFrame {
  readonly el: HTMLElement;
  /** Draws the page in `mdl`; false when it isn't a page. */
  show(mdl: string): boolean;
  clear(): void;
  /** Another revision: what was read for the last one is let go. */
  forget(): void;
  /** How long the last drawing took (ms: reading the MDL and writing the HTML). */
  readonly lastMs: number;
  /** What the last drawing left out or labelled. */
  readonly report: PreviewReport | undefined;
  /** Select element: the widget picked, if any. */
  readonly selected: PickedElement | null;
  /** Turns picking on or off (from a button, or a test). */
  picking(on: boolean): void;
  /** Clears the selection. */
  unselect(): void;
}

/** "3 widget types not drawn (fileuploader ×3) · 57 conditional parts tagged …": what the drawing says it left out. */
export function reportWords(r: PreviewReport | undefined): string {
  if (!r) return '';
  const parts: string[] = [];
  if (r.placeholders.length) parts.push(`Not drawn, shown as labelled boxes: ${r.placeholders.map((p) => `${p.kind}${p.count > 1 ? ` ×${p.count}` : ''}`).join(', ')}`);
  if (r.conditions) parts.push(`${r.conditions} conditional part${r.conditions === 1 ? '' : 's'} tagged “Shown when…” (not worked out)${r.casesNotDrawn ? `, ${r.casesNotDrawn} other case${r.casesNotDrawn === 1 ? '' : 's'} named, not drawn` : ''}`);
  if (r.rowsNotDrawn) parts.push('nested lists show fewer sample rows');
  if (r.cut) parts.push(`${r.cut} widgets past the preview limit not drawn`);
  return parts.join(' · ');
}

export function pageFrame(fetch: Fetch, pick?: PickOptions): PageFrame {
  let docs = new Map<string, PageModel | null>();
  let asked = new Set<string>();
  let menu: string[] | undefined;
  let menuAsked = false;
  let themes = new Map<string, string | null>();
  let current: string | null = null;
  let model: PageModel | null = null;
  let report: PreviewReport | undefined;
  let lastMs = 0;
  let width: Width = 'desktop';
  let on = false;
  let selected: PickedElement | null = null;
  try {
    const w = localStorage.getItem(KEY) as Width | null;
    if (w && w in WIDTHS) width = w;
  } catch {
    // the default, then
  }
  const newFrame = () => h('iframe.pgp-frame', { sandbox: pick ? 'allow-scripts' : '', referrerpolicy: 'no-referrer', title: 'Page preview' }) as HTMLIFrameElement;
  let frame = newFrame();
  /** The frame on screen has had a document (a fresh one is needed for the next). */
  let used = false;
  const btns = (Object.keys(WIDTHS) as Width[]).map((w) => h('button.btn', { type: 'button', 'aria-pressed': String(w === width), onclick: () => setWidth(w) }, w[0].toUpperCase() + w.slice(1)));
  const pickBtn = h('button.btn.pgp-pick', { type: 'button', 'aria-pressed': 'false', title: 'Point at a widget on the preview to ask for a change to it (Esc leaves)', onclick: () => setPicking(!on, true) }, '⌖ Select element');
  const stage = h('div.pgp-stage', {}, frame);
  const said = h('p.pgp-report', { role: 'note' });
  const el = h(
    'div.pgp-host',
    {},
    h('div.pgp-bar', {}, h('span.mx-seg', { role: 'group', 'aria-label': 'Width' }, ...btns), pick ? pickBtn : '', h('span.pgp-note', {}, 'Sample data · drawn from the model')),
    said,
    stage,
  );
  el.hidden = true;

  function setWidth(w: Width) {
    width = w;
    try {
      localStorage.setItem(KEY, w);
    } catch {
      // just for this visit
    }
    paintWidth();
    // Drawn again at the new width in a fresh frame (a sandboxed frame resized in place can stay blank).
    if (current) {
      frame.removeAttribute('srcdoc');
      draw(current);
    }
  }
  function paintWidth() {
    btns.forEach((b, i) => {
      const isOn = (Object.keys(WIDTHS) as Width[])[i] === width;
      b.classList.toggle('on', isOn);
      b.setAttribute('aria-pressed', String(isOn));
    });
    frame.style.width = WIDTHS[width] ? `${WIDTHS[width]}px` : '100%';
    stage.classList.toggle('pgp-narrow', !!WIDTHS[width]);
  }
  paintWidth();

  const ctx = (): PreviewContext => {
    const theme = model ? themes.get(model.name) : undefined;
    return { docs, menu, ...(pick ? { marks: true } : {}), ...(theme ? { theme } : {}) };
  };

  /**
   * Puts `html` on screen. A sandboxed frame given a second srcdoc in Chromium loads it but is never painted
   * again (it shows blank until something resizes it), so each new document gets a fresh frame, and the same
   * document isn't set again.
   */
  function setDoc(html: string) {
    if (frame.getAttribute('srcdoc') === html) return;
    if (used) {
      const next = newFrame();
      next.style.width = frame.style.width;
      frame.replaceWith(next);
      frame = next;
    }
    frame.srcdoc = html;
    used = true;
  }

  function draw(mdl: string): boolean {
    const t = performance.now();
    const m = pageModel(mdl);
    if (!m) return false;
    if (model && model.name !== m.name && selected) {
      selected = null;
      pick?.change(null);
    }
    model = m;
    const c = ctx();
    const r = previewRender(m, c);
    report = r.report;
    const nonce = pick ? newNonce() : undefined;
    setDoc(previewDocument(r.html, m.name, { ...(c.theme ? { theme: c.theme } : {}), ...(pick && nonce ? { script: PICK_SCRIPT, nonce } : {}) }));
    lastMs = performance.now() - t;
    said.textContent = reportWords(report);
    said.hidden = !said.textContent;
    if (pick) refind();
    void more(m, mdl);
    return true;
  }

  /** After a redraw: the selection found again by document + name, or marked gone. */
  function refind() {
    if (!selected || !report || !model) return;
    const again = report.elements.find((e) => e.docQn === selected!.docQn && e.name === selected!.name);
    const next: PickedElement = again ? { ...again, page: model.name, pageTitle: titleOf(model) } : { ...selected, gone: true };
    if (!again) delete (next as { el?: number }).el;
    const changed = !!selected.gone !== !!next.gone || selected.label !== next.label;
    selected = next;
    if (changed) pick?.change(selected);
  }

  /** What the page needs that isn't read yet (its layout, snippets, the menu, the theme): asked for, then drawn again. */
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
    if (pick?.theme && m.kind === 'page' && !themes.has(m.name)) {
      themes.set(m.name, null);
      const mine = themes;
      jobs.push(
        pick
          .theme(m.name)
          .catch(() => undefined)
          .then((css) => void (css && mine === themes && themes.set(m.name, css))),
      );
    }
    if (!jobs.length) return;
    await Promise.all(jobs);
    if (current === mdl) draw(mdl);
  }

  // ---- Select element ------------------------------------------------------------------------------------
  const titleOf = (m: PageModel) => m.title ?? m.name.slice(m.name.indexOf('.') + 1);
  const tell = (msg: Record<string, unknown>) => frame.contentWindow?.postMessage({ mx: 'pick-cmd', ...msg }, '*');
  function setPicking(v: boolean, focus = false) {
    on = v;
    pickBtn.classList.toggle('on', v);
    pickBtn.setAttribute('aria-pressed', String(v));
    el.classList.toggle('pgp-picking', v);
    tell({ on: v, focus });
    if (v && focus) frame.focus();
    if (!v && focus) pickBtn.focus();
  }
  if (pick) {
    window.addEventListener('message', (e) => {
      const msg = acceptPick(e, frame.contentWindow, report?.elements ?? []);
      if (!msg) return;
      if (msg.type === 'ready') return tell({ on, sel: selected && !selected.gone ? (selected.el ?? null) : null });
      if (msg.type === 'leave') return setPicking(false, true);
      if (msg.type === 'select' && model) {
        selected = { ...msg.el, page: model.name, pageTitle: titleOf(model) };
        pick.change(selected);
      }
    });
  }

  return {
    el,
    get lastMs() {
      return lastMs;
    },
    get report() {
      return report;
    },
    get selected() {
      return selected;
    },
    picking: (v) => setPicking(v, false),
    unselect() {
      selected = null;
      tell({ sel: null });
      pick?.change(null);
    },
    show(mdl: string) {
      current = mdl;
      el.hidden = false;
      const ok = draw(mdl);
      el.hidden = !ok;
      return ok;
    },
    clear() {
      current = null;
      el.hidden = true;
      frame.removeAttribute('srcdoc');
    },
    forget() {
      docs = new Map();
      asked = new Set();
      themes = new Map();
      menu = undefined;
      menuAsked = false;
    },
  };
}
