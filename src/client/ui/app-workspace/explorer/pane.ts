// What the explorer opens in the canvas's place, read-only, at the revision the explorer shows (main's newest
// unless the viewer picked another): never the running app. A page shows its Model preview (the Model tab's
// Preview: drawn from the model with sample data, in its own sandboxed frame, labelled as not the running
// app); a part of the app's data shows its diagram with the record picked; logic shows its diagram; a
// document shows its card (./doc-card.ts: dates from git, relationships, status only from a real source); a
// project file (all-files view) shows its text or picture. Seeing a page in the running app is a separate
// action (the bar's Open in the live app). The live app's frame is only hidden meanwhile (never taken out,
// which would reload it).

import { h } from '../../dom';
import type { DomainDoc, FlowDoc } from '../../../../shared/model';
import { shortSha, type ExplorerFile, type ExplorerNode } from '../../../../shared/app-explorer';
import type { DocEntry, DocumentsView } from '../../../../shared/app-documents';
import { docCard } from './doc-card';
import { modelApi } from '../../model/api';
import { Canvas } from '../../model/canvas';
import { drawDomain } from '../../model/domain-draw';
import { drawFlow } from '../../model/flow-draw';
import { pageFrame, type PageFrame } from '../../model/page-frame';
import type { PageFacts } from '../../../../shared/page-facts';
import { elementContext, type ElementContext } from './element-ref';
import '../../model/model.css';
import '../../model/page.css';
import './pick.css';

const DARK = new Set(['dark', 'terminal', 'clean-dark', 'portal-dark']);

export interface PaneDeps {
  floor(): string | null;
  rev(): string | undefined;
  /** Closes the pane (back to the live app, when it runs). */
  back(): void;
  /** Whether the live app is up in the canvas (the close button says where it goes back to). */
  live?(): boolean;
  /** Opens another document from a document's card. */
  openEntry?(id: string): void;
  file(path: string): Promise<ExplorerFile>;
  /** A page's facts at the revision shown (widget $Type/$ID, shared snippets, the theme's layout classes). */
  facts?(qn: string): Promise<PageFacts | undefined>;
  /** Request a change about the page shown, or the widget picked on it. */
  request?(c: PaneRequest): void;
  /** For tests: the Model tab's requests. */
  api?: Pick<typeof modelApi, 'doc'>;
}

/** A request from the Model preview: the page (and widget) as context, at the revision viewed. */
export interface PaneRequest {
  node: ExplorerNode;
  element: ElementContext;
  rev: string;
}

export interface Pane {
  readonly el: HTMLElement;
  /** Shows `n` (a page's Model preview, data, logic or a file). */
  show(n: ExplorerNode, label?: string, why?: string): void;
  /** Shows a document's card. */
  showDoc(e: DocEntry, view: DocumentsView): void;
  /** What's shown, if anything. */
  readonly node: ExplorerNode | undefined;
  /** The context for a request about what's shown (the page, and the widget picked on it), when it's a page. */
  element(): ElementContext | undefined;
  /** The Model preview's frame (tests, Select element). */
  readonly preview: PageFrame;
}

