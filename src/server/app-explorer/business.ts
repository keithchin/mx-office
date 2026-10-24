// The explorer's business tree (shared/app-explorer.ts), one level at a time, from the app at a commit:
//
//   ''                         Pages, Data, Logic, each with the app's own count and what the Marketplace adds
//   pages                      the app's own modules that have pages, then one folded "Marketplace modules" group
//   pages/@marketplace         the Marketplace modules that have pages
//   pages/<Module>[/<folder>…] the module's folders (as in the model, only those with pages) then its pages, each
//                              labelled with its own title (the technical name Module.Page in the details line)
//   data, data/<Module>        modules with kinds of records (none without), then their entities
//   logic, logic/<Module>[/…]  modules with logic, then their folders, microflows and nanoflows
//
// Read from the commit's units (server/model/units.ts: the unit index by name, each unit by its content
// hash), so it costs no mxcli and needs no running app; a commit's levels are worked out once. A module is a
// Marketplace module when its unit says so (FromAppStore, or an App Store id or version), never by its name.
// Without node:sqlite it falls back to the Model tab's tree (mxcli), which has the same documents but no
// titles, addresses, folders or Marketplace flags.

import { list, str, type BsonDoc } from '../model/bson.js';
import type { CommitModel } from '../model/units.js';
import { GROUPS, KIND_HINT, MARKETPLACE, pageUrl, plainName, type ExplorerNode } from '../../shared/app-explorer.js';
import type { ModelTreeNode } from '../../shared/model.js';

/** A page or flow of a module, with the folders it sits in (as in the model). */
export interface DocRef {
  qn: string;
  folder: string[];
}

/** What the tree is built from: per module, its pages, flows and entities (and whether it's from the Marketplace). */
export interface AppDocs {
  modules: Map<string, ModuleDocs>;
}
export interface ModuleDocs {
  addon: boolean;
  /** The Marketplace module's version, when its unit says. */
  addonVersion?: string;
  pages: DocRef[];
  flows: (DocRef & { type: 'microflow' | 'nanoflow' })[];
  /** Entity names (unqualified), or undefined until read. */
  entities?: string[];
  hasDomain: boolean;
}

/** A page's own words: its title and its address in the running app. */
export interface PageInfo {
  title?: string;
  url?: string;
}

/** Reads what's needed lazily: a page's title and Url, a module's entities. */
export interface DocReader {
  page(qn: string): Promise<PageInfo>;
  entities(module: string): Promise<string[]>;
}

const pageCache = new Map<string, PageInfo>();
const entityCache = new Map<string, string[]>();
const addonCache = new Map<string, { addon: boolean; version?: string }>();
const bound = (m: Map<string, unknown>, n: number) => {
  while (m.size > n) m.delete(m.keys().next().value as string);
};

/** A text's words in English when it has them, else its first translation. */
export function textOf(t: unknown): string | undefined {
  if (typeof t === 'string') return t.trim() || undefined;
  const items = list((t as BsonDoc | undefined)?.Items).map((x) => ({ lang: str(x.LanguageCode), text: str(x.Text).trim() })).filter((x) => x.text);
  return (items.find((x) => x.lang === 'en_US') ?? items.find((x) => /^en/i.test(x.lang)) ?? items[0])?.text;
}

/** A module unit from the Marketplace: its own flag, or an App Store id or version (names are never used). */
export function marketplaceOf(d: BsonDoc | null): { addon: boolean; version?: string } {
  if (!d) return { addon: false };
  const version = str(d.AppStoreVersion) || undefined;
  const addon = d.FromAppStore === true || !!str(d.AppStoreGuid) || !!str(d.AppStorePackageIdString) || !!version;
  return { addon, ...(addon && version ? { version } : {}) };
}

