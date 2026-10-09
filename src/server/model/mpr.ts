// The units of a Mendix project (never read from the floor's live files): the .mpr is an SQLite
// database with one row per unit (its id, what contains it, a hash of its contents), and the units
// themselves are BSON, in mprcontents/ (MPR v2) or in the row (MPR v1).
//
// The index finds a document's unit by its qualified name and knows each unit's content hash (for
// "what changed" and for keeping answers by content). units.ts builds it from git (`indexUnits` over
// the .mpr's rows, each unit read by blob); `openIndex` builds it from a project on disk. It needs
// node:sqlite (Node 22.5+); without it the views fall back to mxcli alone.

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { decodeBson, guidOf, str, type BsonDoc } from './bson.js';

export interface UnitInfo {
  id: string;
  container: string;
  type: string;
  name: string;
  hash: string;
  /** Module.Name for documents, the module's name for its domain model, '' otherwise. */
  qn: string;
}

export interface UnitIndex {
  units: Map<string, UnitInfo>;
  /** `${kind}:${qn}` (kind: microflow, nanoflow, domainmodel, page, …) → unit id. */
  byName: Map<string, string>;
  read(id: string): Promise<BsonDoc | null>;
}

type Sqlite = { DatabaseSync: new (file: string, opts?: { readOnly?: boolean }) => { prepare(sql: string): { all(): Record<string, unknown>[] }; close(): void } };
let sqlite: Sqlite | null | undefined;

async function loadSqlite(): Promise<Sqlite | null> {
  if (sqlite !== undefined) return sqlite;
  try {
    const name = 'node:sqlite';
    sqlite = (await import(name)) as Sqlite;
  } catch {
    sqlite = null;
  }
  return sqlite;
}

/** Studio Pro's document kinds as the model calls them, by unit $Type. */
export const KIND_OF_TYPE: Record<string, string> = {
  Microflows$Microflow: 'microflow',
  Microflows$Nanoflow: 'nanoflow',
  Microflows$Rule: 'rule',
  DomainModels$DomainModel: 'domainmodel',
  Forms$Page: 'page',
  Forms$Snippet: 'snippet',
  Forms$Layout: 'layout',
  Enumerations$Enumeration: 'enumeration',
  Constants$Constant: 'constant',
  JavaActions$JavaAction: 'javaaction',
  JavaScriptActions$JavaScriptAction: 'javascriptaction',
  Workflows$Workflow: 'workflow',
  ScheduledEvents$ScheduledEvent: 'scheduledevent',
  JsonStructures$JsonStructure: 'jsonstructure',
  ImportMappings$ImportMapping: 'importmapping',
  ExportMappings$ExportMapping: 'exportmapping',
  Images$ImageCollection: 'imagecollection',
  Menus$MenuDocument: 'menu',
  Forms$BuildingBlock: 'buildingblock',
  Forms$PageTemplate: 'pagetemplate',
  Rest$ConsumedRestService: 'restclient',
  Rest$PublishedRestService: 'publishedrestservice',
  Rest$ConsumedODataService: 'odataclient',
  ODataPublish$PublishedODataService2: 'odataservice',
  RegularExpressions$RegularExpression: 'regularexpression',
  Queues$Queue: 'queue',
};

function unitFile(projectDir: string, id: string): string {
  return path.join(projectDir, 'mprcontents', id.slice(0, 2), id.slice(2, 4), `${id}.mxunit`);
}

export interface UnitRow {
  id: string;
  container: string;
  /** Studio Pro's ContentsHash column. */
  hash: string;
  /** The unit itself, in an MPR v1 project (whose units live in the .mpr). */
  contents?: Uint8Array;
}

/** The unit table of `mprFile` (null without node:sqlite). Synchronous inside, but an MPR v2 .mpr is small. */
export async function readUnitRows(mprFile: string): Promise<{ rows: UnitRow[]; v1: boolean } | null> {
  const lib = await loadSqlite();
  if (!lib) return null;
  let raw: Record<string, unknown>[];
  let v1 = false;
  const db = new lib.DatabaseSync(mprFile, { readOnly: true });
  try {
    const cols = db.prepare("select name from pragma_table_info('Unit')").all().map((r) => String(r.name));
    v1 = cols.includes('Contents');
    raw = db.prepare(`select UnitID, ContainerID, ContentsHash${v1 ? ', Contents' : ''} from Unit`).all();
  } finally {
    db.close();
  }
  const rows = raw.map((r): UnitRow => {
    const id = guidOf(r.UnitID as Uint8Array);
    return { id, container: r.ContainerID ? guidOf(r.ContainerID as Uint8Array) : '', hash: String(r.ContentsHash ?? ''), contents: v1 && r.Contents ? (r.Contents as Uint8Array) : undefined };
  });
  return { rows, v1 };
}

