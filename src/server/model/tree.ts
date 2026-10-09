// mxcli's `project-tree` (a JSON list of {label, type, qualifiedName, children}) as the Model tab's
// tree: the same shape with shorter keys, empty child lists dropped, and anything malformed skipped.

import type { ModelTreeNode } from '../../shared/model.js';

interface RawNode {
  label?: unknown;
  type?: unknown;
  qualifiedName?: unknown;
  children?: unknown;
}

const MAX_DEPTH = 40;

function one(raw: RawNode, depth: number): ModelTreeNode | null {
  if (!raw || typeof raw !== 'object' || typeof raw.label !== 'string' || typeof raw.type !== 'string') return null;
  const node: ModelTreeNode = { label: raw.label, type: raw.type };
  if (typeof raw.qualifiedName === 'string' && raw.qualifiedName) node.qn = raw.qualifiedName;
  if (Array.isArray(raw.children) && raw.children.length && depth < MAX_DEPTH) {
    const kids = raw.children.map((c) => one(c as RawNode, depth + 1)).filter((c): c is ModelTreeNode => !!c);
    if (kids.length) node.children = kids;
  }
  return node;
}

export function parseTree(raw: unknown): ModelTreeNode[] {
  if (!Array.isArray(raw)) throw new Error('mxcli project-tree: expected a list');
  return raw.map((r) => one(r as RawNode, 0)).filter((n): n is ModelTreeNode => !!n);
}
