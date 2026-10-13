// The questions for the client, as a file to send them: a CSV (opens in Excel, fills in, comes back) and
// a printable HTML page of the same rows. Only the questions marked Ask the client, or every user-only one
// still open: the id, the BRD, the question, its context in plain words, what it blocks, and an empty
// Answer column. Import reads the same CSV back (any column order, comma or semicolon), or pasted
// "OQ-05: answer" lines (shared/questions.ts parsePastedAnswers). No dependency: the repo has no xlsx or
// docx writer, so this is plain text.

import type { PmAnswer, Question } from '../../shared/questions.js';
import { isResolved, needsClient } from '../../shared/questions.js';

export const EXPORT_COLUMNS = ['ID', 'BRD', 'Question', 'Context', 'What it blocks', 'Answer'] as const;

export interface ExportRow {
  id: string;
  brd: string;
  question: string;
  context: string;
  blocks: string;
  answer: string;
}

export type ExportWhich = 'asked' | 'user-only';

/** The rows: the questions marked Ask the client (`asked`), or every open user-only one with them. */
export function exportRows(qs: readonly Question[], answers: Readonly<Record<string, PmAnswer>>, which: ExportWhich): ExportRow[] {
  const pick = qs.filter((q) => !isResolved(q.state) && (answers[q.key]?.kind === 'ask-client' || (which === 'user-only' && needsClient(q) && !answers[q.key])));
  return pick.map((q) => ({
    id: q.id,
    brd: [q.brd, q.brdTitle].filter(Boolean).join(' ') || q.file,
    question: q.question,
    context: [q.evidence, q.proposedPosition ? `Our suggestion: ${q.proposedPosition}` : '', q.owner ? `Who can answer: ${q.owner}` : ''].filter(Boolean).join(' '),
    blocks: q.blocks ?? '',
    answer: '',
  }));
}

const cell = (s: string) => (/[",;\r\n]/.test(s) || /^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);

/** The CSV, with a BOM so Excel reads it as UTF-8. */
export function toCsv(rows: readonly ExportRow[]): string {
  const lines = [EXPORT_COLUMNS.join(','), ...rows.map((r) => [r.id, r.brd, r.question, r.context, r.blocks, r.answer].map(cell).join(','))];
  return `﻿${lines.join('\r\n')}\r\n`;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** The printable page: one table, an empty Answer column to write in. */
export function toHtml(rows: readonly ExportRow[], project: string, at: number): string {
  const date = new Date(at).toISOString().slice(0, 10);
  const body = rows.map((r) => `<tr><td class="id">${esc(r.id)}</td><td>${esc(r.brd)}</td><td>${esc(r.question)}</td><td class="ctx">${esc(r.context)}</td><td>${esc(r.blocks)}</td><td class="ans"></td></tr>`).join('\n');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Questions for the client · ${esc(project)}</title>
<style>
body{font:14px/1.4 system-ui,sans-serif;margin:24px;color:#111;background:#fff}
h1{font-size:20px;margin:0 0 4px}p{margin:0 0 16px;color:#444}
table{border-collapse:collapse;width:100%}th,td{border:1px solid #999;padding:6px 8px;vertical-align:top;text-align:left}
th{background:#eee}.id{white-space:nowrap;font-weight:600}.ctx{color:#333;font-size:13px}.ans{min-width:14em;height:4em}
@media print{body{margin:0}tr{page-break-inside:avoid}}
</style></head><body>
<h1>Questions for the client · ${esc(project)}</h1>
<p>${rows.length} question${rows.length === 1 ? '' : 's'}, ${date}. Write each answer in the Answer column, or fill in the CSV and send it back.</p>
<table><thead><tr>${EXPORT_COLUMNS.map((c) => `<th>${esc(c)}</th>`).join('')}</tr></thead>
<tbody>
${body}
</tbody></table>
</body></html>
`;
}

/** A CSV read back: rows of cells (quotes, doubled quotes, line breaks in quotes; comma or semicolon, from the header). */
export function parseCsv(textIn: string): string[][] {
  const text = textIn.replace(/^﻿/, '');
  const first = text.split(/\r?\n/, 1)[0] ?? '';
  const sep = (first.match(/;/g)?.length ?? 0) > (first.match(/,/g)?.length ?? 0) ? ';' : ',';
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') (cur += '"'), i++;
      else if (c === '"') quoted = false;
      else cur += c;
    } else if (c === '"' && cur === '') quoted = true;
    else if (c === sep) row.push(cur), (cur = '');
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cur);
      rows.push(row);
      row = [];
      cur = '';
    } else cur += c;
  }
  if (cur !== '' || row.length) row.push(cur), rows.push(row);
  return rows.filter((r) => r.some((x) => x.trim()));
}

/** The answers in a filled-in CSV: its ID and Answer columns (and BRD, to tell two ids apart). */
export function csvAnswers(text: string): { id: string; answer: string; brd?: string }[] | string {
  const rows = parseCsv(text);
  const head = (rows[0] ?? []).map((h) => h.trim().toLowerCase());
  const iId = head.indexOf('id');
  const iAns = head.indexOf('answer');
  const iBrd = head.indexOf('brd');
  if (iId < 0 || iAns < 0) return 'The file needs an ID and an Answer column (the exported CSV has both)';
  return rows
    .slice(1)
    .map((r) => ({ id: (r[iId] ?? '').trim(), answer: (r[iAns] ?? '').trim(), ...(iBrd >= 0 && r[iBrd]?.trim() ? { brd: r[iBrd].trim() } : {}) }))
    .filter((r) => r.id && r.answer);
}
