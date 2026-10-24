// The explorer's Documents, Process map and Design groups, from the documents at the revision shown
// (GET /api/app-explorer/documents, classified by shared/app-documents.ts): Documents by team section, the
// catalog items with several entries (wireframes, journeys) as folders, one row per entry. A row names the
// entry; versions, formats, dated runs and how it relates to others open in the pane (./doc-card.ts), so
// no entry hides another and every one is findable by the search (its paths are in its details line).

import { dayOf } from '../../../../shared/app-documents-rules';
import { GROUPS, shortSha, type ExplorerNode } from '../../../../shared/app-explorer';
import type { DocEntry, DocumentsView } from '../../../../shared/app-documents';
import type { TreeModel } from './tree';

export const DOC_PREFIX = 'doc:';
const SECTIONS = ['Project', 'Requirements', 'Design', 'Build', 'Testing', 'Other'];

const when = (at: number | undefined) => (at ? dayOf(at) : '');

/** The row of an entry. */
export function entryNode(e: DocEntry, rev: string): ExplorerNode {
  const first = e.files[0] ?? e.runs?.[0]?.files[0];
  const last = e.files[0]?.last ?? e.runs?.[0]?.last;
  const paths = [...e.files, ...(e.formats ?? [])].map((f) => f.path).concat((e.runs ?? []).map((r) => r.path));
  const more = e.shape === 'versions' ? ` · ${e.files.length} versions` : e.shape === 'runs' ? ` · ${e.runs!.length} rounds` : e.formats?.length ? ` · ${e.formats.length + 1} formats` : '';
  return {
    id: `${DOC_PREFIX}${e.id}`,
    label: e.title,
    kind: 'doc',
    ...(first ? { path: first.path, key: first.path } : {}),
    hint: `${e.role ? `${e.role} · ` : ''}${paths[0] ?? ''}${more}${last ? ` · last changed ${when(last.at)} by ${last.author} (${shortSha(last.sha)})` : ''} · at ${shortSha(rev)}`,
    detail: paths.join(' '),
  };
}

/** The documents groups (Process map and Design only when there are some), their folders' rows put in `m`. */
export function docGroups(view: DocumentsView | undefined, m: TreeModel, loading: boolean): ExplorerNode[] {
  const by = new Map<string, DocEntry[]>([['documents', []], ['processmap', []], ['design', []]]);
  for (const e of view?.entries ?? []) by.get(e.group)?.push(e);
  const out: ExplorerNode[] = [];
  const rev = view?.rev ?? '';
  for (const def of GROUPS.filter((x) => by.has(x.id))) {
    const list = by.get(def.id)!;
    if (!list.length && def.id !== 'documents') continue;
    const id = `docs:${def.id}`;
    const note = view?.problem ?? 'No documents yet. The team’s documents show here once they’re committed.';
    const rows = (entries: DocEntry[], at: string): ExplorerNode[] => {
      const sets = new Map<string, DocEntry[]>();
      const loose: DocEntry[] = [];
      for (const e of entries) (e.set ? sets.set(e.set, [...(sets.get(e.set) ?? []), e]) : loose.push(e));
      const folders = [...sets.entries()].map(([name, es]): ExplorerNode => {
        const fid = `${at}/${name}`;
        m.kids.set(fid, { nodes: es.map((e) => entryNode(e, rev)).sort((a, b) => a.label.localeCompare(b.label)) });
        return { id: fid, label: name.replace(/\s*\([^)]*\)$/, ''), kind: 'folder', folder: true, count: es.length, hint: name };
      });
      return [...folders.sort((a, b) => a.label.localeCompare(b.label)), ...loose.map((e) => entryNode(e, rev)).sort((a, b) => a.label.localeCompare(b.label))];
    };
    let nodes: ExplorerNode[];
    if (def.id === 'documents') {
      const sections = new Map<string, DocEntry[]>();
      for (const e of list) sections.set(e.section, [...(sections.get(e.section) ?? []), e]);
      nodes = [...sections.entries()]
        .sort((a, b) => (SECTIONS.indexOf(a[0]) + 99) % 99 - (SECTIONS.indexOf(b[0]) + 99) % 99 || a[0].localeCompare(b[0]))
        .map(([name, es]): ExplorerNode => {
          const sid = `${id}/${name}`;
          m.kids.set(sid, { nodes: rows(es, sid) });
          return { id: sid, label: name, kind: 'folder', folder: true, count: es.length, hint: `${name}: ${es.length} document${es.length === 1 ? '' : 's'}` };
        });
    } else nodes = rows(list, id);
    m.kids.set(id, { nodes, ...(view || !loading ? {} : { loading: true }), note });
    out.push({ id, label: def.label, kind: 'group', hint: `${def.hint}${rev ? ` (${shortSha(rev)})` : ''}: ${list.length} document${list.length === 1 ? '' : 's'}`, folder: true, count: list.length });
  }
  return out;
}
