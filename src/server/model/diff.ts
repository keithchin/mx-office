// What a branch changed: which documents (by the content hash Studio Pro keeps per unit), and inside
// one diagram which elements (by their ids, which stay the same from commit to commit).

import { list, str, type BsonDoc, type BsonValue } from './bson.js';
import type { DocChange, DocDiff, ModelTreeNode } from '../../shared/model.js';

/** A stable text of a model object for comparing, without nested objects listed in `skip`. */
function fingerprint(o: BsonValue, skip: Set<string>): string {
  if (Array.isArray(o)) return `[${o.map((x) => fingerprint(x, skip)).join(',')}]`;
  if (o && typeof o === 'object') {
    return `{${Object.keys(o)
      .filter((k) => !skip.has(k))
      .sort()
      .map((k) => `${k}:${fingerprint(o[k], skip)}`)
      .join(',')}}`;
  }
  return JSON.stringify(o);
}

/** Every element of a flow unit by id: its objects (loops' insides too) and its flows. */
function flowElements(unit: BsonDoc): Map<string, { fp: string; name: string }> {
  const out = new Map<string, { fp: string; name: string }>();
  const skip = new Set(['ObjectCollection']);
  const walk = (coll: BsonValue | undefined) => {
    for (const o of list((coll as BsonDoc | undefined)?.Objects)) {
      out.set(str(o.$ID), { fp: fingerprint(o, skip), name: str(o.Caption) || str(o.Name) || str(o.$Type).replace(/^.*\$/, '') });
      if (o.ObjectCollection) walk(o.ObjectCollection);
    }
  };
  walk(unit.ObjectCollection);
  for (const f of list(unit.Flows)) out.set(str(f.$ID), { fp: fingerprint(f, skip), name: 'flow' });
  return out;
}

/** Every element of a domain model unit by id: entities, associations and annotations. */
function domainElements(unit: BsonDoc): Map<string, { fp: string; name: string }> {
  const out = new Map<string, { fp: string; name: string }>();
  const none = new Set<string>(['AccessRules']);
  for (const key of ['Entities', 'Associations', 'CrossAssociations', 'Annotations']) {
    for (const o of list(unit[key])) out.set(str(o.$ID), { fp: fingerprint(o, none), name: str(o.Name) || str(o.Caption).slice(0, 40) || key });
  }
  return out;
}

function compare(a: Map<string, { fp: string; name: string }>, b: Map<string, { fp: string; name: string }>): DocDiff {
  const added: string[] = [];
  const changed: string[] = [];
  const removed: string[] = [];
  for (const [id, v] of b) {
    const was = a.get(id);
    if (!was) added.push(id);
    else if (was.fp !== v.fp) changed.push(id);
  }
  for (const [id, v] of a) if (!b.has(id)) removed.push(v.name);
  return { added, changed, removed };
}

/** What changed in one document between its base unit and its branch unit (null: it didn't exist). */
export function diffUnits(kind: string, base: BsonDoc | null, head: BsonDoc | null): DocDiff {
  const of = kind === 'domainmodel' ? domainElements : flowElements;
  return compare(base ? of(base) : new Map(), head ? of(head) : new Map());
}

/** The tree type for a unit key's kind (the index's kinds are the tree's types). */
export function changesFrom(diff: { added: string[]; removed: string[]; changed: string[] }): DocChange[] {
  const one = (key: string, status: DocChange['status']): DocChange => {
    const i = key.indexOf(':');
    return { type: key.slice(0, i), qn: key.slice(i + 1), status };
  };
  return [...diff.added.map((k) => one(k, 'added')), ...diff.changed.map((k) => one(k, 'changed')), ...diff.removed.map((k) => one(k, 'removed'))];
}

/** Documents in two trees that one has and the other hasn't (for when the units can't be read). */
export function treeDiff(base: ModelTreeNode[], head: ModelTreeNode[]): DocChange[] {
  const docs = (nodes: ModelTreeNode[]) => {
    const m = new Map<string, ModelTreeNode>();
    const walk = (ns: ModelTreeNode[]) => {
      for (const n of ns) {
        if (n.qn && DOC_TYPES.has(n.type)) m.set(`${n.type}:${n.qn}`, n);
        if (n.children) walk(n.children);
      }
    };
    walk(nodes);
    return m;
  };
  const a = docs(base);
  const b = docs(head);
  const out: DocChange[] = [];
  for (const k of b.keys()) if (!a.has(k)) out.push(changeOf(k, 'added'));
  for (const k of a.keys()) if (!b.has(k)) out.push(changeOf(k, 'removed'));
  return out;
}

const changeOf = (key: string, status: DocChange['status']): DocChange => ({ type: key.slice(0, key.indexOf(':')), qn: key.slice(key.indexOf(':') + 1), status });

export const DOC_TYPES = new Set(['domainmodel', 'microflow', 'nanoflow', 'page', 'snippet', 'layout', 'enumeration', 'constant', 'javaaction', 'javascriptaction', 'workflow', 'scheduledevent', 'jsonstructure', 'importmapping', 'exportmapping', 'imagecollection', 'rule', 'buildingblock', 'pagetemplate', 'restclient', 'odataclient', 'odataservice', 'publishedrestservice', 'regularexpression', 'queue', 'menu']);
