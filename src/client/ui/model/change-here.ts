// Where "Change this" meets the Model tab (index.ts): what's picked (the element clicked in the drawing,
// the attributes or enumeration values ticked in the details, the document on show, a row of the App
// Explorer), the Change this button and the badges in the details panel, the ✎ marks in the tree, and the
// small menu a right-click opens on a row or an element. The floor's open requests come from GET
// /api/model/change-requests when the tab loads and whenever the board or the workers change (the same
// moments the tab looks at its branches again): nothing polls. The pure parts are tested in node.

import { badgeText, isChangeKind, openFor, touches, type ChangeElement, type ChangeKind, type ChangeRequestView } from '../../../shared/model-change';
import type { ModelDoc, ModelTreeNode } from '../../../shared/model';
import { h } from '../dom';
import { changeApi, openChangeThis } from './change-this';

/** Documents that are a change's element as themselves. */
const DOC_KINDS = new Set<ChangeKind>(['entity', 'association', 'enumeration', 'microflow', 'nanoflow', 'page', 'snippet', 'constant']);

/** A row of the App Explorer as a change's element, or null when it isn't one. */
export function nodeElement(n: Pick<ModelTreeNode, 'type' | 'qn'>): ChangeElement | null {
  return isChangeKind(n.type) && DOC_KINDS.has(n.type) && n.qn && n.qn.includes('.') ? { kind: n.type, qn: n.qn } : null;
}

