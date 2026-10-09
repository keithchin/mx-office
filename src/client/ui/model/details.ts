// The details beside the diagram: what the element you clicked is and does (an activity's action,
// condition and variable, an entity's attributes and associations, an association's owner and
// multiplicity) with its MDL, or with nothing picked the document itself and, on a branch, what changed.

import type { DocChange, DocDiff, DomainDoc, FlowDoc, ModelDoc } from '../../../shared/model';
import { h } from '../dom';
import { treeIcon } from './icons';

const icon = (type: string) => {
  const el = h('span.mx-tico');
  el.innerHTML = treeIcon(type);
  return el;
};

const KIND_LABEL: Record<string, string> = {
  start: 'Start event',
  end: 'End event',
  error: 'Error event',
  break: 'Break event',
  continue: 'Continue event',
  action: 'Activity',
  split: 'Decision',
  inheritance: 'Object type decision',
  merge: 'Merge',
  loop: 'Loop',
  parameter: 'Parameter',
  annotation: 'Annotation',
};
const ENTITY_LABEL = { persistent: 'Persistable entity', nonpersistent: 'Non-persistable entity', view: 'View entity', external: 'External entity' };

function kv(rows: [string, string | undefined | null][]): HTMLElement {
  const dl = h('dl.mx-kv');
  for (const [k, v] of rows) if (v) dl.append(h('dt', {}, k), h('dd', {}, v));
  return dl;
}

function mdlBlock(mdl: string, lines?: [number, number]): HTMLElement | null {
  if (!mdl) return null;
  const all = mdl.split('\n');
  const text = lines ? all.slice(lines[0], lines[1] + 1).join('\n') : mdl;
  return text.trim() ? h('div', {}, h('h4', {}, 'MDL'), h('pre.mx-mdl', {}, text)) : null;
}

function flowDetails(doc: FlowDoc, id: string): HTMLElement[] {
  const node = doc.nodes.find((x) => x.id === id);
  if (node) {
    const out: HTMLElement[] = [h('h3', {}, node.caption || KIND_LABEL[node.kind]), h('div.mx-kind', {}, `${KIND_LABEL[node.kind]}${node.action ? ` · ${node.action.replace(/-/g, ' ')}` : ''}`)];
    out.push(
      kv([
        ['Condition', node.kind === 'split' ? node.expr : undefined],
        ['Returns', node.kind === 'end' ? node.expr : undefined],
        ['Variable', node.output?.name],
        ['Type', node.output?.type],
        ['Commit', node.commit ? 'Yes' : undefined],
        ['Refresh in client', node.refresh ? 'Yes' : undefined],
        ['Colour', node.color],
        ['Disabled', node.disabled ? 'Yes' : undefined],
      ]),
    );
    if (node.details?.length) out.push(h('h4', {}, 'Details'), h('ul', {}, ...node.details.map((d) => h('li', {}, d))));
    if (node.kind === 'annotation') out.push(h('p', {}, node.caption));
    const m = mdlBlock(doc.mdl, node.lines);
    if (m) out.push(m);
    return out;
  }
  const edge = doc.edges.find((x) => x.id === id);
  if (!edge) return [];
  const name = (nid: string) => {
    const nd = doc.nodes.find((x) => x.id === nid);
    return nd ? nd.caption || KIND_LABEL[nd.kind] : nid;
  };
  return [h('h3', {}, edge.annotation ? 'Annotation flow' : edge.error ? 'Error handler flow' : 'Sequence flow'), kv([['From', name(edge.from)], ['To', name(edge.to)], ['Outcome', edge.label]])];
}

