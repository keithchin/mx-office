// The explorer's business tree (shared/app-explorer.ts), one level at a time, from the app at a commit:
//
//   ''              Pages, Data, Logic with how many each has
//   pages           the parts of the app (modules) that have pages, the app's own first, Marketplace ones after
//   pages/<Module>  its pages in plain words, each with its path in the running app when it has one
//   data, data/<Module>     modules with data, then their kinds of records (entities)
//   logic, logic/<Module>   modules with logic, then their microflows and nanoflows
//
// Read from the commit's units (server/model/units.ts: the unit index by name, each unit by its content
// hash), so it costs no mxcli and a commit's level is worked out once. Without node:sqlite it falls back to
// the Model tab's tree (mxcli), which has the same documents but no page addresses.

import { list, str, type BsonDoc } from '../model/bson.js';
import type { CommitModel } from '../model/units.js';
import { GROUPS, KIND_HINT, pageUrl, plainName, type ExplorerNode } from '../../shared/app-explorer.js';
import type { ModelTreeNode } from '../../shared/model.js';

/** What the tree is built from: per module, its pages, flows and entities (and whether it's an add-on). */
export interface AppDocs {
  modules: Map<string, ModuleDocs>;
}
export interface ModuleDocs {
  addon: boolean;
  pages: string[];
  flows: { type: 'microflow' | 'nanoflow'; qn: string }[];
  /** Entity names (unqualified), or undefined until read. */
  entities?: string[];
  hasDomain: boolean;
}

/** Reads what's needed lazily: a page's Url, a module's entities, whether a module is from the Marketplace. */
export interface DocReader {
  pageUrl(qn: string): Promise<string | undefined>;
  entities(module: string): Promise<string[]>;
}

const urlCache = new Map<string, string>();
const entityCache = new Map<string, string[]>();
const addonCache = new Map<string, boolean>();
const bound = (m: Map<string, unknown>, n: number) => {
  while (m.size > n) m.delete(m.keys().next().value as string);
};

/** The documents of a commit's units. */
export async function docsOfUnits(cm: CommitModel): Promise<{ docs: AppDocs; reader: DocReader }> {
  const modules = new Map<string, ModuleDocs>();
  const mod = (name: string) => {
    let m = modules.get(name);
    if (!m) modules.set(name, (m = { addon: false, pages: [], flows: [], hasDomain: false }));
    return m;
  };
  for (const key of cm.ix.byName.keys()) {
    const kind = key.slice(0, key.indexOf(':'));
    const qn = key.slice(kind.length + 1);
    const module = kind === 'domainmodel' ? qn : qn.slice(0, qn.indexOf('.'));
    if (!module) continue;
    if (kind === 'page') mod(module).pages.push(qn);
    else if (kind === 'microflow' || kind === 'nanoflow') mod(module).flows.push({ type: kind, qn });
    else if (kind === 'domainmodel') mod(module).hasDomain = true;
  }
  // Marketplace modules: the module unit says FromAppStore (read once per content hash).
  await Promise.all(
    [...cm.ix.units.values()]
      .filter((u) => (u.type === 'Projects$ModuleImpl' || u.type === 'Projects$Module') && modules.has(u.name))
      .map(async (u) => {
        let addon = u.hash ? addonCache.get(u.hash) : undefined;
        if (addon === undefined) {
          const d = await cm.ix.read(u.id);
          addon = d?.FromAppStore === true;
          if (u.hash) addonCache.set(u.hash, addon), bound(addonCache, 5000);
        }
        modules.get(u.name)!.addon = addon;
      }),
  );
  const reader: DocReader = {
    async pageUrl(qn) {
      const h = cm.hashOf(`page:${qn}`);
      const hit = h ? urlCache.get(h) : undefined;
      if (hit !== undefined) return hit || undefined;
      const id = cm.ix.byName.get(`page:${qn}`);
      const d: BsonDoc | null = id ? await cm.ix.read(id) : null;
      const url = pageUrl(str(d?.Url)) ?? '';
      if (h) urlCache.set(h, url), bound(urlCache, 20_000);
      return url || undefined;
    },
    async entities(module) {
      const h = cm.hashOf(`domainmodel:${module}`);
      const hit = h ? entityCache.get(h) : undefined;
      if (hit) return hit;
      const id = cm.ix.byName.get(`domainmodel:${module}`);
      const d = id ? await cm.ix.read(id) : null;
      const names = list(d?.Entities).map((e) => str(e.Name)).filter(Boolean);
      if (h) entityCache.set(h, names), bound(entityCache, 5000);
      return names;
    },
  };
  return { docs: { modules }, reader };
}

