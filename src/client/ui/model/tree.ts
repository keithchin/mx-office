// The App Explorer: the app's tree as Studio Pro's left panel shows it (the app, its settings and
// navigation, each module with its domain model, folders and documents), with an icon per type,
// expand and collapse, a filter, and the keyboard (↑ ↓ to move, → ← to open and close, Enter to show).
// Only the rows in view are in the page, so a big app's thousands of documents scroll smoothly.

import type { ChangeStatus, ModelTreeNode } from '../../../shared/model';
import { h } from '../dom';
import { treeIcon } from './icons';

export const ROW_H = 22;

export interface Row {
  node: ModelTreeNode;
  key: string;
  depth: number;
  open: boolean;
  parent: string | null;
}

export interface TreeEvents {
  open(node: ModelTreeNode): void;
}

/** The tree flattened to the rows on show: open nodes' children, or with a filter the matches and their way down. */
export function visibleRows(roots: ModelTreeNode[], expanded: Set<string>, filter: string): Row[] {
  const q = filter.trim().toLowerCase();
  const out: Row[] = [];
  const matches = (n: ModelTreeNode): boolean => n.label.toLowerCase().includes(q) || (!!n.children && n.children.some(matches));
  const walk = (nodes: ModelTreeNode[], depth: number, parent: string | null) => {
    for (const node of nodes) {
      if (q && !matches(node)) continue;
      const key = `${parent ?? ''}/${node.type}:${node.label}`;
      const open = !!node.children && (q ? true : expanded.has(key));
      out.push({ node, key, depth, open, parent });
      if (open && node.children) walk(node.children, depth + 1, key);
    }
  };
  walk(roots, 0, null);
  return out;
}

/** Each document's change, and a dot on every folder and module with a changed document inside. */
export function changeMarks(roots: ModelTreeNode[], changes: Map<string, ChangeStatus>): Map<ModelTreeNode, ChangeStatus | 'inside'> {
  const out = new Map<ModelTreeNode, ChangeStatus | 'inside'>();
  const walk = (n: ModelTreeNode): boolean => {
    let any = false;
    const own = n.qn ? changes.get(`${n.type}:${n.qn}`) : undefined;
    if (own) {
      out.set(n, own);
      any = true;
    }
    for (const c of n.children ?? []) if (walk(c)) any = true;
    if (any && !own) out.set(n, 'inside');
    return any;
  };
  roots.forEach(walk);
  return out;
}

export class Tree {
  readonly el: HTMLElement;
  private scroller: HTMLElement;
  private spacer: HTMLElement;
  private win: HTMLElement;
  private filterInput: HTMLInputElement;
  private roots: ModelTreeNode[] = [];
  private rows: Row[] = [];
  private expanded = new Set<string>();
  private active = 0;
  private current: ModelTreeNode | null = null;
  private marks = new Map<ModelTreeNode, ChangeStatus | 'inside'>();
  private frame = 0;

