// What the file routes answer for one deliverable (http/routes/deliverables.ts), as status, headers and
// body, so the tests can check each kind without a server: an HTML report self-contained under a CSP
// with no network and no origin, pictures and text sandboxed, a PDF for the browser's viewer framed by
// the office only, an xlsx (or anything asked with download) as an attachment, a CSV as table rows.

import { kindOf } from '../../shared/deliverables.js';
import { CAPS, contentType, HTML_CSP, inlineHtml, mermaidJs, parseCsv, readDeliverable, type Source } from './content.js';

export interface Answer {
  status: number;
  headers: Record<string, string>;
  body: Buffer;
}

const json = (status: number, v: unknown): Answer => ({ status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' }, body: Buffer.from(JSON.stringify(v)) });

/** A download's file name, without anything a header can't carry. */
const fileName = (p: string) => (p.slice(p.lastIndexOf('/') + 1) || 'file').replace(/[^\w.\- ]+/g, '_');

const BASE = { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', 'cross-origin-resource-policy': 'same-origin' };
/** For everything but HTML and PDF: nothing runs, nothing loads, no origin. */
export const PLAIN_CSP = "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'self'; sandbox";

/** A CSV's first rows (GET /api/deliverables/table). */
export async function tableAnswer(source: Source, file: string): Promise<Answer> {
  if (kindOf(file) !== 'csv') return json(415, { error: 'Only CSV files have a table preview' });
  const r = await readDeliverable(source, file, CAPS.csv);
  if ('error' in r) return json(r.status, { error: r.error });
  return json(200, parseCsv(r.body.toString('utf8')));
}

/** One file to view, or with `download` to save (GET /api/deliverables/file). */
export async function fileAnswer(source: Source, file: string, download: boolean): Promise<Answer> {
  const kind = kindOf(file);
  const max = download || kind === 'pdf' || kind === 'image' || kind === 'xlsx' ? CAPS.file : kind === 'html' ? CAPS.html : CAPS.text;
  const r = await readDeliverable(source, file, max);
  if ('error' in r) return json(r.status, { error: r.error });
  const sized = (headers: Record<string, string>, body: Buffer): Answer => ({ status: 200, headers: { ...BASE, ...headers, 'content-length': String(body.length) }, body });
  if (download || kind === 'xlsx') return sized({ 'content-type': 'application/octet-stream', 'content-disposition': `attachment; filename="${fileName(file)}"`, 'content-security-policy': "default-src 'none'; sandbox" }, r.body);
  if (kind === 'html') return sized({ 'content-type': 'text/html; charset=utf-8', 'content-security-policy': HTML_CSP }, Buffer.from(await inlineHtml(source, file, r.body.toString('utf8')), 'utf8'));
  // Chrome won't show a PDF in a sandbox: it gets the browser's viewer, framed by the office only.
  if (kind === 'pdf') return sized({ 'content-type': 'application/pdf', 'content-security-policy': "frame-ancestors 'self'" }, r.body);
  return sized({ 'content-type': contentType(file), 'content-security-policy': PLAIN_CSP }, r.body);
}

/**
 * The page that draws the viewer's Mermaid diagrams (GET /api/deliverables/mermaid): the office's own
 * Mermaid inlined, in a frame the viewer keeps sandboxed with no origin, so the browser runs it in a
 * process of its own. Drawing a big diagram is seconds of work that held the office page still (a
 * 3 s task for travel-approval's domain model, 2026-10-11); there, the page stays responsive. It's
 * asked for a diagram by postMessage ({ id, source, theme }) and answers { id, svg } or { id, error }.
 */
export async function mermaidFrameAnswer(): Promise<Answer> {
  const js = await mermaidJs();
  if (!js) return json(503, { error: "The office's Mermaid isn't installed" });
  const page = `<!doctype html><meta charset="utf-8"><body><script>${js.replace(/<\/script/gi, '<\\/script')}</script><script>${MERMAID_FRAME}</script></body>`;
  const body = Buffer.from(page, 'utf8');
  // The same for a build: kept by the browser for an hour (it's 3 MB), never shared.
  return { status: 200, headers: { ...BASE, 'cache-control': 'private, max-age=3600', 'content-type': 'text/html; charset=utf-8', 'content-security-policy': HTML_CSP, 'content-length': String(body.length) }, body };
}

/** The frame's own script: one diagram at a time, strict, in the theme asked for. */
const MERMAID_FRAME = `(() => {
  let theme = '';
  let queue = Promise.resolve();
  addEventListener('message', (e) => {
    if (e.source !== parent || !e.data || typeof e.data.source !== 'string') return;
    const { id, source } = e.data;
    const want = e.data.theme === 'dark' ? 'dark' : 'default';
    queue = queue.then(async () => {
      try {
        if (want !== theme) {
          mermaid.initialize({ startOnLoad: false, theme: want, securityLevel: 'strict' });
          theme = want;
        }
        const { svg } = await mermaid.render('dv-mermaid-' + String(id).replace(/\\W/g, ''), source);
        parent.postMessage({ id, svg }, '*');
      } catch (err) {
        parent.postMessage({ id, error: String((err && err.message) || err).split('\\n')[0] || 'Mermaid could not draw this' }, '*');
      }
    });
  });
  parent.postMessage({ ready: true }, '*');
})();`;
