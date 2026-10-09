// The Model tab's wire types: the app's tree (Studio Pro's App Explorer), one document drawn as a
// diagram (a module's domain model, a microflow or nanoflow) or shown as MDL, and what a branch
// changed against main. The server makes these from mxcli's output and the project's units
// (src/server/model/); the page draws them (src/client/ui/model/). Coordinates are Studio Pro's own,
// in its units (1 unit = 1 px at 100% zoom), so a diagram keeps the developer's layout.

export interface ModelTreeNode {
  label: string;
  /** mxcli's node type: module, folder, domainmodel, entity, microflow, nanoflow, page, … */
  type: string;
  qn?: string;
  children?: ModelTreeNode[];
}

/** Which version of the app to look at: the floor's main, or a branch (a worker's, or an open PR's). */
export interface ModelRef {
  /** 'main' or the branch name. */
  ref: string;
  label: string;
  kind: 'main' | 'branch';
  sha?: string;
  worker?: string;
  pr?: number;
  prUrl?: string;
}

export interface ModelRefs {
  refs: ModelRef[];
  /** Why there's nothing to show (no checkout yet, no .mpr in the repo, mxcli missing). */
  problem?: string;
}

export interface ModelTree {
  sha: string;
  ref: string;
  nodes: ModelTreeNode[];
}

/** One end of a flow or the point an element sits at. */
export interface Pt {
  x: number;
  y: number;
}

export type FlowNodeKind =
  | 'start'
  | 'end'
  | 'error'
  | 'break'
  | 'continue'
  | 'action'
  | 'split'
  | 'inheritance'
  | 'merge'
  | 'loop'
  | 'parameter'
  | 'annotation';

export interface FlowNode {
  id: string;
  kind: FlowNodeKind;
  /** Top-left corner and size, in Studio Pro units. */
  x: number;
  y: number;
  w: number;
  h: number;
  caption: string;
  /** The action, for activities: retrieve, change, create, commit, delete, rollback, call-microflow, … */
  action?: string;
  /** mxcli's category (object, retrieve, call, navigation, validation, list, variable, log, …). */
  category?: string;
  details?: string[];
  /** The variable an activity or parameter gives, shown under it: name in black, type in blue. */
  output?: { name: string; type?: string };
  /** A loop this node sits in. */
  parent?: string;
  /** End events: what they return. Splits: the condition. */
  expr?: string;
  /** Commit/refresh markers in the top-right of change and create activities. */
  commit?: boolean;
  refresh?: boolean;
  /** Activity background colour set by the developer (Studio Pro's Background color). */
  color?: string;
  disabled?: boolean;
  /** The node's lines in `mdl` (0-based, inclusive). */
  lines?: [number, number];
}

export interface FlowEdge {
  id: string;
  from: string;
  to: string;
  label?: string;
  error?: boolean;
  annotation?: boolean;
  /** A cubic Bézier: start, two control points, end. */
  path: [Pt, Pt, Pt, Pt];
}

export interface FlowDoc {
  kind: 'microflow' | 'nanoflow';
  name: string;
  returnType?: string;
  nodes: FlowNode[];
  edges: FlowEdge[];
  mdl: string;
  /** Where positions came from: the units (exact sizes) or mxcli's MDL alone (default sizes). */
  source: 'units' | 'mdl';
}

export type EntityKind = 'persistent' | 'nonpersistent' | 'view' | 'external';

export interface DmAttribute {
  name: string;
  type: string;
  calculated?: boolean;
  validation?: boolean;
  def?: string;
}

export interface DmEntity {
  id: string;
  name: string;
  kind: EntityKind;
  x: number;
  y: number;
  attrs: DmAttribute[];
  generalization?: string;
  events?: boolean;
  image?: boolean;
  doc?: string;
  /** External entities: the service they come from. */
  service?: string;
}

export interface DmAssociation {
  id: string;
  name: string;
  /** The entity that holds the reference (Studio Pro's "parent", the owner side for owner Default). */
  parent: string;
  /** An entity id in this module, or for a cross-module association the other entity's qualified name. */
  child: string;
  type: 'Reference' | 'ReferenceSet';
  owner: 'Default' | 'Both';
  cross?: boolean;
  /** Where the line meets each entity, as percentages of its box (Studio Pro's connection points). */
  parentConn?: Pt;
  childConn?: Pt;
  deleteBehavior?: string;
  doc?: string;
}

export interface DmAnnotation {
  id: string;
  text: string;
  x: number;
  y: number;
  w: number;
}

export interface DomainDoc {
  kind: 'domainmodel';
  module: string;
  entities: DmEntity[];
  associations: DmAssociation[];
  annotations: DmAnnotation[];
  source: 'units' | 'mdl';
}

/** Any other document: its MDL, as mxcli describes it. */
export interface TextDoc {
  kind: 'text';
  type: string;
  name: string;
  mdl: string;
}

export type ModelDoc = FlowDoc | DomainDoc | TextDoc;

export type ChangeStatus = 'added' | 'changed' | 'removed';

export interface DocChange {
  /** Tree type (microflow, domainmodel, page, …) and qualified name (the module, for a domain model). */
  type: string;
  qn: string;
  status: ChangeStatus;
}

export interface ModelChanges {
  base: string;
  head: string;
  docs: DocChange[];
}

/** What changed inside one diagram: element ids added or changed on the branch, and removed ones' names. */
export interface DocDiff {
  added: string[];
  changed: string[];
  removed: string[];
}

export interface ModelDocResponse {
  sha: string;
  doc: ModelDoc;
  /** With ?compare=1 on a branch: what changed in this document against main. */
  diff?: DocDiff;
}

/** The address of the Model tab showing one document on one ref. */
export function modelHref(floor: string, ref?: string, doc?: { type: string; qn: string }, changes = false): string {
  const q = new URLSearchParams({ floor, tab: 'model' });
  if (ref && ref !== 'main') q.set('ref', ref);
  if (doc) {
    q.set('doc', doc.qn);
    q.set('type', doc.type);
  }
  if (changes) q.set('changes', '1');
  return `/lite?${q.toString()}`;
}
