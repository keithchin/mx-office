// The explorer's tree on screen: a WAI-ARIA tree (role=tree, treeitems with their level, expanded and
// selected state, one row in the tab order at a time), drawn from what's loaded. Arrows move and open or
// close, Home/End jump, Enter opens the row (a folder opens or closes), and typing a few letters moves to
// the next row starting with them. A level's rows are fetched when it's first opened (./index.ts); while a
// search is typed, rows that don't match (and have nothing below that matches) are left out and the
// branches with matches are shown open. The "changed" dot marks rows the last update changed.

import { h } from '../../dom';
import type { ExplorerNode } from '../../../../shared/app-explorer';

export interface Level {
  nodes: ExplorerNode[];
  /** More rows to ask for (a big folder), from this cursor. */
  next?: number;
  total?: number;
  loading?: boolean;
  error?: string;
  note?: string;
}

export interface Row {
  node: ExplorerNode;
  depth: number;
  parent?: string;
  /** A "Show more" row for a paged level, or a loading/empty/error line under one. */
  more?: { parent: string; cursor: number };
  line?: string;
}

export interface TreeModel {
  roots: ExplorerNode[];
  kids: Map<string, Level>;
  expanded: Set<string>;
  dots: Set<string>;
}

const matches = (n: ExplorerNode, q: string) => n.label.toLowerCase().includes(q);

/** The rows on screen, in order: open branches' children under them; with a search, only matches and their branches. */
export function visibleRows(m: TreeModel, query: string): Row[] {
  const q = query.trim().toLowerCase();
  const out: Row[] = [];
  const keep = new Map<string, boolean>();
  const hasMatch = (n: ExplorerNode): boolean => {
    let v = keep.get(n.id);
    if (v !== undefined) return v;
    v = matches(n, q) || !!m.kids.get(n.id)?.nodes.some(hasMatch);
    keep.set(n.id, v);
    return v;
  };
  const walk = (nodes: ExplorerNode[], depth: number, parent?: string) => {
    for (const n of nodes) {
      if (q && !hasMatch(n)) continue;
      out.push({ node: n, depth, ...(parent ? { parent } : {}) });
      const lv = m.kids.get(n.id);
      const open = n.folder && (q ? !!lv?.nodes.some(hasMatch) : m.expanded.has(n.id));
      if (!open) continue;
      if (!lv || lv.loading) out.push(line(n, depth + 1, 'Reading…'));
      else if (lv.error) out.push(line(n, depth + 1, lv.error));
      else {
        walk(lv.nodes, depth + 1, n.id);
        if (!lv.nodes.length && !q) out.push(line(n, depth + 1, lv.note ?? 'Nothing here'));
        if (lv.next !== undefined && !q) out.push({ node: { id: `${n.id}#more`, label: `Show more (${(lv.total ?? 0) - lv.nodes.length} more)`, kind: 'file' }, depth: depth + 1, parent: n.id, more: { parent: n.id, cursor: lv.next } });
      }
    }
  };
  walk(m.roots, 0);
  // A paged top (a big project's root folder): its Show more at the end.
  const top = m.kids.get('');
  if (top?.next !== undefined && top.nodes === m.roots && !q) out.push({ node: { id: '#more', label: `Show more (${(top.total ?? 0) - top.nodes.length} more)`, kind: 'file' }, depth: 0, parent: '', more: { parent: '', cursor: top.next } });
  return out;
}

const line = (n: ExplorerNode, depth: number, text: string): Row => ({ node: { id: `${n.id}#line`, label: text, kind: 'file' }, depth, parent: n.id, line: text });

const ICON: Record<string, string> = { pages: '▭', data: '◫', logic: 'ƒ', documents: '≣', processmap: '⇢', design: '◐', module: '▪', page: '▭', entity: '◫', flow: 'ƒ', doc: '≣', folder: '▸', file: '·' };
const groupOf = (n: ExplorerNode) => n.id.replace(/^docs:/, '');
const iconOf = (n: ExplorerNode) => (n.kind === 'group' ? ICON[groupOf(n)] ?? '▪' : n.kind === 'file' && /\.(png|jpe?g|gif|svg|webp)$/i.test(n.label) ? '◩' : ICON[n.kind] ?? '·');

export interface TreeEvents {
  /** A branch was opened: fetch its rows if they aren't there. */
  expand(n: ExplorerNode): void;
  /** Enter or a click on a row that isn't a branch. */
  open(n: ExplorerNode): void;
  /** The selected row changed. */
  select(n: ExplorerNode | null): void;
  more(parent: string, cursor: number): void;
  /** Something changed that needs drawing. */
  changed(): void;
}

export class TreeView {
  readonly el: HTMLElement;
  private rows: Row[] = [];
  private focusId: string | undefined;
  selectedId: string | undefined;
  query = '';
  private typed = '';
  private typedAt = 0;

  constructor(
    private m: TreeModel,
    private on: TreeEvents, label: string) {
    this.el = h('ul.ax-tree', { role: 'tree', 'aria-label': label });
    this.el.addEventListener('click', (e) => this.click(e));
    this.el.addEventListener('keydown', (e) => this.key(e));
  }

  /** Shows another tree (the business view or all files). */
  setModel(m: TreeModel) {
    this.m = m;
    this.focusId = undefined;
    this.draw();
  }

  setLabel(label: string) {
    this.el.setAttribute('aria-label', label);
  }

