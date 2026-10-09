// A module's domain model as the page draws it: its entities where the developer put them, with
// their type (persistable, non-persistable, view, external), attributes and markers, its
// associations with owner and multiplicity, and its annotations. From the module's DomainModel unit
// when the units can be read; otherwise from mxcli (its elk description of the module's entities and
// associations, and each entity's `@Position` in its MDL).

import { doc, list, point, str, typeOf, type BsonDoc } from './bson.js';
import { short } from './flow-actions.js';
import type { DmAssociation, DmAttribute, DmEntity, DomainDoc, EntityKind } from '../../shared/model.js';

const ATTR_TYPE: Record<string, string> = {
  StringAttributeType: 'String',
  IntegerAttributeType: 'Integer',
  LongAttributeType: 'Long',
  DecimalAttributeType: 'Decimal',
  FloatAttributeType: 'Float',
  CurrencyAttributeType: 'Currency',
  BooleanAttributeType: 'Boolean',
  DateTimeAttributeType: 'Date and time',
  AutoNumberAttributeType: 'AutoNumber',
  EnumerationAttributeType: 'Enumeration',
  HashedStringAttributeType: 'Hashed string',
  BinaryAttributeType: 'Binary',
};

/** An attribute type as Studio Pro writes it in the entity box: "String", "Date and time", … */
export function attrType(t: BsonDoc | undefined): string {
  const k = typeOf(t).replace(/^DomainModels\$/, '');
  return ATTR_TYPE[k] ?? k.replace(/AttributeType$/, '');
}

/** Persistable entities in other modules, for specializations (System's are all persistable but a few). */
export type PersistableOf = (qn: string) => boolean | undefined;

const SYSTEM_NON_PERSISTENT = new Set(['System.Paging', 'System.SynchronizationErrorFile']);
export const systemPersistable: PersistableOf = (qn) => (qn.startsWith('System.') ? !SYSTEM_NON_PERSISTENT.has(qn) : undefined);

function kindOf(e: BsonDoc, persistable: (gen: string) => boolean): { kind: EntityKind; service?: string } {
  const src = doc(e.Source);
  const st = typeOf(src);
  if (/View/i.test(st)) return { kind: 'view' };
  if (st && /Remote|OData|External|Rest\$/i.test(st)) return { kind: 'external', service: short(str(src?.SourceDocument) || str(src?.ServiceName) || str(src?.Service)) || undefined };
  const g = doc(e.MaybeGeneralization);
  if (typeOf(g).endsWith('NoGeneralization')) return { kind: g?.Persistable === false ? 'nonpersistent' : 'persistent' };
  return { kind: persistable(str(g?.Generalization)) ? 'persistent' : 'nonpersistent' };
}

/** The domain model of `module` from its unit. `others` says whether an entity elsewhere is persistable. */
export function parseDomain(module: string, unit: BsonDoc, others: PersistableOf = systemPersistable): DomainDoc {
  const raw = list(unit.Entities);
  const byName = new Map(raw.map((e) => [`${module}.${str(e.Name)}`, e]));
  const seen = new Set<string>();
  const persistable = (qn: string): boolean => {
    const local = byName.get(qn);
    if (!local) return others(qn) ?? true;
    if (seen.has(qn)) return true;
    seen.add(qn);
    try {
      return kindOf(local, persistable).kind === 'persistent';
    } finally {
      seen.delete(qn);
    }
  };
  const entities: DmEntity[] = raw.map((e) => {
    const name = str(e.Name);
    const validated = new Set(list(e.ValidationRules).map((r) => short(str(r.Attribute))));
    const attrs: DmAttribute[] = list(e.Attributes).map((a) => {
      const value = doc(a.Value);
      const at: DmAttribute = { name: str(a.Name), type: attrType(doc(a.NewType) ?? doc(a.Type)) };
      if (typeOf(value).endsWith('CalculatedValue')) at.calculated = true;
      if (validated.has(at.name)) at.validation = true;
      const def = str(value?.DefaultValue);
      if (def) at.def = def;
      return at;
    });
    const { kind, service } = kindOf(e, persistable);
    const g = doc(e.MaybeGeneralization);
    const ent: DmEntity = { id: str(e.$ID), name, kind, ...point(e.Location), attrs };
    if (typeOf(g).endsWith('$Generalization')) ent.generalization = str(g?.Generalization);
    if (list(e.Events).length) ent.events = true;
    if (str(e.Image)) ent.image = true;
    if (str(e.Documentation)) ent.doc = str(e.Documentation);
    if (service) ent.service = service;
    return ent;
  });
  const assoc = (a: BsonDoc, cross: boolean): DmAssociation => {
    const del = doc(a.DeleteBehavior);
    const out: DmAssociation = {
      id: str(a.$ID),
      name: str(a.Name),
      parent: str(a.ParentPointer),
      child: cross ? str(a.Child) : str(a.ChildPointer),
      type: str(a.Type) === 'ReferenceSet' ? 'ReferenceSet' : 'Reference',
      owner: str(a.Owner) === 'Both' ? 'Both' : 'Default',
    };
    if (cross) out.cross = true;
    if (a.ParentConnection != null) out.parentConn = point(a.ParentConnection);
    if (a.ChildConnection != null) out.childConn = point(a.ChildConnection);
    const behave = [str(del?.ParentDeleteBehavior), str(del?.ChildDeleteBehavior)].filter((b) => b && b !== 'DeleteMeButKeepReferences');
    if (behave.length) out.deleteBehavior = behave.join(', ');
    if (str(a.Documentation)) out.doc = str(a.Documentation);
    return out;
  };
  return {
    kind: 'domainmodel',
    module,
    entities,
    associations: [...list(unit.Associations).map((a) => assoc(a, false)), ...list(unit.CrossAssociations).map((a) => assoc(a, true))],
    annotations: list(unit.Annotations).map((a) => ({ id: str(a.$ID), text: str(a.Caption).replace(/\r\n/g, '\n'), ...point(a.Location), w: Number(a.Width) || 200 })),
    source: 'units',
  };
}