/** The documents of a commit's units. */
export async function docsOfUnits(cm: CommitModel): Promise<{ docs: AppDocs; reader: DocReader }> {
  const modules = new Map<string, ModuleDocs>();
  const units = cm.ix.units;
  const mod = (name: string) => {
    let m = modules.get(name);
    if (!m) modules.set(name, (m = { addon: false, pages: [], flows: [], hasDomain: false }));
    return m;
  };
  /** The folders between a document and its module, outermost first. */
  const foldersOf = (container: string): string[] => {
    const out: string[] = [];
    let cur = units.get(container);
    for (let i = 0; cur && i < 64 && cur.type === 'Projects$Folder'; i++) {
      out.unshift(cur.name);
      cur = cur.container && cur.container !== cur.id ? units.get(cur.container) : undefined;
    }
    return out;
  };
  for (const u of units.values()) {
    if (!u.qn) continue;
    if (u.type === 'DomainModels$DomainModel') {
      mod(u.qn).hasDomain = true;
      continue;
    }
    const dot = u.qn.indexOf('.');
    if (dot < 1) continue;
    const module = u.qn.slice(0, dot);
    if (u.type === 'Forms$Page') mod(module).pages.push({ qn: u.qn, folder: foldersOf(u.container) });
    else if (u.type === 'Microflows$Microflow' || u.type === 'Microflows$Nanoflow') mod(module).flows.push({ type: u.type === 'Microflows$Microflow' ? 'microflow' : 'nanoflow', qn: u.qn, folder: foldersOf(u.container) });
  }
  // Marketplace modules: what the module unit says (read once per content hash).
  await Promise.all(
    [...units.values()]
      .filter((u) => (u.type === 'Projects$ModuleImpl' || u.type === 'Projects$Module') && modules.has(u.name))
      .map(async (u) => {
        let a = u.hash ? addonCache.get(u.hash) : undefined;
        if (a === undefined) {
          a = marketplaceOf(await cm.ix.read(u.id));
          if (u.hash) addonCache.set(u.hash, a), bound(addonCache, 5000);
        }
        const m = modules.get(u.name)!;
        m.addon = a.addon;
        if (a.version) m.addonVersion = a.version;
      }),
  );
  const reader: DocReader = {
    async page(qn) {
      const h = cm.hashOf(`page:${qn}`);
      const hit = h ? pageCache.get(h) : undefined;
      if (hit) return hit;
      const id = cm.ix.byName.get(`page:${qn}`);
      const d: BsonDoc | null = id ? await cm.ix.read(id) : null;
      const url = pageUrl(str(d?.Url));
      const title = textOf(d?.Title);
      const info: PageInfo = { ...(title ? { title } : {}), ...(url ? { url } : {}) };
      if (h) pageCache.set(h, info), bound(pageCache, 20_000);
      return info;
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
    const walk = (n: ModelTreeNode, folder: string[]) => {
      if (n.type === 'page' && n.qn) md.pages.push({ qn: n.qn, folder });
      else if ((n.type === 'microflow' || n.type === 'nanoflow') && n.qn) md.flows.push({ type: n.type, qn: n.qn, folder });
      else if (n.type === 'domainmodel') md.hasDomain = true;
      else if (n.type === 'entity' && n.qn) md.entities!.push(n.qn.slice(n.qn.lastIndexOf('.') + 1));
      const sub = n.type === 'folder' && n.label ? [...folder, n.label] : folder;
      n.children?.forEach((c) => walk(c, sub));
    };
    m.children?.forEach((c) => walk(c, []));
    md.hasDomain ||= md.entities!.length > 0;
    modules.set(m.qn!, md);
  }
  return { docs: { modules }, reader: { page: async () => ({}), entities: async (m) => modules.get(m)?.entities ?? [] } };
}

const byLabel = (a: ExplorerNode, b: ExplorerNode) => a.label.localeCompare(b.label);
const enc = (s: string) => encodeURIComponent(s);

type Group = 'pages' | 'data' | 'logic';

/** How much of a group's kind a module has (entities are read for Data). */
async function sizeIn(group: Group, m: ModuleDocs, name: string, reader: DocReader): Promise<number> {
  if (group === 'pages') return m.pages.length;
  if (group === 'logic') return m.flows.length;
  if (!m.hasDomain) return 0;
  return (m.entities ?? (await reader.entities(name))).length;
}

const docsIn = (group: Group, m: ModuleDocs): DocRef[] => (group === 'pages' ? m.pages : group === 'logic' ? m.flows : []);

const GROUP_WORD: Record<Group, [string, string]> = { pages: ['page', 'pages'], data: ['kind of record', 'kinds of records'], logic: ['piece of logic', 'pieces of logic'] };
const words = (g: Group, n: number) => `${n} ${GROUP_WORD[g][n === 1 ? 0 : 1]}`;

/** One level of the business tree ('' the top). Null: no such level. */
export async function businessLevel(docs: AppDocs, reader: DocReader, at: string): Promise<ExplorerNode[] | null> {
  const mods = [...docs.modules.entries()];
  if (at === '') {
    const out: ExplorerNode[] = [];
    for (const g of GROUPS.filter((x) => x.id === 'pages' || x.id === 'data' || x.id === 'logic')) {
      const group = g.id as Group;
      let own = 0;
      let addon = 0;
      for (const [name, m] of mods) {
        const n = await sizeIn(group, m, name, reader);
        if (m.addon) addon += n;
        else own += n;
      }
      out.push({
        id: g.id,
        label: g.label,
        kind: 'group',
        hint: `${g.hint}. ${words(group, own)} in the app’s own modules${addon ? `; Marketplace modules add ${addon} more (${own + addon} in all)` : ''}.`,
        folder: true,
        count: own,
        ...(addon ? { addonCount: addon } : {}),
      });
    }
    return out;
  }
  const parts = at.split('/');
  const group = parts[0] as Group;
  if (!['pages', 'data', 'logic'].includes(group)) return null;
  const module = parts[1] !== undefined ? decodeURIComponent(parts[1]) : undefined;
  const moduleNode = async (name: string, m: ModuleDocs): Promise<ExplorerNode | null> => {
    const n = await sizeIn(group, m, name, reader);
    if (!n) return null;
    return {
      id: `${group}/${enc(name)}`,
      label: plainName(name),
      kind: 'module',
      hint: `${m.addon ? `A ready-made module from the Marketplace${m.addonVersion ? `, version ${m.addonVersion}` : ''}` : 'A part of the app'} (${name}): ${words(group, n)}`,
      folder: true,
      count: n,
      detail: name,
      ...(group === 'data' ? { type: 'domainmodel', qn: name, key: `domainmodel:${name}` } : {}),
      ...(m.addon ? { addon: true } : {}),
    };
  };
  if (module === undefined || module === MARKETPLACE) {
    if (parts.length > 2) return null;
    const wantAddon = module === MARKETPLACE;
    const nodes = (await Promise.all(mods.filter(([, m]) => m.addon === wantAddon).map(([name, m]) => moduleNode(name, m)))).filter((n): n is ExplorerNode => !!n).sort(byLabel);
    if (wantAddon) return nodes;
    const market = (await Promise.all(mods.filter(([, m]) => m.addon).map(([name, m]) => sizeIn(group, m, name, reader)))).reduce((a, b) => a + b, 0);
    if (market) {
      const n = mods.filter(([, m]) => m.addon).length;
      nodes.push({ id: `${group}/${MARKETPLACE}`, label: 'Marketplace modules', kind: 'module', folder: true, count: market, addon: true, hint: `Ready-made modules from the Marketplace, folded together: ${words(group, market)} in ${n} module${n === 1 ? '' : 's'} (not counted as the app’s own)` });
    }
    return nodes;
  }
  const m = docs.modules.get(module);
  if (!m) return null;
  if (group === 'data') {
    if (parts.length > 2) return null;
    const names = m.entities ?? (await reader.entities(module));
    return names.map((e): ExplorerNode => ({ id: `entity:${module}.${e}`, label: plainName(e), kind: 'entity', hint: `${KIND_HINT.entity} (${module}.${e})`, type: 'entity', qn: `${module}.${e}`, key: `domainmodel:${module}`, detail: `${module}.${e}` })).sort(byLabel);
  }
  const folder = parts.slice(2).map((s) => decodeURIComponent(s));
  const all = docsIn(group, m);
  const inside = all.filter((d) => folder.every((f, i) => d.folder[i] === f) && d.folder.length >= folder.length);
  if (folder.length && !inside.length) return null;
  const subs = new Map<string, number>();
  for (const d of inside) if (d.folder.length > folder.length) subs.set(d.folder[folder.length], (subs.get(d.folder[folder.length]) ?? 0) + 1);
  const here = inside.filter((d) => d.folder.length === folder.length);
  const base = `${group}/${enc(module)}${folder.map((f) => `/${enc(f)}`).join('')}`;
  const folders = [...subs.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([name, n]): ExplorerNode => ({ id: `${base}/${enc(name)}`, label: name, kind: 'folder', folder: true, count: n, hint: `A folder of ${module} in the model: ${words(group, n)}`, detail: [module, ...folder, name].join(' › '), ...(m.addon ? { addon: true } : {}) }));
  const where = (d: DocRef) => [module, ...d.folder].join(' › ');
  if (group === 'pages') {
    const infos = await Promise.all(here.map((d) => reader.page(d.qn)));
    const pages = here
      .map((d, i): ExplorerNode => {
        const { title, url } = infos[i];
        const label = title || plainName(d.qn);
        return {
          id: `page:${d.qn}`,
          label,
          kind: 'page',
          hint: `${KIND_HINT.page}: ${d.qn}${url ? ` · in the running app at ${url}` : ' · opens from another page'}`,
          type: 'page',
          qn: d.qn,
          key: `page:${d.qn}`,
          detail: `${d.qn} · ${where(d)}`,
          ...(url ? { url } : {}),
          ...(m.addon ? { addon: true } : {}),
        };
      })
      .sort(byLabel);
    return [...folders, ...pages];
  }
  const flows = (here as ModuleDocs['flows'])
    .map((f): ExplorerNode => ({ id: `${f.type}:${f.qn}`, label: plainName(f.qn), kind: 'flow', hint: `${KIND_HINT[f.type]}: ${f.qn}`, type: f.type, qn: f.qn, key: `${f.type}:${f.qn}`, detail: `${f.qn} · ${where(f)}`, ...(m.addon ? { addon: true } : {}) }))
    .sort(byLabel);
  return [...folders, ...flows];
}

/** Every level of the tree at once, from the top down (for the search: folded groups included). */
export async function businessIndex(docs: AppDocs, reader: DocReader): Promise<Record<string, ExplorerNode[]>> {
  const levels: Record<string, ExplorerNode[]> = {};
  const walk = async (at: string): Promise<void> => {
    const nodes = await businessLevel(docs, reader, at);
    if (!nodes) return;
    levels[at] = nodes;
    await Promise.all(nodes.filter((n) => n.folder).map((n) => walk(n.id)));
  };
  await walk('');
  return levels;
}
