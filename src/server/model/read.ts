// A diagram straight from a commit's units (units.ts), with no mxcli: a microflow or nanoflow from its
// unit (and, for retrieves over an association, the domain models those lead into), a domain model
// from its unit (and the domain models its specializations' parents are in). Each comes with the key
// it's kept under (store.ts): the hashes of exactly the units it was read from, so it's found again on
// any commit where those units are the same.
//
// Also the MDL lines of each element, from mxcli's elk description, for the MDL beside the diagram,
// which now comes after the diagram rather than before it.

import { doc, list, str, type BsonDoc } from './bson.js';
import { parseDomain, systemPersistable } from './domain.js';
import { short } from './flow-actions.js';
import { locate, parseFlow, type ElkFlow } from './flow.js';
import { keyOf } from './store.js';
import type { CommitModel } from './units.js';
import type { DomainDoc, FlowDoc } from '../../shared/model.js';

/** Bumped when a diagram read from the units changes shape, so older answers are read again. */
export const READ_VERSION = 2;

export interface Read<T> {
  key: string;
  build: () => T;
}

const moduleOf = (qn: string) => qn.slice(0, qn.indexOf('.'));

/** A flow's unit, the domain models it reads, and its key; null when the commit has no such flow. */
export async function readFlow(cm: CommitModel, type: 'microflow' | 'nanoflow', qn: string): Promise<Read<FlowDoc> | null> {
  const id = cm.ix.byName.get(`${type}:${qn}`);
  const unit = id ? await cm.ix.read(id) : null;
  if (!unit) return null;
  // Retrieves over an association: which entity each association leads to, from its module's domain model.
  const assocs = new Set<string>();
  JSON.stringify(unit, (k, v) => (k === 'AssociationId' && typeof v === 'string' && v && assocs.add(v), v));
  const targets = new Map<string, string>();
  const deps = new Set<string>();
  for (const a of assocs) {
    const mod = moduleOf(a);
    const dmKey = `domainmodel:${mod}`;
    deps.add(`${dmKey}=${cm.hashOf(dmKey)}`);
    const dm = cm.ix.byName.get(dmKey);
    const u = dm ? await cm.ix.read(dm) : null;
    const found = list(u?.Associations).find((x) => str(x.Name) === short(a));
    const child = list(u?.Entities).find((e) => str(e.$ID) === str(found?.ChildPointer));
    if (child) targets.set(a, `${mod}.${str(child.Name)}`);
  }
  const key = keyOf(`v${READ_VERSION}`, 'flow', type, qn, cm.hashOf(`${type}:${qn}`), ...[...deps].sort());
  return { key, build: () => parseFlow(type, qn, null, unit, (a) => targets.get(a)) };
}

/** A module's domain model from its unit, and its key; null when there's no such unit. */
export async function readDomain(cm: CommitModel, module: string): Promise<Read<DomainDoc> | null> {
  const id = cm.ix.byName.get(`domainmodel:${module}`);
  const unit = id ? await cm.ix.read(id) : null;
  if (!unit) return null;
  const persistable = new Map<string, boolean>();
  const deps = new Set<string>();
  for (const e of list(unit.Entities)) {
    const g = str(doc(e.MaybeGeneralization)?.Generalization);
    if (!g || g.startsWith(`${module}.`) || g.startsWith('System.')) continue;
    const otherKey = `domainmodel:${moduleOf(g)}`;
    deps.add(`${otherKey}=${cm.hashOf(otherKey)}`);
    const other = cm.ix.byName.get(otherKey);
    const ou: BsonDoc | null = other ? await cm.ix.read(other) : null;
    const pe = ou ? parseDomain(moduleOf(g), ou).entities.find((x) => x.name === short(g)) : undefined;
    if (pe) persistable.set(g, pe.kind === 'persistent');
  }
  const key = keyOf(`v${READ_VERSION}`, 'domain', module, cm.hashOf(`domainmodel:${module}`), ...[...deps].sort());
  return { key, build: () => parseDomain(module, unit, (qn) => persistable.get(qn) ?? systemPersistable(qn)) };
}

/** A flow's MDL and each element's lines in it (by element id), from mxcli's elk description. */
export interface FlowMdl {
  mdl: string;
  lines: Record<string, [number, number]>;
}

export function mdlOf(elk: ElkFlow): FlowMdl {
  const mdl = elk.mdlSource ?? '';
  const lines: Record<string, [number, number]> = {};
  for (const [id, at] of locate(mdl.split('\n'), elk.nodes ?? [], elk.sourceMap)) lines[id] = [at.from, at.to];
  return { mdl, lines };
}

/** The flow with its MDL put in: the text, and each element's lines. */
export function withMdl(flow: FlowDoc, m: FlowMdl): FlowDoc {
  return { ...flow, mdl: m.mdl, mdlLater: undefined, nodes: flow.nodes.map((n) => (m.lines[n.id] ? { ...n, lines: m.lines[n.id] } : n)) };
}
