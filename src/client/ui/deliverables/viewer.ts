// A deliverable in a window (GET /api/deliverables/file, server/deliverables/): an HTML report in a
// sandboxed iframe with no origin (the office inlined what it links to), Markdown rendered like the
// bookshelf's (Mermaid blocks drawn, mermaid.ts), a picture as a picture, a PDF in the browser's viewer, a CSV's first rows as a table,
// JSON pretty-printed (a BRD with a link to the BRD report), and an xlsx as a download.

import { isDeliverablePath, kindOf, type DeliverableFile, type DeliverablesView, type DeliverableWhere } from '../../../shared/deliverables';
import { resolveDocLink } from '../../../shared/docs';
import { h, openModal } from '../dom';
import { markdownFile } from '../markdown';
import { renderMermaid } from './mermaid';

const q = (floor: string, src: string, path: string, more: Record<string, string> = {}) => new URLSearchParams({ floor, src, path, ...more }).toString();
export const fileUrl = (floor: string, src: string, path: string, download = false) => `/api/deliverables/file?${q(floor, src, path, download ? { download: '1' } : {})}`;

const KIND_LABEL: Record<string, string> = { html: 'HTML', md: 'Markdown', pdf: 'PDF', image: 'Picture', xlsx: 'Workbook', csv: 'CSV', json: 'JSON', text: 'Text' };
const sizeText = (n?: number) => (n === undefined ? '' : n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${Math.round(n / 1024)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);

async function text(url: string): Promise<string> {
  const r = await fetch(url, { credentials: 'same-origin' });
  if (!r.ok) throw new Error((await r.json().catch(() => null))?.error ?? `HTTP ${r.status}`);
  return r.text();
}

/** Where a file is, in words: "on main", "on office/pixel-31e0 · Pixel (Chief Analyst)". */
export function whereText(w: DeliverableWhere): string {
  if (w.src === 'main') return `on ${w.label || 'main'}`;
  if (w.src.startsWith('wt:')) return `in ${w.label}${w.branch ? ` (${w.branch})` : ''}`;
  return `on ${w.label}${w.who ? ` · ${w.who}` : ''}`;
}

/** Markdown with its pictures and links pointed at the same place it came from. */
function markdownBody(floor: string, src: string, path: string, md: string, open: (p: string) => void): HTMLElement {
  const body = markdownFile(md);
  for (const img of body.querySelectorAll<HTMLImageElement>('img[src]')) {
    const to = resolveDocLink(path, img.getAttribute('src') ?? '');
    if (to && isDeliverablePath(to.path)) img.src = fileUrl(floor, src, to.path);
  }
  for (const a of body.querySelectorAll<HTMLAnchorElement>('a[href]')) {
    const to = resolveDocLink(path, a.getAttribute('href') ?? '');
    if (!to || !isDeliverablePath(to.path) || to.path === path) continue;
    a.removeAttribute('target');
    a.href = '#';
    a.addEventListener('click', (e) => {
      e.preventDefault();
      open(to.path);
    });
  }
  // Mermaid blocks drawn as diagrams in the office theme's light or dark, the source kept under each.
  void renderMermaid(body);
  return body;
}

async function csvTable(floor: string, src: string, path: string): Promise<HTMLElement> {
  const r = await fetch(`/api/deliverables/table?${q(floor, src, path)}`, { credentials: 'same-origin' });
  if (!r.ok) throw new Error((await r.json().catch(() => null))?.error ?? `HTTP ${r.status}`);
  const { rows, more } = (await r.json()) as { rows: string[][]; more: boolean };
  const [head, ...rest] = rows;
  return h(
    'div.dv-table-wrap',
    {},
    h('table.dv-table', {}, head ? h('thead', {}, h('tr', {}, ...head.map((c) => h('th', {}, c)))) : null, h('tbody', {}, ...rest.map((row) => h('tr', {}, ...row.map((c) => h('td', {}, c)))))),
    more ? h('p.dv-dim', {}, `The first ${rows.length} rows: download it for the rest.`) : null,
  );
}

/** Opens `file` (found at `where`, else its best place) in a window. `view` finds the BRD report for a BRD. */
export function openDeliverable(floor: string, file: Pick<DeliverableFile, 'path' | 'where'> & Partial<DeliverableFile>, view?: DeliverablesView, where = file.where[0]) {
  const path = file.path;
  const kind = kindOf(path);
  const src = where?.src ?? 'main';
  const body = h('div.dv-view-body', {}, h('p.dv-dim', {}, 'Loading…'));
  const others = file.where.length > 1 ? h('select.dv-where-pick', { 'aria-label': 'Which copy' }, ...file.where.map((w, i) => h('option', { value: String(i), selected: w === where }, whereText(w)))) : null;
  const win = h(
    'div.modal.dv-view',
    { role: 'dialog', 'aria-label': path },
    h(
      'header.dv-view-head',
      {},
      h('h2', {}, path),
      h(
        'p.dv-view-meta',
        {},
        h('span.dv-kind', {}, KIND_LABEL[kind] ?? kind),
        others ?? h('span', {}, where ? whereText(where) : ''),
        file.size !== undefined ? h('span', {}, sizeText(file.size)) : null,
        h('a.btn.small', { href: fileUrl(floor, src, path, true), download: path.slice(path.lastIndexOf('/') + 1) }, 'Download'),
        kind === 'html' || kind === 'pdf' || kind === 'image' ? h('a.btn.small', { href: fileUrl(floor, src, path), target: '_blank', rel: 'noopener noreferrer' }, 'Open in a new tab') : null,
      ),
    ),
    body,
  );
  const modal = openModal(win, { doing: `reading ${path.slice(path.lastIndexOf('/') + 1)}`, reading: true });
  others?.addEventListener('change', () => {
    modal.close();
    openDeliverable(floor, file, view, file.where[Number(others.value)]);
  });
  const openPath = (p: string) => {
    const known = view?.items.flatMap((i) => i.files).find((f) => f.path === p);
    modal.close();
    openDeliverable(floor, known ?? { path: p, where: [where ?? { src: 'main', label: 'main' }] }, view);
  };
  const fill = async () => {
    const url = fileUrl(floor, src, path);
    if (kind === 'html') return h('iframe.dv-frame', { src: url, sandbox: 'allow-scripts', referrerpolicy: 'no-referrer', title: path });
    if (kind === 'pdf') return h('iframe.dv-frame', { src: url, title: path });
    if (kind === 'image') return h('div.dv-pic', {}, h('img', { src: url, alt: path }));
    if (kind === 'csv') return csvTable(floor, src, path);
    if (kind === 'xlsx') return h('div.dv-xlsx', {}, h('p', {}, 'Excel workbooks are not previewed here.'), h('a.btn', { href: fileUrl(floor, src, path, true), download: path.slice(path.lastIndexOf('/') + 1) }, 'Download the workbook'));
    const t = await text(url);
    if (kind === 'md') return markdownBody(floor, src, path, t, openPath);
    if (kind === 'json') {
      let pretty = t;
      try {
        pretty = JSON.stringify(JSON.parse(t), null, 2);
      } catch {
        // shown as it is
      }
      const report = /\.brd\.json$/i.test(path) ? view?.items.find((i) => i.id === 'brd-report')?.files[0] : undefined;
      return h('div', {}, report ? h('p.dv-brd', {}, 'This BRD is rendered in ', h('button.tm-link', { type: 'button', onclick: () => openPath(report.path) }, report.path), '.') : null, h('pre.dv-pre', {}, pretty));
    }
    return h('pre.dv-pre', {}, t);
  };
  fill().then(
    (el) => body.replaceChildren(el),
    (err) => body.replaceChildren(h('p.dv-dim', {}, `Couldn't open it: ${(err as Error).message}`)),
  );
  return modal;
}
