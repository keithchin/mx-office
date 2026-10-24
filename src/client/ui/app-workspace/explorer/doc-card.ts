// A document opened from the explorer, in the pane: what it is (its role, and its status only where a real
// source says so, named), the revision it comes from, and for each of its files the last commit that
// touched it there (date, author, commit, from git: never the file's time on disk). Then how it relates to
// the others (shared/app-documents.ts): its versions (ordered by what their names say), its other formats
// and representations side by side, each labelled, its supporting files, related documents and dated review
// rounds. Nothing is called newer, older or replaced because of a date. A file shows below when picked: a
// picture, text, or a page drawn without its scripts.

import { h } from '../../dom';
import { dayOf } from '../../../../shared/app-documents-rules';
import { shortSha, type ExplorerFile } from '../../../../shared/app-explorer';
import { RELATION_TITLE, type DocEntry, type DocFile, type DocLink, type DocumentsView } from '../../../../shared/app-documents';

export interface DocCardDeps {
  file(path: string): Promise<ExplorerFile>;
  /** Opens another entry (a link was followed). */
  open(entryId: string): void;
}

const when = (at: number | undefined) => (at ? dayOf(at) : '');
const FORMAT: Record<string, string> = { md: 'Markdown', html: 'HTML', htm: 'HTML', pdf: 'PDF', docx: 'Word', txt: 'Text', json: 'JSON', css: 'CSS', tsv: 'Table', png: 'Picture', jpg: 'Picture', jpeg: 'Picture', svg: 'Picture', webp: 'Picture' };
const formatOf = (p: string) => FORMAT[(/\.([a-z0-9]+)$/i.exec(p)?.[1] ?? '').toLowerCase()] ?? 'File';

function provenance(f: DocFile): HTMLElement {
  return f.last
    ? h('span.ax-prov', { title: f.last.subject }, `Last changed ${when(f.last.at)} by ${f.last.author} · commit ${shortSha(f.last.sha)}`)
    : h('span.ax-prov', {}, 'No commit found for it at this revision');
}

function badge(f: DocFile | undefined): HTMLElement | '' {
  const s = f?.status;
  return s ? h(`span.ax-badge.ax-st-${s.value}`, { title: `From ${s.source}: ${s.text}` }, `${s.value === 'stated' ? s.text : s.value} · from ${s.source}`) : '';
}

