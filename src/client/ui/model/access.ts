// An entity's access rules as a compact matrix in the details panel: a column per module role, a row per
// attribute and association, R / RW / – in each cell, the roles' create and delete rights on top, and
// each rule's XPath constraint under it. A role with several rules gets what any of them gives (Mendix
// adds rules up). Many roles scroll sideways inside the panel. `accessMatrix` is pure (tested in node).

import type { DmEntity, DmRight } from '../../../shared/model';
import { h } from '../dom';

export type Cell = DmRight | '';

export interface AccessMatrix {
  /** Module roles, qualified, in the order the rules name them. */
  roles: string[];
  create: boolean[];
  delete: boolean[];
  rows: { name: string; assoc: boolean; cells: Cell[] }[];
  /** Each rule's roles and XPath constraint (rules without one left out). */
  xpaths: { roles: string[]; xpath: string }[];
}

const best = (a: Cell, b: Cell | undefined): Cell => (a === 'RW' || b === 'RW' ? 'RW' : a === 'R' || b === 'R' ? 'R' : '');

/** The matrix of `e`'s rules, or null when its rules weren't read (a domain model from mxcli alone). */
export function accessMatrix(e: DmEntity): AccessMatrix | null {
  if (!e.access) return null;
  const roles: string[] = [];
  for (const r of e.access) for (const role of r.roles) if (!roles.includes(role)) roles.push(role);
  const ix = new Map(roles.map((r, i) => [r, i]));
  const create = roles.map(() => false);
  const del = roles.map(() => false);
  // Rows: the entity's attributes in their order, then any other attribute a rule names (inherited ones), then associations.
  const attrs = e.attrs.map((a) => a.name);
  const assocs: string[] = [];
  for (const r of e.access) {
    for (const a of Object.keys(r.attrs)) if (!attrs.includes(a)) attrs.push(a);
    for (const a of Object.keys(r.assocs)) if (!assocs.includes(a)) assocs.push(a);
  }
  const rows = [...attrs.map((name) => ({ name, assoc: false, cells: roles.map((): Cell => '') })), ...assocs.map((name) => ({ name, assoc: true, cells: roles.map((): Cell => '') }))];
  const xpaths: AccessMatrix['xpaths'] = [];
  for (const r of e.access) {
    for (const role of r.roles) {
      const i = ix.get(role) as number;
      if (r.create) create[i] = true;
      if (r.delete) del[i] = true;
      for (const row of rows) row.cells[i] = best(row.cells[i], row.assoc ? r.assocs[row.name] : r.attrs[row.name]);
    }
    if (r.xpath) xpaths.push({ roles: r.roles, xpath: r.xpath });
  }
  return { roles, create, delete: del, rows, xpaths };
}

const shortRole = (qn: string) => qn.slice(qn.lastIndexOf('.') + 1);

/** The panel's "Access rules" section for an entity. */
export function accessSection(e: DmEntity): HTMLElement[] {
  const m = accessMatrix(e);
  if (!m) return [h('h4', {}, 'Access rules'), h('p.mx-kind', {}, 'Not available: this domain model was read through mxcli alone.')];
  if (!m.roles.length) return [h('h4', {}, 'Access rules'), h('p.mx-kind', {}, 'No access rules: only System (microflows without user rights) can use it.')];
  const cell = (c: Cell) => h(`td.ax-${c || 'none'}`, { title: c === 'RW' ? 'Read and write' : c === 'R' ? 'Read only' : 'No access' }, c || '–');
  const yes = (on: boolean) => h(`td.ax-${on ? 'yes' : 'none'}`, {}, on ? '✓' : '–');
  const table = h(
    'table.ax',
    {},
    h('thead', {}, h('tr', {}, h('th', {}, ''), ...m.roles.map((r) => h('th', { title: r, scope: 'col' }, shortRole(r))))),
    h(
      'tbody',
      {},
      h('tr.ax-rights', {}, h('th', { scope: 'row' }, 'Create'), ...m.create.map(yes)),
      h('tr.ax-rights', {}, h('th', { scope: 'row' }, 'Delete'), ...m.delete.map(yes)),
      ...m.rows.map((r) => h('tr', {}, h('th', { scope: 'row', title: r.assoc ? `Association ${r.name}` : `Attribute ${r.name}` }, r.assoc ? `↔ ${r.name}` : r.name), ...r.cells.map(cell))),
    ),
  );
  const out: HTMLElement[] = [h('h4', {}, `Access rules (${e.access?.length ?? 0} · ${m.roles.length} roles)`), h('div.ax-scroll', {}, table)];
  if (m.xpaths.length) {
    out.push(h('h4', {}, 'XPath constraints'));
    for (const x of m.xpaths) out.push(h('div.ax-xpath', {}, h('div.mx-kind', {}, x.roles.map(shortRole).join(', ')), h('pre.mx-mdl', {}, x.xpath)));
  }
  return out;
}