/** The documents of the Model tab's tree (mxcli), when the units can't be read here. */
export function docsOfTree(nodes: ModelTreeNode[]): { docs: AppDocs; reader: DocReader } {
  const modules = new Map<string, ModuleDocs>();
  for (const m of nodes.filter((n) => n.type === 'module' && n.qn)) {
    const md: ModuleDocs = { addon: false, pages: [], flows: [], entities: [], hasDomain: false };
    const walk = (n: ModelTreeNode) => {
      if (n.type === 'page' && n.qn) md.pages.push(n.qn);
      else if ((n.type === 'microflow' || n.type === 'nanoflow') && n.qn) md.flows.push({ type: n.type, qn: n.qn });
      else if (n.type === 'domainmodel') md.hasDomain = true;
      else if (n.type === 'entity' && n.qn) md.entities!.push(n.qn.slice(n.qn.lastIndexOf('.') + 1));
      n.children?.forEach(walk);
    };
    m.children?.forEach(walk);
    md.hasDomain ||= md.entities!.length > 0;
    modules.set(m.qn!, md);
  }
  return { docs: { modules }, reader: { pageUrl: async () => undefined, entities: async (m) => modules.get(m)?.entities ?? [] } };
}

const byLabel = (a: ExplorerNode, b: ExplorerNode) => Number(!!a.addon) - Number(!!b.addon) || a.label.localeCompare(b.label);

/** One level of the business tree ('' the top). Null: no such level. */
export async function businessLevel(docs: AppDocs, reader: DocReader, at: string): Promise<ExplorerNode[] | null> {
  const mods = [...docs.modules.entries()];
  if (at === '') {
    const pages = mods.reduce((n, [, m]) => n + m.pages.length, 0);
    const logic = mods.reduce((n, [, m]) => n + m.flows.length, 0);
    const data = mods.filter(([, m]) => m.hasDomain).length;
    return GROUPS.filter((g) => g.id === 'pages' || g.id === 'data' || g.id === 'logic').map((g) => ({
      id: g.id,
      label: g.label,
      kind: 'group' as const,
      hint: g.hint,
      folder: true,
      count: g.id === 'pages' ? pages : g.id === 'logic' ? logic : data,
    }));
  }
  const [group, module, ...rest] = at.split('/');
  if (rest.length || !['pages', 'data', 'logic'].includes(group)) return null;
  if (!module) {
    const has = (m: ModuleDocs) => (group === 'pages' ? m.pages.length : group === 'logic' ? m.flows.length : m.hasDomain ? 1 : 0);
    return mods
      .filter(([, m]) => has(m))
      .map(([name, m]): ExplorerNode => ({
        id: `${group}/${name}`,
        label: plainName(name),
        kind: 'module',
        hint: m.addon ? 'A ready-made part from the Marketplace' : 'A part of the app',
        folder: true,
        ...(group === 'data' ? { type: 'domainmodel', qn: name, key: `domainmodel:${name}` } : { count: has(m) }),
        ...(m.addon ? { addon: true } : {}),
      }))
      .sort(byLabel);
  }
  const m = docs.modules.get(module);
  if (!m) return null;
  if (group === 'pages') {
    const urls = await Promise.all(m.pages.map((qn) => reader.pageUrl(qn)));
    return m.pages
      .map((qn, i): ExplorerNode => ({ id: `page:${qn}`, label: plainName(qn), kind: 'page', hint: urls[i] ? `${KIND_HINT.page} · opens at ${urls[i]}` : `${KIND_HINT.page} · opens from another page, shown as a preview`, type: 'page', qn, key: `page:${qn}`, ...(urls[i] ? { url: urls[i] } : {}) }))
      .sort(byLabel);
  }
  if (group === 'logic') {
    return m.flows.map((f): ExplorerNode => ({ id: `${f.type}:${f.qn}`, label: plainName(f.qn), kind: 'flow', hint: KIND_HINT[f.type], type: f.type, qn: f.qn, key: `${f.type}:${f.qn}` })).sort(byLabel);
  }
  const names = m.entities ?? (await reader.entities(module));
  return names.map((e): ExplorerNode => ({ id: `entity:${module}.${e}`, label: plainName(e), kind: 'entity', hint: KIND_HINT.entity, type: 'entity', qn: `${module}.${e}`, key: `domainmodel:${module}` })).sort(byLabel);
}
