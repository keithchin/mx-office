// Is what a change points at still there at main's head? (shared/dev-changes.ts ElementRef: a page, snippet or
// layout by qualified name, and optionally a widget on it by name.) Read from the model's units straight out of
// git (model/units.ts), no mxcli, no runtime: the document's unit, then its widget tree for the name. The
// widget's $ID is a hint only and never decides. When the model can't be read here, nothing is claimed.

import type { ElementRef } from '../../shared/dev-changes.js';

/** The bits of a commit's model this reads (model/units.ts CommitModel). */
export interface UnitsAt {
  ix: { byName: Map<string, string>; read(id: string): Promise<unknown> };
}

/** Whether `doc` has a widget named `name` (its own Name excepted): its $Type, or undefined. */
export function findWidget(doc: unknown, name: string): string | undefined {
  let found: string | undefined;
  const walk = (n: unknown, top: boolean) => {
    if (found || !n || typeof n !== 'object') return;
    if (Array.isArray(n)) return n.forEach((x) => walk(x, false));
    const o = n as Record<string, unknown>;
    if (!top && o.Name === name && typeof o.$Type === 'string') return void (found = o.$Type);
    for (const [k, v] of Object.entries(o)) if (k !== '$ID' && v && typeof v === 'object') walk(v, false);
  };
  walk(doc, true);
  return found;
}

/** Why the reference is gone at this commit, in words; undefined when it's there (or can't be told). */
export async function refGone(model: UnitsAt | null | undefined, ref: ElementRef, short: string): Promise<string | undefined> {
  if (!model) return undefined;
  const id = model.ix.byName.get(`${ref.docType}:${ref.docQn}`);
  if (!id) return `The ${ref.docType} ${ref.docQn} isn’t in the app at main @${short} any more: say what you mean now, or cancel the request.`;
  if (!ref.widgetName) return undefined;
  const doc = await model.ix.read(id);
  if (!doc) return undefined;
  if (!findWidget(doc, ref.widgetName)) return `${ref.label ? `${ref.label} (${ref.widgetName})` : ref.widgetName} isn’t on ${ref.docQn} at main @${short} any more: say what you mean now, or cancel the request.`;
  return undefined;
}
