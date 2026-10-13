// What an incident's page says about Mx Office's analysis (shared/incident-analysis.ts): whether it's
// under way, done or didn't finish, its confidence, what the evidence can't tell, the person's note, and
// per field whether the text there is its draft (labelled "check it") or a person's, with the analysis's
// own words beside a person's as a suggestion. Worded as a draft, never as proof. Pure, for the tests.

import { CONFIDENCE_LABEL, KIND_LABEL, impactLine, type AnalysisConfidence, type DraftedField } from '../../../shared/incident-analysis';
import type { Incident } from '../../../shared/incidents';

export const DRAFTED_LABEL = 'Drafted by Mx Office from the incident’s evidence: check it';

export interface FieldView {
  /** The text there is the analysis's draft. */
  drafted: boolean;
  /** The analysis's words beside a person's text. */
  suggestion?: string;
}

export interface AnalysisView {
  state: 'none' | 'pending' | 'done' | 'failed';
  /** The status line: "Analysing…", "Analysis didn't finish: …", or who drafted it when. */
  line?: string;
  confidence?: { level: AnalysisConfidence; label: string };
  evidence: string[];
  unknowns: string[];
  note?: string;
  /** Retry analysis is offered (to admins). */
  retry: boolean;
  fields: Record<DraftedField, FieldView>;
}

const day = (t: number) => new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });

export function analysisView(i: Incident): AnalysisView {
  const a = i.analysis;
  const none: FieldView = { drafted: false };
  if (!a) return { state: 'none', evidence: [], unknowns: [], retry: false, fields: { rootCause: none, impact: none, actions: none } };
  const r = a.result;
  const drafted = (f: DraftedField) => a.drafted.includes(f);
  const differs = (mine: string | undefined, theirs: string) => !!mine?.trim() && mine.trim() !== theirs.trim();
  const fields: Record<DraftedField, FieldView> = {
    rootCause: { drafted: drafted('rootCause'), ...(r && !drafted('rootCause') && differs(i.rootCause, r.rootCause.text) ? { suggestion: r.rootCause.text } : {}) },
    impact: { drafted: drafted('impact'), ...(r && !drafted('impact') && differs(i.impact.text, impactLine(r)) ? { suggestion: impactLine(r) } : {}) },
    actions: { drafted: drafted('actions'), ...(r && !drafted('actions') && i.actions.length ? { suggestion: r.correctiveActions.map((x) => `${KIND_LABEL[x.kind]}: ${x.action}${x.owner ? ` (${x.owner})` : ''}`).join(' · ') } : {}) },
  };
  const busy = a.status === 'pending' || a.status === 'running';
  const cost = a.costUsd ? `, $${a.costUsd.toFixed(2)}` : '';
  const line = busy
    ? 'Analysing… Mx Office is drafting the root cause, impact and corrective actions from the incident’s evidence'
    : a.status === 'failed'
      ? `Analysis didn’t finish: ${a.error ?? 'no reason given'}`
      : r
        ? `Drafted by Mx Office on ${day(a.finishedAt ?? a.requestedAt)} (${a.model ?? 'model unknown'}${cost}) from the incident’s records. An AI draft, not proof: check it`
        : undefined;
  return {
    state: busy ? 'pending' : a.status === 'failed' ? 'failed' : 'done',
    line,
    ...(r ? { confidence: { level: r.rootCause.confidence, label: CONFIDENCE_LABEL[r.rootCause.confidence] } } : {}),
    evidence: r?.rootCause.evidence ?? [],
    unknowns: r?.unknowns ?? [],
    ...(a.note ? { note: a.note } : {}),
    retry: a.status === 'failed',
    fields,
  };
}
