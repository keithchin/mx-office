// A commit's model as the data-impact diff needs it (shared/data-impact.ts ModelSnapshot), read from its
// units (model/units.ts, straight out of git): every module's DomainModel unit (entities with their ids,
// persistability, generalization and attributes with type and whether they're stored; associations with
// storage and delete behaviour) and every Enumeration unit (values by id and name). Nothing here runs
// mxcli or touches a database. A unit that can't be read throws: the caller says `unknown`, which holds.

import { doc, list, str, typeOf, type BsonDoc } from '../model/bson.js';
import { attrType, systemPersistable } from '../model/domain.js';
import type { CommitModel } from '../model/units.js';
import type { ModelSnapshot, SnapAssoc, SnapEntity } from '../../shared/data-impact.js';

const DM = 'DomainModels$DomainModel';
const ENUM = 'Enumerations$Enumeration';

/** The units the diff reads, with their content hashes: equal keys mean nothing it looks at changed. */
export function impactKey(m: CommitModel): string {
  return [...m.ix.units.values()]
    .filter((u) => u.type === DM || u.type === ENUM)
    .map((u) => `${u.id}:${u.hash}`)
    .sort()
    .join('|');
}

const DELETE_WORDS: Record<string, string> = {
  DeleteMeButKeepReferences: 'keep references',
  DeleteMeAndReferences: 'delete the other side too',
  DeleteMeIfNoReferences: 'only if nothing refers to it',
};

/** "String(200)", "Enumeration(Sales.Status)", "Decimal", …: what the diff compares. */
function typeKey(t: BsonDoc | undefined): string {
  const base = attrType(t);
  if (typeOf(t).endsWith('StringAttributeType')) return `String(${Number(t?.Length ?? 0) || 0})`;
  if (typeOf(t).endsWith('EnumerationAttributeType')) return `Enumeration(${str(t?.Enumeration)})`;
  return base;
}

interface RawEntity {
  e: BsonDoc;
  module: string;
}

async function readUnit(m: CommitModel, id: string, what: string): Promise<BsonDoc> {
  const d = await m.ix.read(id);
  if (!d) throw new Error(`couldn't read the ${what}`);
  return d;
}

export async function snapshotOf(m: CommitModel): Promise<ModelSnapshot> {
  const dms = [...m.ix.units.values()].filter((u) => u.type === DM);
  const ens = [...m.ix.units.values()].filter((u) => u.type === ENUM);
  const units = await Promise.all(dms.map(async (u) => ({ module: u.qn, d: await readUnit(m, u.id, `${u.qn || 'a'} domain model`) })));
  const raw = new Map<string, RawEntity>();
  const byId = new Map<string, string>();
  for (const { module, d } of units)
    for (const e of list(d.Entities)) {
      raw.set(`${module}.${str(e.Name)}`, { e, module });
      byId.set(str(e.$ID), `${module}.${str(e.Name)}`);
    }
  // Persistable as the runtime sees it: its own flag, or its generalization's (System's by name), views and external entities never.
  const memo = new Map<string, boolean>();
  const persistable = (qn: string, seen = new Set<string>()): boolean => {
    const known = memo.get(qn);
    if (known !== undefined) return known;
    const r = raw.get(qn);
    if (!r) return systemPersistable(qn) ?? true;
    if (seen.has(qn)) return true;
    seen.add(qn);
    const src = typeOf(doc(r.e.Source));
    const g = doc(r.e.MaybeGeneralization);
    const v = src && /View|Remote|OData|External|Rest\$/i.test(src) ? false : typeOf(g).endsWith('NoGeneralization') ? g?.Persistable !== false : persistable(str(g?.Generalization), seen);
    memo.set(qn, v);
    return v;
  };
  const entities: SnapEntity[] = [...raw.entries()].map(([qn, { e, module }]) => {
    const g = doc(e.MaybeGeneralization);
    return {
      id: str(e.$ID),
      qn,
      module,
      persistable: persistable(qn),
      generalization: typeOf(g).endsWith('$Generalization') ? str(g?.Generalization) : '',
      attrs: list(e.Attributes).map((a) => ({ id: str(a.$ID), name: str(a.Name), type: typeKey(doc(a.NewType) ?? doc(a.Type)), stored: !typeOf(doc(a.Value)).endsWith('CalculatedValue') })),
    };
  });
  const associations: SnapAssoc[] = [];
  for (const { module, d } of units) {
    const add = (a: BsonDoc, cross: boolean) => {
      const del = doc(a.DeleteBehavior);
      const parent = byId.get(str(a.ParentPointer));
      const child = cross ? str(a.Child) : byId.get(str(a.ChildPointer));
      associations.push({
        id: str(a.$ID),
        qn: `${module}.${str(a.Name)}`,
        module,
        storage: `${str(a.Type) === 'ReferenceSet' ? 'ReferenceSet' : 'Reference'}/${str(a.Owner) === 'Both' ? 'Both' : 'Default'}`,
        deleteBehaviour: `parent: ${DELETE_WORDS[str(del?.ParentDeleteBehavior)] ?? (str(del?.ParentDeleteBehavior) || 'keep references')}; child: ${DELETE_WORDS[str(del?.ChildDeleteBehavior)] ?? (str(del?.ChildDeleteBehavior) || 'keep references')}`,
        persistable: (!parent || persistable(parent)) && (!child || persistable(child)),
      });
    };
    for (const a of list(d.Associations)) add(a, false);
    for (const a of list(d.CrossAssociations)) add(a, true);
  }
  const enums = await Promise.all(
    ens.map(async (u) => {
      const d = await readUnit(m, u.id, `enumeration ${u.qn}`);
      return { id: u.id, qn: u.qn, values: list(d.Values).map((v) => ({ id: str(v.$ID), name: str(v.Name) })) };
    }),
  );
  return { entities, associations, enums };
}
