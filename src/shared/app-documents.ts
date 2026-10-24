// The Developer view's documents and how they relate (the explorer's Documents, Process map and Design
// groups), worked out from the files at one repository revision. Every file ends up in one entry, and each
// entry says which of these it takes part in:
//
//   version      the same artifact more than once, in the same folder and of the same kind: the same path once
//                a version, date or round suffix is taken off (brand-v1.md, brand-v2.md), files named only by
//                their date (standups/2026-10-23.md: a dated series), or a file git says was renamed from
//                another still there. Ordered by what the names say, never by commit date
//   alternative  the same thing shown another way: the same document in two formats (blueprint.md and
//                blueprint.html: one entry with both formats), and a storyboard frame, a wireframe and a
//                prototype route of the same screen (by name and PAGE-MAP.tsv), the storyboard and the
//                prototype of the whole app. Shown side by side, each labelled; none hides another
//   supporting   what a document uses: design tokens and stylesheets, images and pages it links (found in its
//                own text), the page map. Supporting files stay entries of their own too
//   related      documents that belong together: BRD source data and the BRD report built from it, the
//                knowledge base and its extraction report, a dated review report and its captures, documents
//                that link each other
//   run          earlier review runs: screenshot rounds in dated folders (ui-reviews/shots/2026-10-18-r2/).
//                All rounds are listed, newest name first; none is called out of date
//   unknown      none of the above: the entry stays on its own, findable, never folded into another
//
// What is never inferred: that one document supersedes another because it's newer, or because it's another
// format (a prototype doesn't replace the wireframes; an HTML report doesn't hide its source data). Dates
// are the last commit that touched the file at the revision (author and commit too), never a file's time on
// disk. Status (draft, approved, current) is shown only where a real source says so: the document's front
// matter or Status line, a status meta tag, the toolkit's DRAFT banner or draft name, PAGE-MAP.tsv (the
// wireframe mapped to a page), or an acceptance record that cites the file. It's a badge with its source:
// it never decides grouping or order, and a newer date never means approved. Pure.

import { extraTeam, kindOf, specFor, type DeliverableKind } from './deliverables.js';
import type { TeamId } from './roster/roles.js';
import { artifactKey, ASSET, compareOrder, dayLabel, DOC_FORMATS, markerOrder, pageMapRows, referencesOf, roleOf, runOf, screenOf, splitName, statusOf, wordsOf, type StatusFound } from './app-documents-rules.js';

export type DocRelation = 'version' | 'alternative' | 'supporting' | 'related' | 'run' | 'unknown';

export const RELATION_TITLE: Record<DocRelation, string> = {
  version: 'Versions of the same document',
  alternative: 'Other representations',
  supporting: 'Supporting files',
  related: 'Related documents',
  run: 'Dated runs',
  unknown: 'No known relationship',
};

export interface DocCommit {
  sha: string;
  /** ms */
  at: number;
  author: string;
  subject: string;
}

export type DocStatus = StatusFound;

export interface DocFile {
  path: string;
  kind: DeliverableKind;
  size: number;
  /** The last commit that touched it at the revision shown. */
  last?: DocCommit;
  /** The version, date or round its name carries (v2, 2026-10-18). */
  marker?: string;
  /** The path git says it was renamed from. */
  renamedFrom?: string;
  status?: DocStatus;
}

export interface DocLink {
  relation: Exclude<DocRelation, 'unknown'>;
  /** The other entry's id. */
  to: string;
  /** In words: "Wireframe of Sheet overview", "Uses ds.css", "BRD source data". */
  label: string;
  /** A prototype route (#/my-sheets) the link points into. */
  route?: string;
}

export interface DocRun {
  id: string;
  label: string;
  /** The run's folder (or file, for a file named by its date). */
  path: string;
  date: string;
  tag?: string;
  files: DocFile[];
  last?: DocCommit;
}

export type DocGroup = 'documents' | 'processmap' | 'design';