/** What a unit's top level says (its type and name), kept by content hash so a unit is looked at once. */
export type UnitMeta = Map<string, { type: string; name: string }>;
const META_MAX = 50_000;

/**
 * The index of a project's units: each row's type and name (from its top level, read with `readRaw`),
 * its module, and documents by kind and qualified name. `hashOf` gives a unit's content hash (the
 * ContentsHash column, or the unit's git blob); `meta` keeps what was read by that hash.
 */
export async function indexUnits(rows: UnitRow[], readRaw: (id: string) => Promise<Uint8Array | null>, hashOf: (r: UnitRow) => string = (r) => r.hash, meta?: UnitMeta): Promise<UnitIndex> {
  const units = new Map<string, UnitInfo>();
  for (const r of rows) units.set(r.id, { id: r.id, container: r.container, type: '', name: '', hash: hashOf(r), qn: '' });
  // Only the top level of each unit: its type and name (nested documents are skipped by length).
  await Promise.all(
    [...units.values()].map(async (u) => {
      const known = u.hash ? meta?.get(u.hash) : undefined;
      if (known) return void Object.assign(u, known);
      const raw = await readRaw(u.id);
      if (!raw) return;
      try {
        const top = decodeBson(raw, 0);
        u.type = str(top.$Type);
        u.name = str(top.Name);
        if (meta && u.hash) {
          if (meta.size >= META_MAX) meta.clear();
          meta.set(u.hash, { type: u.type, name: u.name });
        }
      } catch {
        /* a unit we can't read is left nameless */
      }
    }),
  );
  const moduleOf = (u: UnitInfo): UnitInfo | undefined => {
    let cur: UnitInfo | undefined = u;
    for (let i = 0; cur && i < 64; i++) {
      if (cur.type === 'Projects$ModuleImpl' || cur.type === 'Projects$Module') return cur;
      if (!cur.container || cur.container === cur.id) return undefined;
      cur = units.get(cur.container);
    }
    return undefined;
  };
  const byName = new Map<string, string>();
  for (const u of units.values()) {
    const kind = KIND_OF_TYPE[u.type];
    if (!kind) continue;
    const mod = moduleOf(u);
    if (!mod) continue;
    u.qn = kind === 'domainmodel' ? mod.name : `${mod.name}.${u.name}`;
    byName.set(`${kind}:${u.qn}`, u.id);
  }
  return {
    units,
    byName,
    async read(id) {
      const raw = await readRaw(id);
      if (!raw) return null;
      try {
        return decodeBson(raw);
      } catch {
        return null;
      }
    },
  };
}

/** Reads the unit table of `mprFile` and the top-level fields of every unit (from mprcontents/ beside it, or the .mpr for v1). */
export async function openIndex(mprFile: string): Promise<UnitIndex | null> {
  const t = await readUnitRows(mprFile);
  if (!t) return null;
  const projectDir = path.dirname(mprFile);
  const v1 = new Map(t.rows.filter((r) => r.contents).map((r) => [r.id, r.contents as Uint8Array]));
  const readRaw = async (id: string): Promise<Uint8Array | null> => {
    if (t.v1) return v1.get(id) ?? null;
    try {
      return await readFile(unitFile(projectDir, id));
    } catch {
      return null;
    }
  };
  return indexUnits(t.rows, readRaw);
}

/** Documents (by `${kind}:${qn}`) whose contents differ between two indexes. */
export function diffIndexes(base: UnitIndex, head: UnitIndex): { added: string[]; removed: string[]; changed: string[] } {
  const hashes = (ix: UnitIndex) => {
    const m = new Map<string, string>();
    for (const [key, id] of ix.byName) m.set(key, ix.units.get(id)?.hash ?? '');
    return m;
  };
  const a = hashes(base);
  const b = hashes(head);
  const added: string[] = [];
  const removed: string[] = [];
  const changed: string[] = [];
  for (const [k, h] of b) {
    if (!a.has(k)) added.push(k);
    else if (a.get(k) !== h) changed.push(k);
  }
  for (const k of a.keys()) if (!b.has(k)) removed.push(k);
  return { added: added.sort(), removed: removed.sort(), changed: changed.sort() };
}
