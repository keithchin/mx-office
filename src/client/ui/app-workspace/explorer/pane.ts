// What the explorer opens in place of the running app, when it isn't a page with an address: the Model tab's
// own views, read-only, at the served revision. A page that opens only from another page shows the Model
// tab's Preview (sample data, its own sandboxed frame) with a note saying so; a part of the app's data shows
// its diagram with the record picked; logic shows its diagram; a project file (all-files view) shows its
// text or picture. The running app's frame is only hidden meanwhile (never taken out, which would reload
// it): Back to the running app shows it again.

import { h } from '../../dom';
import type { DomainDoc, FlowDoc } from '../../../../shared/model';
import type { ExplorerFile, ExplorerNode } from '../../../../shared/app-explorer';
import { modelApi } from '../../model/api';
import { Canvas } from '../../model/canvas';
import { drawDomain } from '../../model/domain-draw';
import { drawFlow } from '../../model/flow-draw';
import { pageFrame } from '../../model/page-frame';
import '../../model/model.css';
import '../../model/page.css';

const DARK = new Set(['dark', 'terminal', 'clean-dark', 'portal-dark']);

export interface PaneDeps {
  floor(): string | null;
  rev(): string | undefined;
  /** Back to the running app. */
  back(): void;
  file(path: string): Promise<ExplorerFile>;
  /** For tests: the Model tab's requests. */
  api?: Pick<typeof modelApi, 'doc'>;
}

export interface Pane {
  readonly el: HTMLElement;
  /** Shows `n` (a page without an address, data, logic or a file). */
  show(n: ExplorerNode, label?: string, why?: string): void;
  /** What's shown, if anything. */
  readonly node: ExplorerNode | undefined;
}

export function docPane(deps: PaneDeps): Pane {
  const api = deps.api ?? modelApi;
  const title = h('b.ax-pane-title');
  const note = h('p.ax-pane-note', { role: 'status' });
  const backBtn = h('button.aw-btn.ax-back', { type: 'button', onclick: () => deps.back() }, '← Back to the running app');
  const stage = h('div.mx-stage.ax-stage');
  const text = h('pre.ax-text');
  const img = h('img.ax-img', { alt: '' }) as HTMLImageElement;
  const msg = h('p.aw-muted.ax-msg');
  const canvas = new Canvas(stage, { select: () => undefined });
  const preview = pageFrame((type, qn) => {
    const f = deps.floor();
    const rev = deps.rev();
    return f && rev ? api.doc(f, rev, type, qn, false).then((r) => (r.doc.kind === 'text' ? r.doc.mdl || null : null)) : Promise.resolve(null);
  });
  // The Preview's own note names how it's drawn in engineering words: said plainly here.
  const pnote = preview.el.querySelector('.pgp-note');
  if (pnote) pnote.textContent = 'Sample data · a preview, not the running app';
  const body = h('div.ax-pane-body', {}, stage, preview.el, text, img, msg);
  const el = h('section.ax-pane.mxv', { 'aria-label': 'Opened from the explorer', hidden: true }, h('div.ax-pane-bar', {}, backBtn, title), note, body);
  let shown: ExplorerNode | undefined;
  let seq = 0;

  const theme = () => el.classList.toggle('mx-dark', DARK.has(document.documentElement.dataset.theme ?? ''));
  new MutationObserver(theme).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  theme();

  function only(which: 'stage' | 'preview' | 'text' | 'img' | 'msg') {
    stage.hidden = which !== 'stage';
    if (which !== 'preview') preview.clear();
    text.hidden = which !== 'text';
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
        if (r.doc.kind === 'text' && r.doc.mdl && preview.show(r.doc.mdl)) return only('preview');
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
    show(n, label, why) {
      shown = n;
      el.hidden = false;
      title.textContent = label ?? n.label;
      note.textContent = why ??
        (n.type === 'page'
          ? 'This page opens from another page of the app (it needs a record passed to it), so here it’s a preview with sample data. To try it for real, open the page that leads to it.'
          : n.type === 'entity' || n.type === 'domainmodel'
            ? 'The records this part of the app keeps and how they relate, at the running version. Read-only.'
            : n.type === 'microflow' || n.type === 'nanoflow'
              ? 'What the app does, step by step, at the running version. Read-only.'
              : 'A file of the project at the running version. Read-only.');
      void load(n);
    },
  };
}