export interface DocEntry {
  id: string;
  title: string;
  group: DocGroup;
  /** The team's section in Documents ("Requirements", "Build"). */
  section: string;
  /** The catalog item several entries share ("Wireframes (one per screen)"), shown as a folder. */
  set?: string;
  shape: 'single' | 'versions' | 'runs';
  /** single: its file; versions: every version, the highest marker first (ordered by name, never by date). */
  files: DocFile[];
  /** The same document in other formats (blueprint.md next to blueprint.html), side by side with `files`. */
  formats?: DocFile[];
  runs?: DocRun[];
  /** What it is when it's a representation or a known part: Storyboard, Wireframe, Prototype, Design tokens, BRD source data… */
  role?: string;
  /** The classes it takes part in; ['unknown'] when none. */
  relations: DocRelation[];
  links: DocLink[];
}

export interface DocumentsView {
  rev: string;
  entries: DocEntry[];
  /** How many files of each class, for the docs and the smoke test. */
  counts: Record<DocRelation, number> & { files: number; entries: number };
  problem?: string;
}

/** A file as the server hands it in: its path, size, last commit, rename, and (Markdown, HTML, CSS, TSV) its text. */
export interface DocInput {
  path: string;
  size: number;
  last?: DocCommit;
  renamedFrom?: string;
  text?: string;
}

/** A file an acceptance record cites (`git:<sha>:<path>`): the badge says accepted, with the delivery and commit. */
export interface DocAccepted {
  version: string;
  commit: string;
  at: number;
}

const SECTION: Record<TeamId, string> = { management: 'Project', analysis: 'Requirements', design: 'Design', development: 'Build', testing: 'Testing' } as Record<TeamId, string>;

const docFile = (f: DocInput, marker?: string, status?: DocStatus): DocFile => ({
  path: f.path,
  kind: kindOf(f.path),
  size: f.size,
  ...(f.last ? { last: f.last } : {}),
  ...(marker ? { marker } : {}),
  ...(f.renamedFrom ? { renamedFrom: f.renamedFrom } : {}),
  ...(status ? { status } : {}),
});

