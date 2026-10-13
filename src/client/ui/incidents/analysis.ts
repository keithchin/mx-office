// Mx Office's analysis on an incident's page (./analysis-logic.ts says what): a box under the summary with
// its state (Analysing…, drafted with its confidence, or didn't finish with Retry analysis for admins),
// what supports it, what the evidence can't tell and your note; and, in Root cause, Impact and Corrective
// actions, the "check it" label on its draft or its words beside yours as a suggestion. Edit is the
// incident's own form: what you change there is yours.

import type { Incident } from '../../../shared/incidents';
import type { DraftedField } from '../../../shared/incident-analysis';
import { h, toast } from '../dom';
import { DRAFTED_LABEL, analysisView, type AnalysisView } from './analysis-logic';

/** POST /api/incidents/<id>/analyse: Retry analysis. */
export async function retryAnalysis(id: string): Promise<{ incident?: Incident; error?: string } | undefined> {
  try {
    const res = await fetch(`/api/incidents/${encodeURIComponent(id)}/analyse`, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: '{}' });
    return (await res.json().catch(() => ({}))) as { incident?: Incident; error?: string };
  } catch {
    return undefined;
  }
}

/** The box under the summary; null when the incident was never analysed. */
export function analysisBox(i: Incident, admin: boolean, changed: (i: Incident) => void, v: AnalysisView = analysisView(i)): HTMLElement | null {
  if (v.state === 'none') return null;
  const retry = async (b: HTMLButtonElement) => {
    b.disabled = true;
    const r = await retryAnalysis(i.id);
    b.disabled = false;
    if (r?.incident) changed(r.incident);
    if (r?.error || !r) toast(r?.error ?? "Couldn't reach the office", 'warn');
  };
  const retryBtn = v.retry && admin ? (h('button.btn.small', { type: 'button' }, 'Retry analysis') as HTMLButtonElement) : null;
  retryBtn?.addEventListener('click', () => void retry(retryBtn));
  return h(
    'section.inc-sec.inc-analysis',
    { 'data-state': v.state, 'aria-live': 'polite' },
    h('h3', {}, 'Mx Office’s analysis'),
    h('p.inc-an-line', {}, v.line ?? '', retryBtn ? ' · ' : null, retryBtn),
    v.confidence ? h('p', {}, h('span.inc-conf', { 'data-conf': v.confidence.level }, v.confidence.label), v.confidence.level === 'low' ? h('small.inc-hint', {}, ' The evidence only hints at this cause: treat it as a lead, not an answer.') : null) : null,
    v.evidence.length ? h('details.inc-an-ev', {}, h('summary', {}, 'What supports it'), h('ul', {}, ...v.evidence.map((e) => h('li', {}, e)))) : null,
    v.unknowns.length ? h('div.inc-an-unk', {}, h('b', {}, 'What the evidence can’t tell'), h('ul', {}, ...v.unknowns.map((u) => h('li', {}, u)))) : null,
    v.note ? h('p.inc-an-note', {}, h('b', {}, 'Your note: '), v.note) : null,
  );
}

/** The label on a field that holds the analysis's draft, or its words beside a person's text. */
export function fieldNote(v: AnalysisView, f: DraftedField): HTMLElement | null {
  const fv = v.fields[f];
  if (fv.drafted) return h('small.inc-drafted', {}, DRAFTED_LABEL);
  if (fv.suggestion) return h('p.inc-suggest', {}, h('b', {}, 'Mx Office’s analysis suggests: '), fv.suggestion, h('small.inc-hint', {}, ' (yours is kept; use Edit to take any of it)'));
  return null;
}