  /** Draws the rows from the model again, keeping focus on the row that had it. */
  draw() {
    const hadFocus = this.el.contains(document.activeElement);
    this.rows = visibleRows(this.m, this.query);
    const there = (id: string | undefined) => !!id && this.rows.some((r) => r.node.id === id && !r.line);
    // Out of the tree, the row it comes back to is the selected one, else the first.
    if (!hadFocus) this.focusId = there(this.selectedId) ? this.selectedId : undefined;
    if (!there(this.focusId)) this.focusId = this.rows.find((r) => !r.line)?.node.id;
    const items = this.rows.map((r) => this.item(r));
    this.el.replaceChildren(...items);
    if (hadFocus) this.focusRow(this.focusId);
  }

  private item(r: Row): HTMLElement {
    const n = r.node;
    if (r.line) return h('li.ax-line', { role: 'none', style: `padding-left:${12 + r.depth * 14}px` }, r.line);
    const open = n.folder ? (this.query ? true : this.m.expanded.has(n.id)) : undefined;
    const li = h(
      'li.ax-row',
      {
        role: 'treeitem',
        'data-id': n.id,
        'aria-level': String(r.depth + 1),
        'aria-selected': String(this.selectedId === n.id),
        tabindex: this.focusId === n.id ? '0' : '-1',
        ...(n.hint ? { title: n.hint } : {}),
        ...(open !== undefined ? { 'aria-expanded': String(open) } : {}),
        style: `padding-left:${6 + r.depth * 14}px`,
        class: [r.more ? 'ax-more' : '', n.addon ? 'ax-addon' : '', this.selectedId === n.id ? 'on' : ''].filter(Boolean).join(' '),
      },
      h('span.ax-tw', { 'aria-hidden': 'true' }, n.folder ? (open ? '▾' : '▸') : ''),
      r.more ? '' : h('span.ax-ico', { 'aria-hidden': 'true', 'data-kind': n.kind === 'group' ? groupOf(n) : n.kind }, iconOf(n)),
      h('span.ax-label', {}, n.label),
      n.count !== undefined && n.kind !== 'folder' ? h('span.ax-count', {}, String(n.count)) : '',
      this.m.dots.has(n.id) ? h('span.ax-dot', { title: 'Changed in the last update', 'aria-label': 'changed' }) : '',
    );
    return li;
  }

  private rowOf(id: string | undefined) {
    return this.rows.find((r) => r.node.id === id);
  }

  focusRow(id: string | undefined) {
    if (!id) return;
    this.focusId = id;
    for (const li of this.el.querySelectorAll<HTMLElement>('[role="treeitem"]')) li.tabIndex = li.dataset.id === id ? 0 : -1;
    const li = this.el.querySelector<HTMLElement>(`[data-id="${CSS.escape(id)}"]`);
    li?.focus();
    li?.scrollIntoView?.({ block: 'nearest' });
  }

  private toggle(n: ExplorerNode, open?: boolean) {
    if (!n.folder) return;
    const now = open ?? !this.m.expanded.has(n.id);
    if (now) {
      this.m.expanded.add(n.id);
      this.on.expand(n);
    } else this.m.expanded.delete(n.id);
    this.on.changed();
  }

  private activate(r: Row) {
    if (r.more) return this.on.more(r.more.parent, r.more.cursor);
    this.selectedId = r.node.id;
    this.focusId = r.node.id;
    this.on.select(r.node);
    if (r.node.folder) this.toggle(r.node);
    else {
      this.on.open(r.node);
      this.on.changed();
    }
  }

  private click(e: MouseEvent) {
    const li = (e.target as HTMLElement).closest<HTMLElement>('[role="treeitem"]');
    const r = li && this.rowOf(li.dataset.id);
    if (!r) return;
    // The twisty only opens or closes; the row also opens a document or selects a branch.
    if ((e.target as HTMLElement).classList.contains('ax-tw') && r.node.folder) {
      this.focusId = r.node.id;
      return this.toggle(r.node);
    }
    this.activate(r);
  }

  private key(e: KeyboardEvent) {
    const live = this.rows.filter((r) => !r.line);
    const i = live.findIndex((r) => r.node.id === this.focusId);
    const r = live[i];
    if (!r) return;
    const go = (j: number) => {
      const t = live[Math.max(0, Math.min(live.length - 1, j))];
      if (t) this.focusRow(t.node.id);
    };
    // Type-ahead first: a space counts as a letter while a word is being typed.
    const typing = e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey && (e.key !== ' ' || (!!this.typed && Date.now() - this.typedAt < 700));
    switch (typing ? '' : e.key) {
      case 'ArrowDown':
        go(i + 1);
        break;
      case 'ArrowUp':
        go(i - 1);
        break;
      case 'Home':
        go(0);
        break;
      case 'End':
        go(live.length - 1);
        break;
      case 'ArrowRight':
        if (r.node.folder && !this.m.expanded.has(r.node.id) && !this.query) this.toggle(r.node, true);
        else if (r.node.folder && live[i + 1]?.parent === r.node.id) go(i + 1);
        break;
      case 'ArrowLeft':
        if (r.node.folder && this.m.expanded.has(r.node.id) && !this.query) this.toggle(r.node, false);
        else if (r.parent) this.focusRow(r.parent);
        break;
      case 'Enter':
      case ' ':
        this.activate(r);
        this.focusRow(r.node.id);
        break;
      default:
        if (typing) {
          const now = Date.now();
          this.typed = now - this.typedAt > 700 ? e.key.toLowerCase() : this.typed + e.key.toLowerCase();
          this.typedAt = now;
          const order = [...live.slice(i + (this.typed.length === 1 ? 1 : 0)), ...live.slice(0, i + 1)];
          const t = order.find((x) => x.node.label.toLowerCase().startsWith(this.typed));
          if (t) this.focusRow(t.node.id);
          break;
        }
        return;
    }
    e.preventDefault();
  }
}