/** The entries of a revision's documents, with how they relate. */
export function classifyDocuments(rev: string, input: readonly DocInput[], accepted: ReadonlyMap<string, DocAccepted> = new Map()): DocumentsView {
  const entries = new Map<string, DocEntry>();
  const entryOf = new Map<string, string>();
  const link = (from: string, l: DocLink) => {
    const e = entries.get(from);
    if (!e || l.to === from || e.links.some((x) => x.to === l.to && x.relation === l.relation && x.route === l.route)) return;
    e.links.push(l);
  };
  const both = (a: string, b: string, relation: DocLink['relation'], ab: string, ba: string, route?: string) => {
    link(a, { relation, to: b, label: ab, ...(route ? { route } : {}) });
    link(b, { relation, to: a, label: ba, ...(route ? { route } : {}) });
  };
  const placeOf = (path: string) => {
    const spec = specFor(path);
    const team = spec?.team ?? extraTeam(path) ?? 'management';
    const group: DocGroup = spec?.id === 'process-map' ? 'processmap' : team === 'design' ? 'design' : 'documents';
    return { spec, group, section: SECTION[team] ?? 'Other' };
  };

  // PAGE-MAP.tsv: which wireframe and prototype route each page has (status "current" for those it names).
  const mapped = new Map<string, { page: string; route?: string; source: string }>();
  const pageRoutes: { page: string; wireframe?: string; route?: string; dir: string; source: string }[] = [];
  for (const f of input) {
    if (!/(^|\/)page-map\.tsv$/i.test(f.path) || !f.text) continue;
    const dir = splitName(f.path).dir;
    for (const r of pageMapRows(f.text)) {
      pageRoutes.push({ ...r, dir, source: f.path });
      if (r.wireframe) mapped.set(`${dir}/${r.wireframe}`.toLowerCase(), { page: r.page, ...(r.route ? { route: r.route } : {}), source: f.path });
    }
  }

  // 1. Earlier review runs: files in dated folders.
  const runs = new Map<string, Map<string, DocInput[]>>();
  const rest: DocInput[] = [];
  for (const f of input) {
    const r = runOf(f.path);
    if (!r) {
      rest.push(f);
      continue;
    }
    let base = runs.get(r.base);
    if (!base) runs.set(r.base, (base = new Map()));
    base.set(r.run, [...(base.get(r.run) ?? []), f]);
  }
  for (const [base, byRun] of runs) {
    const id = `r:${base}`;
    const anyFile = [...byRun.values()][0][0].path;
    const { group, section } = placeOf(anyFile);
    const list: DocRun[] = [...byRun.entries()].map(([path, files]) => {
      const r = runOf(files[0].path)!;
      const last = files.map((x) => x.last).filter((x): x is DocCommit => !!x).sort((a, b) => b.at - a.at)[0];
      const images = files.filter((x) => kindOf(x.path) === 'image').length;
      const what = ` · ${files.length} ${images === files.length ? (files.length === 1 ? 'shot' : 'shots') : files.length === 1 ? 'file' : 'files'}`;
      return { id: `${id}/${path}`, label: `${dayLabel(r.date)}${r.tag ? ` · ${r.tag}` : ''}${what}`, path, date: r.date, ...(r.tag ? { tag: r.tag } : {}), files: files.map((x) => docFile(x, r.tag ? `${r.date} ${r.tag}` : r.date, statusOf(x.path, x.text))), ...(last ? { last } : {}) };
    });
    // In the order their names give (date, then tag), never by when they were committed.
    list.sort((a, b) => b.date.localeCompare(a.date) || (b.tag ?? '').localeCompare(a.tag ?? ''));
    const segs = base.split('/');
    const images = [...byRun.values()].flat().every((x) => kindOf(x.path) === 'image' || /\.json$/i.test(x.path));
    const title = images ? `Screenshot rounds${segs.length > 1 ? ` (${wordsOf(segs[segs.length - 2])})` : ''}` : `Dated runs (${wordsOf(segs[segs.length - 1])})`;
    entries.set(id, { id, title, group, section, shape: 'runs', files: [], runs: list, relations: [], links: [] });
    for (const files of byRun.values()) for (const f of files) entryOf.set(f.path, id);
  }

  // 2. Versions: the same artifact key; a rename from a file that is still there joins the two.
  const keyOf = new Map<string, string>();
  for (const f of rest) keyOf.set(f.path, artifactKey(f.path).key);
  for (const f of rest) if (f.renamedFrom && keyOf.has(f.renamedFrom)) keyOf.set(f.path, keyOf.get(f.renamedFrom)!);
  const byKey = new Map<string, DocInput[]>();
  for (const f of rest) byKey.set(keyOf.get(f.path)!, [...(byKey.get(keyOf.get(f.path)!) ?? []), f]);
  const specEntries = new Map<string, number>();
  for (const files of byKey.values()) {
    const s = specFor(files[0].path);
    if (s) specEntries.set(s.id, (specEntries.get(s.id) ?? 0) + 1);
  }
  for (const [key, files] of byKey) {
    const id = `d:${key}`;
    const order = (f: DocInput) => markerOrder(artifactKey(f.path).markers);
    files.sort((a, b) => compareOrder(order(b), order(a)) || a.path.localeCompare(b.path));
    const head = files[0];
    const { spec, group, section } = placeOf(head.path);
    const many = spec ? (specEntries.get(spec.id) ?? 0) > 1 : false;
    const role = roleOf(head.path, spec?.id);
    const stem = artifactKey(head.path).stem;
    const dated = artifactKey(head.path).dateOnly;
    const plain = wordsOf(stem.replace(/\.[a-z]+$/i, '').replace(role === 'Storyboard frame' ? /^\d+[-_ ]+/ : /^$/, ''));
    const title = spec && !many ? spec.title.replace(/\s*\([^)]*[{*][^)]*\)/, '') : dated ? `${plain} (dated)` : plain;
    const status = (f: DocInput): DocStatus | undefined => {
      const acc = accepted.get(f.path);
      if (acc) return { value: 'approved', text: `accepted with delivery ${acc.version} at ${acc.commit.slice(0, 7)}${f.last && f.last.sha !== acc.commit && f.last.at > acc.at ? ' (changed since)' : ''}`, source: 'acceptance record' };
      const m = mapped.get(f.path.toLowerCase());
      return statusOf(f.path, f.text) ?? (m ? { value: 'current', text: `mapped to page ${m.page}`, source: 'PAGE-MAP.tsv' } : undefined);
    };
    entries.set(id, {
      id,
      title,
      group,
      section,
      ...(spec && many ? { set: spec.title } : {}),
      shape: files.length > 1 ? 'versions' : 'single',
      files: files.map((f) => docFile(f, artifactKey(f.path).markers.join(' ') || undefined, status(f))),
      ...(role ? { role } : {}),
      relations: [],
      links: [],
    });
    for (const f of files) entryOf.set(f.path, id);
  }

  // 3. Alternatives. Formats of one document: the same key but another document format, one entry with both.
  const twins = new Map<string, DocEntry[]>();
  for (const e of entries.values()) {
    if (e.shape === 'runs') continue;
    const { ext } = splitName(e.files[0].path);
    if (!DOC_FORMATS.has(ext)) continue;
    const k = e.id.slice(0, e.id.length - ext.length - 1);
    twins.set(k, [...(twins.get(k) ?? []), e]);
  }
  for (const list of twins.values()) {
    if (list.length < 2) continue;
    // The order is only how they're laid out (by format name), never which one counts.
    list.sort((x, y) => splitName(x.files[0].path).ext.localeCompare(splitName(y.files[0].path).ext));
    const [keep, ...others] = list;
    keep.formats = others.flatMap((o) => o.files);
    keep.relations.push('alternative');
    keep.role ??= others.find((o) => o.role)?.role;
    keep.set ??= others.find((o) => o.set)?.set;
    if (!keep.set) delete keep.set;
    if (!keep.role) delete keep.role;
    for (const o of others) {
      entries.delete(o.id);
      for (const f of o.files) entryOf.set(f.path, keep.id);
    }
  }
  // Screens: storyboard frames, wireframes and prototype routes of the same screen.
  const screens = new Map<string, { id: string; role: string; route?: string }[]>();
  const alias = new Map<string, string>();
  for (const r of pageRoutes) if (r.wireframe) alias.set(r.page.toLowerCase(), screenOf(r.wireframe));
  const screenKey = (s: string) => alias.get(s) ?? s;
  for (const e of entries.values()) {
    if (e.role !== 'Storyboard frame' && e.role !== 'Wireframe') continue;
    const k = screenKey(screenOf(e.files[0].path));
    screens.set(k, [...(screens.get(k) ?? []), { id: e.id, role: e.role }]);
  }
  const prototypes = [...entries.values()].filter((e) => e.role === 'Prototype');
  for (const r of pageRoutes) {
    if (!r.route || !r.wireframe) continue;
    const proto = prototypes.find((p) => splitName(p.files[0].path).dir === splitName(r.dir).dir || splitName(p.files[0].path).dir === r.dir) ?? prototypes[0];
    if (!proto) continue;
    const k = screenKey(screenOf(r.wireframe));
    screens.set(k, [...(screens.get(k) ?? []), { id: proto.id, role: 'Prototype', route: r.route }]);
  }
  for (const [k, list] of screens) {
    if (list.length < 2) continue;
    const name = wordsOf(k);
    for (const a of list) for (const b of list) if (a.id !== b.id) link(a.id, { relation: 'alternative', to: b.id, label: `${b.role} of ${name}${b.route ? ` (${b.route})` : ''}`, ...(b.route ? { route: b.route } : {}) });
  }
  // The whole app: the storyboard and the prototype.
  const wholes = [...entries.values()].filter((e) => e.role === 'Storyboard' || e.role === 'Prototype');
  for (const a of wholes) for (const b of wholes) if (a.id !== b.id && a.role !== b.role) link(a.id, { relation: 'alternative', to: b.id, label: `${b.role} of the whole app` });

  // 4. Supporting and related: what each document's own text refers to.
  for (const f of input) {
    if (!f.text || !/\.(md|markdown|html?|css)$/i.test(f.path)) continue;
    const from = entryOf.get(f.path);
    if (!from) continue;
    for (const target of referencesOf(f.path, f.text)) {
      const to = entryOf.get(target);
      if (!to || to === from) continue;
      const name = target.slice(target.lastIndexOf('/') + 1);
      if (ASSET.test(target) && !entries.get(to)!.runs) both(from, to, 'supporting', `Uses ${name}`, `Used by ${entries.get(from)!.title}`);
      else both(from, to, 'related', `Links to ${entries.get(to)!.title}`, `Linked from ${entries.get(from)!.title}`);
    }
  }
  // Families: BRD source data, report and validation; the knowledge base and its extraction report.
  const fam = (pred: (e: DocEntry) => boolean) => [...entries.values()].filter(pred);
  const brd = fam((e) => !!e.role?.startsWith('BRD'));
  for (const a of brd) for (const b of brd) if (a.id !== b.id && a.role !== b.role) link(a.id, { relation: 'related', to: b.id, label: b.role! });
  const kbOf = (e: DocEntry) => e.files[0]?.path.match(/^(.*\/knowledge-base)\//)?.[1];
  const kb = fam((e) => !!kbOf(e));
  for (const r of kb.filter((e) => /extraction-report\.html$/i.test(e.files[0].path))) for (const e of kb) if (e !== r && kbOf(e) === kbOf(r)) both(r.id, e.id, 'related', `Extracted: ${e.title}`, 'Extraction report');
  // A dated review report and the captures of the same date.
  for (const e of entries.values()) {
    if (e.shape === 'runs') continue;
    for (const f of e.files) {
      const date = /(\d{4}-\d{2}-\d{2})/.exec(splitName(f.path).stem)?.[1];
      if (!date || !/review/i.test(f.path)) continue;
      for (const r of fam((x) => x.shape === 'runs' && !!x.runs?.some((run) => run.date === date))) both(e.id, r.id, 'related', `Captures of ${dayLabel(date)}`, `Review report of ${dayLabel(date)}`);
    }
  }
  // Supporting by what it is (design tokens, a stylesheet, the page map), even when nothing names it.
  for (const e of entries.values()) if (e.role === 'Design tokens' || e.role === 'Page map') e.relations.push('supporting');

  // 5. The classes each entry takes part in.
  const counts = { version: 0, alternative: 0, supporting: 0, related: 0, run: 0, unknown: 0, files: input.length, entries: 0 } as DocumentsView['counts'];
  for (const e of entries.values()) {
    const set = new Set<DocRelation>(e.relations);
    if (e.shape === 'versions') set.add('version');
    if (e.shape === 'runs') set.add('run');
    for (const l of e.links) set.add(l.relation);
    e.relations = set.size ? [...set] : ['unknown'];
    const n = e.shape === 'runs' ? e.runs!.reduce((x, r) => x + r.files.length, 0) : e.files.length + (e.formats?.length ?? 0);
    for (const r of e.relations) counts[r] += n;
    e.links.sort((a, b) => a.relation.localeCompare(b.relation) || a.label.localeCompare(b.label));
  }
  counts.entries = entries.size;
  // Two entries with the same name in one place: each says which folder it's in.
  const named = new Map<string, DocEntry[]>();
  for (const e of entries.values()) {
    const k = `${e.group}|${e.section}|${e.set ?? ''}|${e.title}|${e.role ?? ''}`;
    named.set(k, [...(named.get(k) ?? []), e]);
  }
  for (const list of named.values()) if (list.length > 1) for (const e of list) if (e.files[0]) e.title = `${e.title} (${splitName(e.files[0].path).dir || 'top folder'})`;
  const sorted = [...entries.values()].sort((a, b) => a.group.localeCompare(b.group) || a.section.localeCompare(b.section) || (a.set ?? '').localeCompare(b.set ?? '') || a.title.localeCompare(b.title));
  return { rev, entries: sorted, counts };
}