/** The card for `e`, at `view.rev`. */
export function docCard(e: DocEntry, view: DocumentsView, deps: DocCardDeps): HTMLElement {
  const shown = h('div.ax-docshow');
  let seq = 0;
  const show = async (path: string) => {
    const mine = ++seq;
    shown.replaceChildren(h('p.aw-muted', {}, 'Reading…'));
    try {
      const f = await deps.file(path);
      if (mine !== seq) return;
      if (f.kind === 'image') return void shown.replaceChildren(h('img.ax-img', { src: f.data ?? '', alt: path }));
      if (f.kind === 'text' && /\.html?$/i.test(path)) {
        // Drawn without its scripts, in its own sandbox (no access to the office).
        const frame = h('iframe.ax-docframe', { sandbox: '', title: `${path} (scripts off)`, referrerpolicy: 'no-referrer' }) as HTMLIFrameElement;
        frame.srcdoc = f.text ?? '';
        return void shown.replaceChildren(h('p.aw-muted.ax-small', {}, `${path} · drawn here without its scripts`), frame);
      }
      if (f.kind === 'text') return void shown.replaceChildren(h('pre.ax-text', {}, f.text ?? ''));
      shown.replaceChildren(h('p.aw-muted', {}, f.kind === 'large' ? `Too big to show here (${Math.round(f.size / 1024)} KB).` : 'Not text or a picture, so it can’t be shown here.'));
    } catch {
      if (mine === seq) shown.replaceChildren(h('p.aw-muted', {}, 'This couldn’t be read just now.'));
    }
  };
  const fileRow = (f: DocFile, label?: string) =>
    h('li.ax-docfile', {}, h('div.ax-docfile-main', {}, h('b', {}, label ?? (f.marker ? `${formatOf(f.path)} · ${f.marker}` : formatOf(f.path))), badge(f), h('code.ax-path', {}, f.path), provenance(f), f.renamedFrom ? h('span.ax-prov', {}, `Renamed from ${f.renamedFrom}`) : ''), h('button.aw-btn.ax-docopen', { type: 'button', onclick: () => void show(f.path) }, 'Show'));
  const linkRow = (l: DocLink) => {
    const target = view.entries.find((x) => x.id === l.to);
    return h('li.ax-doclink', {}, h('button.ax-linkbtn', { type: 'button', onclick: () => deps.open(l.to) }, l.label), target && !l.label.includes(target.title) ? h('span.aw-muted', {}, ` · ${target.title}`) : '');
  };
  const section = (title: string, ...kids: (HTMLElement | '')[]) => h('section.ax-docsec', {}, h('h3', {}, title), ...kids);
  const parts: (HTMLElement | '')[] = [];

  if (e.shape === 'single' || e.formats?.length) {
    const firsts = [e.files[0], ...(e.formats ?? [])].filter(Boolean);
    // The document itself, and its other formats side by side.
    parts.push(section(firsts.length > 1 ? 'The document, in each format' : 'The document', h('ul.ax-docgrid', {}, ...firsts.map((f) => fileRow(f)))));
  }
  if (e.shape === 'versions') parts.push(section(`${RELATION_TITLE.version} (${e.files.length})`, h('p.aw-muted.ax-small', {}, 'The same document under one name with a version, date or round added. Listed by what the names say; none is marked out of date.'), h('ul.ax-doclist', {}, ...e.files.map((f) => fileRow(f, f.marker ? `Version ${f.marker}` : 'Without a version in its name')))));
  if (e.runs) {
    parts.push(
      section(
        `Review rounds (${e.runs.length})`,
        h('p.aw-muted.ax-small', {}, 'Each dated folder is one round. All rounds are kept; the newest name is first.'),
        h('ul.ax-doclist', {}, ...e.runs.map((r) => h('li.ax-docfile', {}, h('div.ax-docfile-main', {}, h('b', {}, r.label), h('code.ax-path', {}, `${r.path}/`), r.last ? h('span.ax-prov', {}, `Last changed ${when(r.last.at)} by ${r.last.author} · commit ${shortSha(r.last.sha)}`) : ''), r.files[0] ? h('button.aw-btn.ax-docopen', { type: 'button', onclick: () => void show(r.files[0].path) }, 'Show first') : ''))),
      ),
    );
  }
  const alts = e.links.filter((l) => l.relation === 'alternative');
  if (alts.length) parts.push(section(RELATION_TITLE.alternative, h('p.aw-muted.ax-small', {}, 'The same screen or document shown another way. Shown side by side; none replaces another.'), h('ul.ax-docgrid', {}, ...alts.map(linkRow))));
  for (const rel of ['supporting', 'related'] as const) {
    const ls = e.links.filter((l) => l.relation === rel);
    if (ls.length) parts.push(section(RELATION_TITLE[rel], h('ul.ax-doclist', {}, ...ls.map(linkRow))));
  }
  if (e.relations.includes('supporting') && !e.links.some((l) => l.relation === 'supporting')) parts.push(section(RELATION_TITLE.supporting, h('p.aw-muted', {}, `${e.role ?? 'A supporting file'}: the documents rely on it, so it stays here to open.`)));
  if (e.relations.length === 1 && e.relations[0] === 'unknown') parts.push(section(RELATION_TITLE.unknown, h('p.aw-muted', {}, 'Nothing links it to another document, so it stands on its own.')));
  const head = h(
    'div.ax-dochead',
    {},
    e.role ? h('span.ax-badge.ax-role', {}, e.role) : '',
    badge(e.files[0]),
    h('span.ax-rev', { title: view.rev }, `From the repository at ${shortSha(view.rev)}`),
  );
  return h('div.ax-doccard', {}, head, ...parts, shown, h('p.aw-muted.ax-small.ax-docfoot', {}, `Dates are the last commit that touched each file at ${shortSha(view.rev)}, from git. Status shows only where a source says so. Nothing is marked newer or older because of its date.`));
}
