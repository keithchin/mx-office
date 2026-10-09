// The 📐 Model tab on the 1D view: the floor's Mendix app as Studio Pro shows it. The App Explorer on
// the left (tree.ts), the chosen document on the right drawn like Studio Pro's editors (a module's
// domain model, a microflow or nanoflow; other documents as their MDL), the clicked element's details
// beside it. A picker chooses main or a branch (a worker's, or an open pull request's), and "Changes in
// this branch" marks what the branch added and changed against main, in the tree and in the diagram.
//
// It asks the server (api.ts) only while the tab is open: when it opens, when you pick a branch or a
// document, and a few seconds after the workers or pull requests change (a merge moves main). No timer.
// Read-only.
//
// A domain model shows "As in Studio Pro" (the developer's layout) or, chosen per viewer and
// remembered in this browser, "Tidy layout": the entities rearranged for reading, for the view only.

import { modelHref, type ChangeStatus, type DocChange, type DocDiff, type DomainDoc, type FlowDoc, type ModelDoc, type ModelRef, type ModelTreeNode } from '../../../shared/model';
import { setAddress } from '../../shared/address';
import { store } from '../../state';
import { currentTheme } from '../colortheme';
import { h } from '../dom';
import { modelApi } from './api';
import { Canvas } from './canvas';
import { changeList, details } from './details';
import { drawDomain } from './domain-draw';
import { looksUnarranged } from './domain-layout';
import { tidyDomain } from './domain-tidy';
import { drawFlow } from './flow-draw';
import { Tree, opens } from './tree';
import { fullScreen } from './fullscreen';
import './model.css';

const DARK = new Set(['dark', 'terminal', 'clean-dark', 'portal-dark']);
const SETTLE_MS = 4000;
const TIDY_KEY = 'agent-office.model.tidy';

const recallTidy = (): boolean => {
  try {
    return localStorage.getItem(TIDY_KEY) === '1';
  } catch {
    return false;
  }
};
const rememberTidy = (on: boolean) => {
  try {
    localStorage.setItem(TIDY_KEY, on ? '1' : '0');
  } catch {
    // just for this visit, then
  }
};

/** The tidy layout of a document, worked out once per document read. */
const tidied = new WeakMap<DomainDoc, DomainDoc>();
const tidyOf = (d: DomainDoc): DomainDoc => {
  let t = tidied.get(d);
  if (!t) tidied.set(d, (t = tidyDomain(d)));
  return t;
};

export interface ModelView {
  show(): void;
  hide(): void;
}

interface Open {
  type: string;
  qn: string;
  /** An element to pick once it's drawn (an entity or association chosen in the tree, by name). */
  pick?: string;
}

/** What the address asked for when the page opened (&ref=, &doc=, &type=, &changes=1). */
function asked(): { ref?: string; open?: Open; changes: boolean; zoom?: number } {
  const q = new URLSearchParams(location.search);
  const doc = q.get('doc');
  const type = q.get('type');
  return { ref: q.get('ref') ?? undefined, open: doc && type ? { type, qn: doc } : undefined, changes: q.get('changes') === '1', zoom: Number(q.get('zoom')) || undefined };
}