/** mxcli's elk description of a module's domain model (`describe --format elk entity M.E`). */
export interface ElkDomain {
  moduleName: string;
  entities?: { id: string; name: string; category?: string; attributes?: { name: string; type: string }[] | null }[] | null;
  associations?: { id: string; sourceId: string; targetId: string; name: string; type?: string }[] | null;
  generalizations?: { childId: string; parentId: string; parentName: string }[] | null;
}

const ELK_KIND: Record<string, EntityKind> = { persistent: 'persistent', nonpersistent: 'nonpersistent', view: 'view', external: 'external' };

/** From mxcli alone: elk's entities at the positions their MDL gives, owners from `list associations`. */
export function domainFromElk(elk: ElkDomain, positions: Map<string, { x: number; y: number }>, owners: Map<string, string> = new Map(), annotations: DomainDoc['annotations'] = []): DomainDoc {
  const gens = new Map((elk.generalizations ?? []).map((g) => [g.childId, g.parentName]));
  const local = (elk.entities ?? []).filter((e) => !e.name.includes('.'));
  const names = new Map(local.map((e) => [e.id, e.name]));
  let col = 0;
  const entities: DmEntity[] = local.map((e) => {
    const pos = positions.get(e.name) ?? { x: 40 + 260 * col++, y: 40 };
    const ent: DmEntity = { id: e.id, name: e.name, kind: ELK_KIND[e.category ?? ''] ?? 'persistent', ...pos, attrs: (e.attributes ?? []).map((a) => ({ name: a.name, type: a.type === 'DateTime' ? 'Date and time' : a.type })) };
    const g = gens.get(e.id);
    if (g) ent.generalization = g;
    return ent;
  });
  const external = new Map((elk.entities ?? []).filter((e) => e.name.includes('.')).map((e) => [e.id, e.name]));
  const associations: DmAssociation[] = (elk.associations ?? []).flatMap((a): DmAssociation[] => {
    // elk draws an association from the entity it points at (child) to the one holding it (parent).
    const parent = names.has(a.targetId) ? a.targetId : undefined;
    if (!parent) return [];
    const childLocal = names.has(a.sourceId);
    const child = childLocal ? a.sourceId : external.get(a.sourceId);
    if (!child) return [];
    return [{ id: a.id, name: a.name, parent, child, type: /set/i.test(a.type ?? '') ? 'ReferenceSet' : 'Reference', owner: owners.get(a.name) === 'Both' ? 'Both' : 'Default', ...(childLocal ? {} : { cross: true }) }];
  });
  return { kind: 'domainmodel', module: elk.moduleName, entities, associations, annotations, source: 'mdl' };
}

/** `@Position(x, y)` before each `create … entity Module.Name` in a stream of MDL. */
export function entityPositions(mdl: string): Map<string, { x: number; y: number }> {
  const out = new Map<string, { x: number; y: number }>();
  const re = /@Position\(\s*(-?\d+)\s*,\s*(-?\d+)\s*\)\s*\n\s*create\s+(?:or\s+modify\s+)?[\w-]*\s*entity\s+[\w]+\.(\w+)/gi;
  for (const m of mdl.matchAll(re)) out.set(m[3], { x: Number(m[1]), y: Number(m[2]) });
  return out;
}