function domainDetails(doc: DomainDoc, id: string): HTMLElement[] {
  const nameOf = (eid: string) => doc.entities.find((x) => x.id === eid)?.name ?? eid;
  const e = doc.entities.find((x) => x.id === id);
  if (e) {
    const assocs = doc.associations.filter((a) => a.parent === id || a.child === id);
    return [
      h('h3', {}, e.name),
      h('div.mx-kind', {}, `${ENTITY_LABEL[e.kind]} · ${doc.module}.${e.name}`),
      kv([
        ['Generalization', e.generalization],
        ['Service', e.service],
        ['Event handlers', e.events ? 'Yes' : undefined],
        ['Image', e.image ? 'Yes' : undefined],
      ]),
      e.doc ? h('p', {}, e.doc) : null,
      h('h4', {}, `Attributes (${e.attrs.length})`),
      e.attrs.length
        ? h('ul', {}, ...e.attrs.map((a) => h('li', {}, `${a.name}: ${a.type}${a.def ? ` = ${a.def}` : ''}${a.calculated ? ' · calculated' : ''}${a.validation ? ' · validated' : ''}`)))
        : h('p', {}, 'None.'),
      assocs.length ? h('h4', {}, 'Associations') : null,
      assocs.length ? h('ul', {}, ...assocs.map((a) => h('li', {}, `${a.name} (${nameOf(a.parent)} → ${a.cross ? a.child : nameOf(a.child)})`))) : null,
    ].filter((x): x is HTMLElement => !!x);
  }
  const a = doc.associations.find((x) => x.id === id);
  if (a) {
    const mult = a.type === 'ReferenceSet' ? 'many-to-many' : a.owner === 'Both' ? 'one-to-one' : 'one-to-many';
    return [
      h('h3', {}, a.name),
      h('div.mx-kind', {}, `Association · ${mult}`),
      kv([
        ['From (owner)', nameOf(a.parent)],
        ['To', a.cross ? a.child : nameOf(a.child)],
        ['Type', a.type === 'ReferenceSet' ? 'Reference set' : 'Reference'],
        ['Owner', a.owner],
        ['On delete', a.deleteBehavior],
      ]),
      a.doc ? h('p', {}, a.doc) : null,
    ].filter((x): x is HTMLElement => !!x);
  }
  const note = doc.annotations.find((x) => x.id === id);
  return note ? [h('h3', {}, 'Annotation'), h('p', { style: 'white-space:pre-wrap' }, note.text)] : [];
}

/** The panel's content for `id` in `doc` (or the document's summary when nothing is picked). */
export function details(doc: ModelDoc, id: string | null, diff?: DocDiff): HTMLElement[] {
  if (id && doc.kind === 'domainmodel') return domainDetails(doc, id);
  if (id && (doc.kind === 'microflow' || doc.kind === 'nanoflow')) return flowDetails(doc, id);
  const out: HTMLElement[] = [];
  if (doc.kind === 'domainmodel') {
    out.push(h('h3', {}, `${doc.module} › Domain model`), h('div.mx-kind', {}, `${doc.entities.length} entities · ${doc.associations.length} associations`));
    out.push(h('div.mx-legend', {}, ...(['persistent', 'nonpersistent', 'view', 'external'] as const).map((k) => h('span', {}, `■ ${ENTITY_LABEL[k]}`))));
  } else if (doc.kind === 'microflow' || doc.kind === 'nanoflow') {
    const params = doc.nodes.filter((x) => x.kind === 'parameter');
    out.push(h('h3', {}, doc.name), h('div.mx-kind', {}, `${doc.kind === 'nanoflow' ? 'Nanoflow (runs in the browser or on the device)' : 'Microflow (runs on the server)'}${doc.returnType ? ` · returns ${doc.returnType}` : ''}`));
    if (params.length) out.push(h('h4', {}, 'Parameters'), h('ul', {}, ...params.map((p) => h('li', {}, `${p.output?.name}${p.output?.type ? `: ${p.output.type}` : ''}`))));
    out.push(h('p', { class: 'mx-kind' }, doc.source === 'units' ? 'Drawn from the app\'s model, at the developer\'s positions and sizes.' : 'Drawn from mxcli\'s MDL at the developer\'s positions (default sizes).'));
    const m = mdlBlock(doc.mdl);
    if (m) out.push(m);
  } else if (doc.kind === 'text') {
    out.push(h('h3', {}, doc.name), h('div.mx-kind', {}, doc.type));
  }
  if (diff) {
    out.push(h('h4', {}, 'Changed on this branch'), h('p', {}, `${diff.added.length} added · ${diff.changed.length} changed · ${diff.removed.length} removed`));
    if (diff.removed.length) out.push(h('ul', {}, ...diff.removed.map((r) => h('li', {}, `Removed: ${r}`))));
  }
  return out;
}

const STATUS_ORDER = { added: 0, changed: 1, removed: 2 };

/** The branch's changed documents, each a button to show it. */
export function changeList(changes: DocChange[], open: (c: DocChange) => void): HTMLElement {
  if (!changes.length) return h('div', {}, h('h4', {}, 'Changes in this branch'), h('p', {}, 'No model changes against main.'));
  const sorted = [...changes].sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || a.qn.localeCompare(b.qn));
  return h(
    'div.mx-changes',
    {},
    h('h4', {}, `Changes in this branch (${changes.length})`),
    h(
      'ul',
      {},
      ...sorted.map((c) =>
        h(
          'li',
          {},
          h('button', { type: 'button', disabled: c.status === 'removed', onclick: () => open(c), title: c.type }, h(`span.mx-pill.mx-${c.status}`, {}, c.status), icon(c.type), `${c.qn}${c.type === 'domainmodel' ? ' › Domain model' : ''}`),
        ),
      ),
    ),
  );
}
