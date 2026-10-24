// The explorer's "changed" dots (./index.ts): after it reads a newer revision, every open row that changed
// between the two (a page, a flow, a module's data, a file, a document naming the file) and every open row
// above one, in the business tree and in all files.

import { MARKETPLACE, type ExplorerChanges } from '../../../../shared/app-explorer';
import type { TreeModel } from './tree';

const isDocs = (id: string) => id.startsWith('docs:');

export function markDots(biz: TreeModel, files: TreeModel, ch: ExplorerChanges): void {
  const GROUP: Record<string, string> = { page: 'pages', microflow: 'logic', nanoflow: 'logic', domainmodel: 'data' };
  const parents = (id: string) => {
    // Every open row above a changed one: its group, the Marketplace fold, its module and folders.
    for (const [at, lv] of biz.kids) if (lv.nodes.some((x) => x.id === id) && at !== '') biz.dots.add(at);
  };
  for (const key of ch.docs) {
    const kind = key.slice(0, key.indexOf(':'));
    const qn = key.slice(kind.length + 1);
    const group = GROUP[kind];
    if (!group) continue;
    const module = kind === 'domainmodel' ? qn : qn.slice(0, qn.indexOf('.'));
    biz.dots.add(group).add(`${group}/${encodeURIComponent(module)}`);
    if (biz.kids.get(`${group}/${MARKETPLACE}`)?.nodes.some((x) => x.id === `${group}/${encodeURIComponent(module)}`)) biz.dots.add(`${group}/${MARKETPLACE}`);
    if (kind !== 'domainmodel') {
      biz.dots.add(key);
      for (let i = 0; i < 4; i++) for (const id of [...biz.dots]) parents(id);
    } else for (const n of biz.kids.get(`data/${encodeURIComponent(module)}`)?.nodes ?? []) biz.dots.add(n.id);
  }
  for (const p of ch.files) {
    files.dots.add(`f:${p}`);
    const parts = p.split('/');
    for (let i = 1; i < parts.length; i++) files.dots.add(`f:${parts.slice(0, i).join('/')}/`);
    for (const [at, lv] of biz.kids) if (isDocs(at)) for (const n of lv.nodes) if (n.kind === 'doc' && (n.detail ?? '').split(' ').includes(p)) biz.dots.add(n.id).add(at).add(at.split('/')[0]);
  }
}