export function docPane(deps: PaneDeps): Pane {
  const api = deps.api ?? modelApi;
  const title = h('b.ax-pane-title');
  const note = h('p.ax-pane-note', { role: 'status' });
  const backBtn = h('button.aw-btn.ax-back', { type: 'button', onclick: () => deps.back() }, '← Close');
  const stage = h('div.mx-stage.ax-stage');
  const text = h('pre.ax-text');
  const img = h('img.ax-img', { alt: '' }) as HTMLImageElement;
  const msg = h('p.aw-muted.ax-msg');
  const doc = h('div.ax-docwrap');
  const canvas = new Canvas(stage, { select: () => undefined });
  /** The page's facts at the revision shown (asked once per page and revision: the api keeps them). */
  let facts: { key: string; v?: PageFacts | undefined } | undefined;
  const factsOf = (qn: string): Promise<PageFacts | undefined> => {
    const key = `${deps.rev()}\0${qn}`;
    if (!deps.facts) return Promise.resolve(undefined);
    return deps
      .facts(qn)
      .catch(() => undefined)
      .then((v) => {
        if (`${deps.rev()}\0${qn}` === key) facts = { key, v };
        return v;
      });
  };
  const preview = pageFrame(
    (type, qn) => {
      const f = deps.floor();
      const rev = deps.rev();
      return f && rev ? api.doc(f, rev, type, qn, false).then((r) => (r.doc.kind === 'text' ? r.doc.mdl || null : null)) : Promise.resolve(null);
    },
    { change: () => paintPick(), theme: (qn) => factsOf(qn).then((f) => f?.theme.css || undefined) },
  );
  // The Preview's own note names how it's drawn in engineering words: said plainly here.
  const pnote = preview.el.querySelector('.pgp-note');
  if (pnote) pnote.textContent = 'Model preview (from the model, not the running app) · sample data';
  // Select element's chip: the page › the widget picked (or that it's gone), what else shares it, and Request a change.
  const pickBar = h('div.ax-pick', { 'aria-live': 'polite', hidden: true });
  const body = h('div.ax-pane-body', {}, stage, preview.el, text, img, msg, doc);
  const el = h('section.ax-pane.mxv', { 'aria-label': 'Opened from the explorer', hidden: true }, h('div.ax-pane-bar', {}, backBtn, title), note, pickBar, body);
  let shown: ExplorerNode | undefined;
  let seq = 0;
  let readAt: string | undefined;

  const pageOf = (n: ExplorerNode | undefined) => (n?.type === 'page' && n.qn ? { qn: n.qn, title: n.label } : undefined);
  function element(): ElementContext | undefined {
    const page = pageOf(shown);
    if (!page) return undefined;
    const sel = preview.selected;
    return elementContext(page, sel, facts?.key === `${deps.rev()}\0${page.qn}` ? facts.v : undefined);
  }
  function paintPick() {
    const page = pageOf(shown);
    const sel = preview.selected;
    pickBar.hidden = !page || preview.el.hidden;
    if (pickBar.hidden || !page) return void pickBar.replaceChildren();
    const c = element()!;
    if (sel && deps.facts && facts?.key !== `${deps.rev()}\0${page.qn}`) void factsOf(page.qn).then(() => paintPick());
    const ask = deps.request
      ? h('button.aw-btn.primary.ax-pick-ask', { type: 'button', onclick: () => deps.request!({ node: shown!, element: element()!, rev: deps.rev() ?? '' }) }, sel && !sel.gone ? 'Request a change to this' : 'Request a change to this page')
      : '';
    const chip = sel
      ? h('span.ax-chip', { class: sel.gone ? 'gone' : '', title: c.where }, h('span.ax-chip-text', {}, `${page.title} › ${sel.label}`), sel.gone ? h('span.ax-chip-gone', {}, 'no longer on this page') : '', h('button.ax-chip-x', { type: 'button', 'aria-label': 'Clear the selection', title: 'Clear the selection', onclick: () => preview.unselect() }, '✕'))
      : h('span.ax-pick-hint', {}, 'Use ⌖ Select element to point at a widget, or ask about the whole page.');
    pickBar.replaceChildren(chip, c.impact ? h('span.ax-impact', {}, c.impact) : '', h('span.aw-grow'), ask);
  }

  const paintBack = () => {
    const live = deps.live?.() ?? false;
    backBtn.textContent = live ? '← Back to the live app' : '← Close';
  };
  const theme = () => el.classList.toggle('mx-dark', DARK.has(document.documentElement.dataset.theme ?? ''));
  new MutationObserver(theme).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  theme();

  function only(which: 'stage' | 'preview' | 'text' | 'img' | 'msg' | 'doc') {
    stage.hidden = which !== 'stage';
    doc.hidden = which !== 'doc';
    if (which !== 'doc') doc.replaceChildren();
    if (which !== 'preview') preview.clear();
    text.hidden = which !== 'text';
    paintPick();
    img.hidden = which !== 'img';
    msg.hidden = which !== 'msg';
  }
  const say = (s: string) => ((msg.textContent = s), only('msg'));

  async function load(n: ExplorerNode) {
    const mine = ++seq;
    const f = deps.floor();
    const rev = deps.rev();
    if (!f || !rev) return say('No version of the app to read.');
    say('Reading…');
    try {
      if (n.kind === 'file' && n.path) {
        const file = await deps.file(n.path);
        if (mine !== seq) return;
        if (file.kind === 'text') return void ((text.textContent = file.text ?? ''), only('text'));
        if (file.kind === 'image') return void ((img.src = file.data ?? ''), (img.alt = n.label), only('img'));
        return say(file.kind === 'large' ? `This file is too big to show here (${Math.round(file.size / 1024)} KB).` : 'This file isn’t text or a picture, so it can’t be shown here.');
      }
      if (n.type === 'page' && n.qn) {
        const r = await api.doc(f, rev, 'page', n.qn, false);
        if (mine !== seq) return;
        if (r.doc.kind === 'text' && r.doc.mdl && preview.show(r.doc.mdl)) return void (only('preview'), paintPick());
        return say('This page can’t be previewed here.');
      }
      if ((n.type === 'entity' || n.type === 'domainmodel') && n.qn) {
        const module = n.type === 'entity' ? n.qn.slice(0, n.qn.indexOf('.')) : n.qn;
        const r = await api.doc(f, rev, 'domainmodel', module, false);
        if (mine !== seq) return;
        const d = r.doc as DomainDoc;
        only('stage');
        stage.classList.add('mx-dm');
        stage.classList.remove('mx-nano');
        canvas.show(drawDomain(d));
        const name = n.type === 'entity' ? n.qn.slice(n.qn.indexOf('.') + 1) : '';
        const e = name ? d.entities.find((x) => x.name === name || x.name.endsWith(`.${name}`)) : undefined;
        if (e) canvas.select(e.id, true);
        if (!d.entities.length) say('No records are kept in this part of the app.');
        return;
      }
      if ((n.type === 'microflow' || n.type === 'nanoflow') && n.qn) {
        const r = await api.doc(f, rev, n.type, n.qn, false);
        if (mine !== seq) return;
        only('stage');
        stage.classList.remove('mx-dm');
        stage.classList.toggle('mx-nano', n.type === 'nanoflow');
        canvas.show(drawFlow(r.doc as FlowDoc));
        return;
      }
      say('Nothing to show for this item.');
    } catch {
      if (mine === seq) say('This couldn’t be read just now. Try again in a moment.');
    }
  }

  return {
    el,
    get node() {
      return shown;
    },
    get preview() {
      return preview;
    },
    element,
    show(n, label, why) {
      shown = n;
      // Another revision: what the preview read for the last one (layout, snippets, theme, facts) is let go.
      if (deps.rev() !== readAt) ((readAt = deps.rev()), preview.forget(), (facts = undefined));
      el.hidden = false;
      paintBack();
      const at = shortSha(deps.rev());
      title.textContent = label ?? n.label;
      note.textContent = why ??
        (n.type === 'page'
          ? `Model preview (from the model, not the running app) at ${at}: ${n.qn ?? ''}. Sample data; conditions aren’t worked out.${n.url ? ` In the live app it opens at ${n.url}: use Open in the live app.` : ' It opens from another page of the app.'}`
          : n.type === 'entity' || n.type === 'domainmodel'
            ? `The records this part of the app keeps and how they relate, at ${at}. Read-only.`
            : n.type === 'microflow' || n.type === 'nanoflow'
              ? `What the app does, step by step, at ${at}. Read-only.`
              : `A file of the project at ${at}. Read-only.`);
      void load(n);
    },
    showDoc(e, view) {
      shown = { id: `doc:${e.id}`, label: e.title, kind: 'doc' };
      seq++;
      el.hidden = false;
      paintBack();
      title.textContent = e.title;
      note.textContent = `A document of the project at ${shortSha(view.rev)}. Read-only.`;
      doc.replaceChildren(docCard(e, view, { file: (p) => deps.file(p), open: (id) => deps.openEntry?.(id) }));
      only('doc');
    },
  };
}
