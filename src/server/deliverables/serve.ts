// What the file routes answer for one deliverable (http/routes/deliverables.ts), as status, headers and
// body, so the tests can check each kind without a server: an HTML report self-contained under a CSP
// with no network and no origin, pictures and text sandboxed, a PDF for the browser's viewer framed by
// the office only, an xlsx (or anything asked with download) as an attachment, a CSV as table rows.

import { kindOf } from '../../shared/deliverables.js';
import { CAPS, contentType, HTML_CSP, inlineHtml, parseCsv, readDeliverable, type Source } from './content.js';

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