export function modelView(root: HTMLElement): ModelView {
  const first = asked();
  let visible = false;
  let floor: string | null = null;
  let ref = first.ref ?? 'main';
  let refs: ModelRef[] = [];
  let tree: ModelTreeNode[] = [];
  let open: Open | null = first.open ?? null;
  let doc: ModelDoc | null = null;
  let diff: DocDiff | undefined;
  let changesOn = first.changes;
  let changes: DocChange[] = [];
  let selected: string | null = null;
  let mainSha: string | undefined;
  let seq = 0;
  let settle: ReturnType<typeof setTimeout> | undefined;
  /** &zoom=100 in the address: the first document opens at that zoom. */
  let zoomOnce = first.zoom;
  let tidy = recallTidy();

  root.classList.add('mxv');
  const refPick = h('select', { 'aria-label': 'Branch' });
  const changesBox = h('input', { type: 'checkbox' });
  changesBox.checked = changesOn;
  const changesToggle = h('label.mx-toggle', { title: 'Mark what this branch added and changed against main' }, changesBox, 'Changes in this branch');
  const title = h('div.mx-title');
  const layoutBtn = (on: boolean, label: string, tip: string) => h('button.btn', { type: 'button', title: tip, 'aria-pressed': String(tidy === on), onclick: () => setTidy(on) }, label);
  const studioBtn = layoutBtn(false, 'As in Studio Pro', 'The layout the developer made in Studio Pro');
  const tidyBtn = layoutBtn(true, 'Tidy layout', 'Rearrange the entities for reading (this view only; the model is not changed)');
  const layoutSeg = h('span.mx-seg', { role: 'group', 'aria-label': 'Layout' }, studioBtn, tidyBtn);
  const hint = h('span.mx-hint', {}, 'Lines overlap? Try ', h('button.mx-link', { type: 'button', onclick: () => setTidy(true) }, 'Tidy layout'));
  layoutSeg.hidden = true;
  hint.hidden = true;
  const zoomPct = h('span', {}, '100%');
  const canvasHost = h('div.mx-stage');
  const msg = h('div.mx-msg');
  const text = h('pre.mx-text');
  text.hidden = true;
  const side = h('aside.mx-side', { 'aria-label': 'Details' });
  const explorerBtn = h('button.btn.mx-explorer-btn', { type: 'button', 'aria-label': 'App Explorer' }, '☰ Explorer');
  const canvas = new Canvas(canvasHost, {
    select(id) {
      selected = id;
      renderSide();
    },
  });
  canvasHost.append(text, msg);
  const treeView = new Tree({ open: (n) => openNode(n) });
  // Full screen: the explorer, the diagram and the details fill the window (F, or the button; Esc leaves),
  // the drawing fitted again each way. Back in the page, the tab fits between the bars again.
  const full = fullScreen(root, () => {
    if (!full.on) fitHeight();
    if (doc) canvas.fit();
  });
  const fullBtn = full.button;
  const scrim = h('div.mx-scrim', { onclick: () => root.classList.remove('mx-drawer') });
  const body = h('div.mx-body', {}, treeView.el, canvasHost, side, scrim);
  const bar = h(
    'div.mx-bar',
    {},
    explorerBtn,
    refPick,
    changesToggle,
    layoutSeg,
    hint,
    title,
    h(
      'span.mx-zoom',
      {},
      h('button.btn', { type: 'button', title: 'Zoom out (−)', onclick: () => canvas.zoom(1 / 1.25) }, '−'),
      zoomPct,
      h('button.btn', { type: 'button', title: 'Zoom in (+)', onclick: () => canvas.zoom(1.25) }, '+'),
      h('button.btn', { type: 'button', title: 'Fit the document in view (0)', onclick: () => canvas.fit() }, 'Fit'),
    ),
    fullBtn,
  );
  root.replaceChildren(bar, body);
  explorerBtn.addEventListener('click', () => root.classList.toggle('mx-drawer'));
  new MutationObserver(() => (zoomPct.textContent = `${canvasHost.dataset.zoom ?? 100}%`)).observe(canvasHost, { attributes: true, attributeFilter: ['data-zoom'] });

  // Studio Pro's light canvas on the light themes, its dark canvas on the dark ones.
  const theme = () => root.classList.toggle('mx-dark', DARK.has(currentTheme()));
  theme();
  new MutationObserver(theme).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

  const say = (s: string | null) => {
    msg.textContent = s ?? '';
    msg.hidden = !s;
  };

  function address() {
    if (!visible) return;
    setAddress({ ref: ref === 'main' ? null : ref, doc: open?.qn ?? null, type: open?.type ?? null, changes: changesOn && ref !== 'main' ? '1' : null });
  }

  /** Fits the tab between the tab bar and the bottom of the window, so the page itself never scrolls. */
  function fitHeight() {
    if (!visible) return;
    const top = root.getBoundingClientRect().top + window.scrollY;
    const nav = document.querySelector<HTMLElement>('.lite-nav');
    const below = nav && getComputedStyle(nav).display !== 'none' ? nav.getBoundingClientRect().height : 0;
    // On a phone the tab bar alone fills the first screen: the tab takes (almost) a screen of its own below it.
    const phone = window.innerWidth <= 760;
    root.style.height = `${phone ? Math.max(420, window.innerHeight - below - 70) : Math.max(360, window.innerHeight - top - below - 10)}px`;
    root.style.marginBottom = `${below + 6}px`;
  }
  window.addEventListener('resize', () => fitHeight());

  function renderRefs() {
    refPick.replaceChildren(
      ...refs.map((r) => {
        const who = r.worker ? ` · ${r.worker}` : '';
        const pr = r.pr ? ` · PR #${r.pr}` : '';
        const o = h('option', { value: r.ref }, r.kind === 'main' ? (r.label === 'main' ? 'main' : `${r.label} (main)`) : `${r.label}${who}${pr}`);
        o.selected = r.ref === ref;
        return o;
      }),
    );
    if (!refs.some((r) => r.ref === ref) && ref !== 'main') refPick.append(Object.assign(h('option', { value: ref }, ref), { selected: true }));
    changesToggle.style.display = ref === 'main' ? 'none' : '';
  }

  function renderTitle() {
    const kind = open ? (open.type === 'domainmodel' ? 'Domain model' : open.type) : '';
    title.replaceChildren(open ? h('b', {}, open.type === 'domainmodel' ? `${open.qn} › Domain model` : open.qn) : h('span', {}, 'Pick a document in the App Explorer'), open ? h('span', {}, kind === 'Domain model' ? '' : `· ${kind}`) : '');
  }

  function renderSide() {
    const parts: HTMLElement[] = doc ? details(doc, selected, changesOn ? diff : undefined) : [];
    if (changesOn && ref !== 'main') parts.push(changeList(changes, (c) => openDoc({ type: c.type, qn: c.qn })));
    side.replaceChildren(...parts);
    // On a phone the details only take room from the diagram when there's something to say.
    const phone = window.innerWidth <= 760;
    body.classList.toggle('mx-noside', !parts.length || (phone && !selected && !(changesOn && ref !== 'main')));
  }

  function renderLayout() {
    const dm = doc?.kind === 'domainmodel';
    layoutSeg.hidden = !dm;
    studioBtn.classList.toggle('on', !tidy);
    tidyBtn.classList.toggle('on', tidy);
    studioBtn.setAttribute('aria-pressed', String(!tidy));
    tidyBtn.setAttribute('aria-pressed', String(tidy));
    hint.hidden = !(dm && !tidy && looksUnarranged(doc as DomainDoc));
  }

  function setTidy(on: boolean) {
    if (on === tidy) return;
    tidy = on;
    rememberTidy(on);
    draw();
  }

  function draw(keepView = false) {
    renderLayout();
    if (!doc) return;
    canvasHost.classList.toggle('mx-dm', doc.kind === 'domainmodel');
    canvasHost.classList.toggle('mx-nano', doc.kind === 'nanoflow');
    if (doc.kind === 'text') {
      canvas.clear();
      text.hidden = false;
      text.textContent = doc.mdl || 'mxcli has no description for this kind of document.';
      say(null);
      return;
    }
    text.hidden = true;
    const d = doc.kind === 'domainmodel' ? drawDomain(tidy ? tidyOf(doc) : doc, changesOn ? diff : undefined) : drawFlow(doc, changesOn ? diff : undefined);
    canvas.show(d, keepView);
    if (zoomOnce && !keepView) {
      canvas.zoomTo(zoomOnce / 100);
      zoomOnce = undefined;
    }
    const empty = doc.kind === 'domainmodel' ? !doc.entities.length && !doc.annotations.length : !doc.nodes.length;
    say(empty ? 'This document is empty.' : null);
  }

  async function loadDoc(keepView = false) {
    if (!floor || !open) return;
    const mine = ++seq;
    const want = open;
    say('Reading the document…');
    text.hidden = true;
    renderTitle();
    try {
      const type = want.type === 'entity' || want.type === 'association' ? 'domainmodel' : want.type;
      const qn = type === 'domainmodel' && want.type !== 'domainmodel' ? want.qn.slice(0, want.qn.indexOf('.')) : want.qn;
      const r = await modelApi.doc(floor, ref, type, qn, changesOn && ref !== 'main');
      if (mine !== seq) return;
      doc = r.doc;
      diff = r.diff;
      open = { type, qn };
      if (want.pick && doc.kind === 'domainmodel') {
        const name = want.pick.slice(want.pick.lastIndexOf('.') + 1);
        selected = (doc.entities.find((e) => e.name === name) ?? doc.associations.find((a) => a.name === name))?.id ?? null;
      } else if (!keepView) selected = null;
      draw(keepView);
      if (selected) canvas.select(selected, true);
      renderTitle();
      renderSide();
      address();
      treeView.reveal((n) => n.qn === qn && (n.type === type || (type === 'domainmodel' && n.type === 'domainmodel')));
      if ((doc.kind === 'microflow' || doc.kind === 'nanoflow') && doc.mdlLater) void loadMdl(doc);
    } catch (err) {
      if (mine !== seq) return;
      doc = null;
      canvas.clear();
      renderLayout();
      say(`Couldn't read ${want.qn}: ${(err as Error).message}`);
      renderSide();
    }
  }

  /** A flow's MDL, after its diagram: put in the open document and the details redrawn (the diagram stays as it is). */
  async function loadMdl(flow: FlowDoc) {
    if (!floor) return;
    try {
      const m = await modelApi.mdl(floor, ref, flow.kind, flow.name);
      if (doc !== flow) return;
      flow.mdl = m.mdl;
      for (const n of flow.nodes) if (m.lines[n.id]) n.lines = m.lines[n.id];
    } catch {
      if (doc !== flow) return;
    }
    flow.mdlLater = false;
    renderSide();
  }

  function openDoc(o: Open) {
    open = o;
    root.classList.remove('mx-drawer');
    void loadDoc();
  }

  function openNode(n: ModelTreeNode) {
    if (!opens(n) || !n.qn) return;
    if (n.type === 'entity' || n.type === 'association') openDoc({ type: n.type, qn: n.qn, pick: n.qn });
    else openDoc({ type: n.type, qn: n.qn });
  }

  async function loadChanges() {
    if (!floor || !changesOn || ref === 'main') {
      changes = [];
      treeView.setChanges(new Map());
      return;
    }
    try {
      const r = await modelApi.changes(floor, ref);
      changes = r.docs;
    } catch {
      changes = [];
    }
    treeView.setChanges(new Map(changes.map((c): [string, ChangeStatus] => [`${c.type}:${c.qn}`, c.status])));
    renderSide();
  }

  /** The refs, the tree for the chosen ref, its changes and the open document: everything, afresh. */
  async function load() {
    if (!floor) return;
    const mine = ++seq;
    const f = floor;
    say('Reading the app… (the first time takes a little while)');
    try {
      const r = await modelApi.refs(f);
      if (mine !== seq || f !== floor) return;
      refs = r.refs;
      mainSha = refs.find((x) => x.kind === 'main')?.sha;
      renderRefs();
      if (r.problem) return say(r.problem);
      const t = await modelApi.tree(f, ref);
      if (mine !== seq || f !== floor) return;
      tree = [{ label: `App '${store.project?.name ?? f}'`, type: 'app', children: t.nodes }];
      treeView.set(tree);
      if (t.stale) void freshTree(f, ref);
      void loadChanges();
      if (open) await loadDoc();
      else {
        say('Pick a domain model, microflow or nanoflow in the App Explorer.');
        renderTitle();
        renderSide();
      }
    } catch (err) {
      if (mine === seq) say(`Couldn't read the app: ${(err as Error).message}`);
    }
  }

  /** The app's structure changed: the tree shown is the last one until mxcli has the new one. */
  async function freshTree(f: string, r: string) {
    try {
      const t = await modelApi.tree(f, r, undefined, true);
      if (f !== floor || r !== ref) return;
      tree = [{ label: `App '${store.project?.name ?? f}'`, type: 'app', children: t.nodes }];
      treeView.set(tree);
      if (open) treeView.reveal((n) => n.qn === open?.qn && n.type === open?.type);
    } catch {
      /* the next load tries again */
    }
  }

  refPick.addEventListener('change', () => {
    ref = refPick.value || 'main';
    renderRefs();
    address();
    void load();
  });
  changesBox.addEventListener('change', () => {
    changesOn = changesBox.checked;
    address();
    void loadChanges();
    if (open) void loadDoc(true);
    else renderSide();
  });
  root.addEventListener('keydown', (e) => {
    if (e.key === 'f' && (e.ctrlKey || e.metaKey) && root.contains(document.activeElement)) {
      e.preventDefault();
      treeView.focusFilter();
    }
  });
  full.keys();

  // A merge or a new commit on a worker's branch: look again once things settle (only when on screen).
  const kick = () => {
    if (!visible || !floor) return;
    clearTimeout(settle);
    settle = setTimeout(async () => {
      if (!visible || !floor) return;
      try {
        const r = await modelApi.refs(floor);
        const sha = r.refs.find((x) => x.kind === 'main')?.sha;
        const cur = refs.find((x) => x.ref === ref)?.sha;
        const next = r.refs.find((x) => x.ref === ref)?.sha;
        refs = r.refs;
        renderRefs();
        if (sha !== mainSha || cur !== next) void load();
      } catch {
        /* the next change tries again */
      }
    }, SETTLE_MS);
  };
  store.on('pulls', kick);
  store.on('workers', kick);
  store.on('floor', () => {
    if (store.floor === floor) return;
    // Another floor (not the first one arriving): its own app, from main, nothing open yet.
    const moved = floor !== null;
    floor = store.floor ?? null;
    if (moved) {
      doc = null;
      open = null;
      ref = 'main';
      changes = [];
      canvas.clear();
      renderLayout();
    }
    if (visible) void load();
  });

  return {
    show() {
      const was = visible;
      visible = true;
      fitHeight();
      requestAnimationFrame(fitHeight);
      if (!was && (floor !== store.floor || !tree.length)) {
        floor = store.floor ?? null;
        void load();
      } else address();
    },
    hide() {
      if (!visible) return;
      full.exit();
      visible = false;
      clearTimeout(settle);
      setAddress({ ref: null, doc: null, type: null, changes: null });
    },
  };
}

export { modelHref };