  constructor(private on: TreeEvents) {
    this.filterInput = h('input.mx-filter', { type: 'search', placeholder: 'Filter (Ctrl+F)', 'aria-label': 'Filter the app explorer' });
    this.filterInput.addEventListener('input', () => this.refresh(true));
    this.filterInput.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        this.scroller.focus();
      }
    });
    this.spacer = h('div.mx-tree-spacer');
    this.win = h('div.mx-tree-win', { role: 'tree', 'aria-label': 'App explorer' });
    this.scroller = h('div.mx-tree-scroll', { tabindex: '0' }, this.spacer, this.win);
    this.scroller.addEventListener('scroll', () => this.paintSoon());
    this.scroller.addEventListener('keydown', (e) => this.key(e));
    this.el = h('div.mx-tree', {}, h('div.mx-tree-head', {}, h('span.mx-tree-title', {}, 'App Explorer'), this.filterInput), this.scroller);
    new ResizeObserver(() => this.paintSoon()).observe(this.scroller);
  }

  /** A new tree (another ref or floor): what was open stays open where it still exists. */
  set(roots: ModelTreeNode[]) {
    this.roots = roots;
    if (!this.expanded.size) {
      // Open the app and the project's own modules (not the Marketplace ones) the first time.
      const app = roots[0];
      if (app) this.expanded.add(`/${app.type}:${app.label}`);
    }
    this.refresh(false);
  }

  setChanges(changes: Map<string, ChangeStatus>) {
    this.marks = changeMarks(this.roots, changes);
    this.paint();
  }

  focusFilter() {
    this.filterInput.focus();
    this.filterInput.select();
  }

  /** Marks `node` as the document on show, opening the way down to it. */
  reveal(match: (n: ModelTreeNode) => boolean) {
    const path: string[] = [];
    const find = (nodes: ModelTreeNode[], parent: string): ModelTreeNode | null => {
      for (const n of nodes) {
        const key = `${parent}/${n.type}:${n.label}`;
        if (match(n)) return n;
        if (n.children) {
          path.push(key);
          const f = find(n.children, key);
          if (f) return f;
          path.pop();
        }
      }
      return null;
    };
    const found = find(this.roots, '');
    if (!found) return;
    for (const k of path) this.expanded.add(k);
    this.current = found;
    this.refresh(false);
    const i = this.rows.findIndex((r) => r.node === found);
    if (i >= 0) {
      this.active = i;
      this.scrollTo(i);
    }
  }

  private refresh(resetActive: boolean) {
    this.rows = visibleRows(this.roots, this.expanded, this.filterInput.value);
    if (resetActive) this.active = 0;
    this.active = Math.min(this.active, Math.max(0, this.rows.length - 1));
    this.spacer.style.height = `${this.rows.length * ROW_H}px`;
    this.paint();
  }

  private paintSoon() {
    if (!this.frame) this.frame = requestAnimationFrame(() => ((this.frame = 0), this.paint()));
  }

  private paint() {
    const top = this.scroller.scrollTop;
    const height = this.scroller.clientHeight || 600;
    const first = Math.max(0, Math.floor(top / ROW_H) - 10);
    const last = Math.min(this.rows.length, Math.ceil((top + height) / ROW_H) + 10);
    this.win.style.transform = `translateY(${first * ROW_H}px)`;
    const frag = document.createDocumentFragment();
    for (let i = first; i < last; i++) frag.append(this.rowEl(this.rows[i], i));
    this.win.replaceChildren(frag);
  }

  private rowEl(r: Row, i: number): HTMLElement {
    const mark = this.marks.get(r.node);
    const twisty = r.node.children ? h('span.mx-twisty', { 'aria-hidden': 'true' }, r.open ? '▾' : '▸') : h('span.mx-twisty');
    const icon = h('span.mx-tico');
    icon.innerHTML = treeIcon(r.node.type);
    const row = h(
      'div.mx-row',
      {
        role: 'treeitem',
        'aria-level': String(r.depth + 1),
        'aria-expanded': r.node.children ? String(r.open) : undefined,
        'aria-selected': String(r.node === this.current),
        style: `padding-left:${4 + r.depth * 14}px`,
        title: r.node.qn ?? r.node.label,
      },
      twisty,
      icon,
      h('span.mx-tlabel', {}, r.node.label),
      mark ? h(`span.mx-tmark.mx-${mark}`, { title: mark === 'inside' ? 'Something in here changed on this branch' : `${mark[0].toUpperCase()}${mark.slice(1)} on this branch` }, mark === 'added' ? '+' : mark === 'removed' ? '−' : mark === 'changed' ? '●' : '•') : null,
    );
    if (i === this.active) row.classList.add('mx-active');
    if (r.node === this.current) row.classList.add('mx-current');
    row.addEventListener('click', (e) => {
      this.active = i;
      if ((e.target as HTMLElement).classList.contains('mx-twisty') || (r.node.children && !opens(r.node))) this.toggle(r);
      else this.choose(r);
      this.scroller.focus({ preventScroll: true });
    });
    row.addEventListener('dblclick', () => r.node.children && this.toggle(r));
    return row;
  }

  private toggle(r: Row) {
    if (this.expanded.has(r.key)) this.expanded.delete(r.key);
    else this.expanded.add(r.key);
    this.refresh(false);
  }

  private choose(r: Row) {
    if (!opens(r.node)) return this.toggle(r);
    this.current = r.node;
    this.paint();
    this.on.open(r.node);
  }

  private scrollTo(i: number) {
    const top = i * ROW_H;
    if (top < this.scroller.scrollTop) this.scroller.scrollTop = top;
    else if (top + ROW_H > this.scroller.scrollTop + this.scroller.clientHeight) this.scroller.scrollTop = top + ROW_H - this.scroller.clientHeight;
    this.paint();
  }

  private key(e: KeyboardEvent) {
    const r = this.rows[this.active];
    let handled = true;
    if (e.key === 'ArrowDown') this.active = Math.min(this.rows.length - 1, this.active + 1);
    else if (e.key === 'ArrowUp') this.active = Math.max(0, this.active - 1);
    else if (e.key === 'Home') this.active = 0;
    else if (e.key === 'End') this.active = this.rows.length - 1;
    else if (e.key === 'PageDown') this.active = Math.min(this.rows.length - 1, this.active + 15);
    else if (e.key === 'PageUp') this.active = Math.max(0, this.active - 15);
    else if (e.key === 'ArrowRight' && r) {
      if (r.node.children && !r.open) this.toggle(r);
      else if (r.open) this.active++;
    } else if (e.key === 'ArrowLeft' && r) {
      if (r.open) this.toggle(r);
      else if (r.parent) this.active = Math.max(0, this.rows.findIndex((x) => x.key === r.parent));
    } else if ((e.key === 'Enter' || e.key === ' ') && r) this.choose(r);
    else if (e.key === 'f' && (e.ctrlKey || e.metaKey)) this.focusFilter();
    else handled = false;
    if (handled) {
      e.preventDefault();
      this.scrollTo(this.active);
    }
  }
}

/** Tree types that show something when chosen (the rest just open and close). */
export const OPENS = new Set(['domainmodel', 'entity', 'association', 'microflow', 'nanoflow', 'page', 'snippet', 'layout', 'enumeration', 'constant', 'javaaction', 'workflow', 'jsonstructure', 'importmapping', 'exportmapping', 'imagecollection', 'scheduledevent', 'buildingblock', 'menu', 'restclient', 'odataclient', 'odataservice', 'regularexpression', 'queue', 'modulerole', 'userrole', 'demouser', 'projectsecurity', 'settings', 'navigation', 'navprofile']);
export const opens = (n: ModelTreeNode): boolean => OPENS.has(n.type) && (!!n.qn || n.type === 'navigation');