/** An enumeration's values from its MDL (`CREATE ENUMERATION M.E ( Value 'Caption', … )`). */
export function enumValues(mdl: string): string[] {
  const body = /\(([\s\S]*)\)/.exec(mdl)?.[1] ?? '';
  return [...body.matchAll(/^\s*([A-Za-z_]\w*)\s+'/gm)].map((m) => m[1]);
}

export interface Picked {
  doc: ModelDoc | null;
  /** The document on show, as the tab opened it. */
  open: { type: string; qn: string } | null;
  /** The element clicked in the drawing (its id). */
  selected: string | null;
  /** Qualified names ticked in the details (attributes, enumeration values). */
  ticked: ReadonlySet<string>;
}

/** What "Change this" acts on now: the ticked attributes or values, else the element clicked, else the document on show. */
export function pickedElements(p: Picked): ChangeElement[] {
  const { doc, open } = p;
  if (!doc || !open) return [];
  if (doc.kind === 'domainmodel') {
    const e = p.selected ? doc.entities.find((x) => x.id === p.selected) : undefined;
    if (e) {
      const qn = `${doc.module}.${e.name}`;
      const attrs = e.attrs.filter((a) => p.ticked.has(`${qn}.${a.name}`));
      return attrs.length ? attrs.map((a) => ({ kind: 'attribute' as const, qn: `${qn}.${a.name}` })) : [{ kind: 'entity', qn }];
    }
    const a = p.selected ? doc.associations.find((x) => x.id === p.selected) : undefined;
    return a ? [{ kind: 'association', qn: `${doc.module}.${a.name}` }] : [];
  }
  if (doc.kind === 'microflow' || doc.kind === 'nanoflow') return [{ kind: doc.kind, qn: open.qn }];
  if (doc.kind === 'text' && (open.type === 'enumeration' || open.type === 'page' || open.type === 'snippet' || open.type === 'constant')) {
    if (open.type === 'enumeration') {
      const values = enumValues(doc.mdl).filter((v) => p.ticked.has(`${open.qn}.${v}`));
      if (values.length) return values.map((v) => ({ kind: 'enumvalue' as const, qn: `${open.qn}.${v}` }));
    }
    return [{ kind: open.type, qn: open.qn }];
  }
  return [];
}

export interface HereDeps {
  floor(): string | null;
  ref(): string;
  sha(): string | undefined;
  picked(): Omit<Picked, 'ticked'>;
  /** Draw the details again (a tick, the requests came in). */
  redraw(): void;
  /** Open the PR's branch with "Changes in this branch" on. */
  viewBranch(branch: string): void;
  /** Where focus goes when the menu or dialog closes and the element it came from is gone. */
  fallback(): HTMLElement;
  /** The tree's ✎ marks changed. */
  marks(fn: (n: ModelTreeNode) => string | undefined): void;
}

export class ChangeHere {
  requests: ChangeRequestView[] = [];
  private ticked = new Set<string>();
  private pickKey = '';
  private menu: HTMLElement | null = null;
  private seq = 0;

  constructor(private d: HereDeps) {}

  /** The floor's open requests, afresh (the tab loaded, or the board or workers changed). */
  async load() {
    const floor = this.d.floor();
    const mine = ++this.seq;
    if (!floor) return this.set([]);
    try {
      const list = await changeApi.list(floor);
      if (mine === this.seq) this.set(list);
    } catch {
      /* the next load tries again */
    }
  }

  private set(list: ChangeRequestView[]) {
    this.requests = list;
    const open = list.filter((r) => r.state !== 'merged');
    this.d.marks((n) => {
      if (!n.qn || !nodeElement(n)) return undefined;
      const r = open.find((x) => touches(x, n.qn!));
      return r ? badgeText(r) : undefined;
    });
    this.d.redraw();
  }

  private current(): ChangeElement[] {
    const p = this.d.picked();
    const key = `${p.open?.type}:${p.open?.qn}|${p.selected}`;
    if (key !== this.pickKey) {
      this.pickKey = key;
      this.ticked.clear();
    }
    return pickedElements({ ...p, ticked: this.ticked });
  }

  /** The dialog for `elements`; focus goes back to `back` (or the tab's fallback when it's gone). */
  open(elements: ChangeElement[], back?: HTMLElement | null) {
    const floor = this.d.floor();
    if (!floor || !elements.length) return;
    const ref = this.d.ref();
    openChangeThis({
      floor,
      ref,
      sha: this.d.sha(),
      elements,
      back: () => {
        const again = back?.isConnected ? back : document.querySelector<HTMLElement>('.mx-change-btn');
        (again ?? this.d.fallback()).focus({ preventScroll: true });
      },
      sent: (r) => this.set([r, ...this.requests.filter((x) => x.id !== r.id)]),
    });
  }

  /** The badges for `qn` (the open requests about it), each with View change once its PR exists. */
  badges(qn: string, exact = false): HTMLElement | null {
    const open = openFor(this.requests, qn, exact);
    if (!open.length) return null;
    return h(
      'div.mx-creqs',
      {},
      ...open.map((r) =>
        h(
          'div.mx-creq',
          { title: `${r.id}: ${r.request}` },
          h('span.mx-creq-text', {}, badgeText(r)),
          r.pr && r.state === 'open' ? h('button.mx-link.mx-creq-view', { type: 'button', title: `Open ${r.pr.branch} with Changes in this branch`, onclick: () => this.d.viewBranch(r.pr!.branch) }, 'View change') : null,
        ),
      ),
    );
  }

  /** The top of the details panel: Change this for what's picked, and its open requests. */
  panel(): HTMLElement[] {
    const els = this.current();
    if (!els.length) return [];
    const label = els.length > 1 ? `✎ Change these ${els.length}` : '✎ Change this';
    const btn = h('button.btn.small.mx-change-btn', { type: 'button', title: `Ask the team to change ${els.map((e) => e.qn).join(', ')}`, onclick: () => this.open(els, btn) }, label);
    const qn = els.length === 1 ? els[0].qn : els[0].qn.slice(0, els[0].qn.lastIndexOf('.'));
    return [h('div.mx-change', {}, btn, this.badges(qn, els[0].kind === 'attribute' || els[0].kind === 'enumvalue'))];
  }

  /** A tick box for an attribute or value in the details: ticked ones are what Change this acts on. */
  tick(qn: string, label: string): HTMLElement {
    const box = h('input.mx-tick', { type: 'checkbox', 'aria-label': `Pick ${label} to change` }) as HTMLInputElement;
    box.checked = this.ticked.has(qn);
    box.addEventListener('change', () => {
      if (box.checked) this.ticked.add(qn);
      else this.ticked.delete(qn);
      this.d.redraw();
      document.querySelector<HTMLInputElement>(`.mx-tick[data-qn="${CSS.escape(qn)}"]`)?.focus();
    });
    box.dataset.qn = qn;
    const mark = openFor(this.requests, qn, true)[0];
    return h('span.mx-tickw', {}, box, mark ? h('span.mx-creq-dot', { title: badgeText(mark) }, '✎') : null);
  }

  /** An enumeration's values in the details, each with its tick box. */
  enumSection(qn: string, mdl: string): HTMLElement[] {
    this.current();
    const values = enumValues(mdl);
    if (!values.length) return [];
    return [h('h4', {}, `Values (${values.length})`), h('ul.mx-enumvals', {}, ...values.map((v) => h('li', {}, this.tick(`${qn}.${v}`, v), v)))];
  }

  /** A right-click on a row of the App Explorer. */
  treeMenu(e: MouseEvent, n: ModelTreeNode, from: HTMLElement) {
    const el = nodeElement(n);
    if (!el) return;
    e.preventDefault();
    this.showMenu(e.clientX, e.clientY, () => this.open([el], from), from);
  }

  /** A right-click in the drawing: on an element, it's picked first. */
  canvasMenu(e: MouseEvent, pick: (id: string) => void) {
    const hit = (e.target as Element | null)?.closest?.('[data-id]') as SVGGElement | null;
    if (hit?.dataset.id) pick(hit.dataset.id);
    const els = this.current();
    if (!els.length) return;
    e.preventDefault();
    this.showMenu(e.clientX, e.clientY, () => this.open(els), this.d.fallback());
  }

  private showMenu(x: number, y: number, act: () => void, back: HTMLElement) {
    this.closeMenu();
    const item = h('button.mx-menu-item', { type: 'button', role: 'menuitem' }, '✎ Change this…');
    const menu = h('div.mx-menu', { role: 'menu', style: `left:${Math.min(x, window.innerWidth - 180)}px;top:${Math.min(y, window.innerHeight - 50)}px` }, item);
    const close = (refocus: boolean) => {
      this.closeMenu();
      document.removeEventListener('pointerdown', outside, true);
      if (refocus) back.focus({ preventScroll: true });
    };
    const outside = (ev: Event) => !menu.contains(ev.target as Node) && close(false);
    item.addEventListener('click', () => (close(false), act()));
    menu.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape') {
        ev.preventDefault();
        ev.stopPropagation();
        close(true);
      }
    });
    document.addEventListener('pointerdown', outside, true);
    document.body.append(menu);
    this.menu = menu;
    item.focus();
  }

  private closeMenu() {
    this.menu?.remove();
    this.menu = null;
  }
}
