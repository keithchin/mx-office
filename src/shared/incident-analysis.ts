// Mx Office's analysis of a resolved incident: a root cause, its impact and corrective actions drafted
// from the incident's own evidence (server/incidents/analysis.ts runs it, ui/incidents/ shows it). It's an
// AI draft, not proof: it says how confident it is and what the evidence can't tell, and a person checks
// and corrects it. Its text fills only the fields a person hasn't written; once a person edits one, that
// field is theirs. Shared by the server and the page; pure.

export type AnalysisStatus = 'pending' | 'running' | 'done' | 'failed';
export type AnalysisConfidence = 'low' | 'medium' | 'high';
export const CONFIDENCES: readonly AnalysisConfidence[] = ['low', 'medium', 'high'];
export type ActionKind = 'fix' | 'prevent' | 'detect';
export const ACTION_KINDS: readonly ActionKind[] = ['fix', 'prevent', 'detect'];

/** What the analysis answers (ANALYSIS_SCHEMA). */
export interface AnalysisResult {
  rootCause: { text: string; confidence: AnalysisConfidence; evidence: string[] };
  /** Who or what was affected, and for how long. */
  impact: { text: string; scope: string };
  correctiveActions: { action: string; kind: ActionKind; owner?: string }[];
  /** What the evidence can't tell. */
  unknowns: string[];
}

/** The incident's fields that hold the analysis's text until a person edits them. */
export type DraftedField = 'rootCause' | 'impact' | 'actions';

export interface IncidentAnalysis {
  status: AnalysisStatus;
  requestedAt: number;
  requestedBy: string;
  /** The person's "Anything you already know?" note, given to the analysis and kept as "Your note". */
  note?: string;
  startedAt?: number;
  finishedAt?: number;
  /** Why it didn't finish (failed). */
  error?: string;
  /** The model that drafted it ("test analyser" in test mode). */
  model?: string;
  /** What its tries cost so far, USD (counted against the cap per incident). */
  costUsd: number;
  attempts: number;
  result?: AnalysisResult;
  /** The fields that hold its draft: a person's edit takes a field off this list. */
  drafted: DraftedField[];
}

/** The answer's JSON schema (`claude -p --json-schema`). */
export const ANALYSIS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['rootCause', 'impact', 'correctiveActions', 'unknowns'],
  properties: {
    rootCause: {
      type: 'object',
      additionalProperties: false,
      required: ['text', 'confidence', 'evidence'],
      properties: {
        text: { type: 'string', description: 'The most likely root cause, worded as likely, not certain' },
        confidence: { type: 'string', enum: ['low', 'medium', 'high'] },
        evidence: { type: 'array', items: { type: 'string' }, description: 'Which records support it: the detection rule, audit event ids, timeline entries' },
      },
    },
    impact: {
      type: 'object',
      additionalProperties: false,
      required: ['text', 'scope'],
      properties: { text: { type: 'string' }, scope: { type: 'string', description: 'Who or what was affected, and for how long' } },
    },
    correctiveActions: {
      type: 'array',
      minItems: 1,
      maxItems: 5,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['action', 'kind'],
        properties: { action: { type: 'string' }, kind: { type: 'string', enum: ['fix', 'prevent', 'detect'] }, owner: { type: 'string' } },
      },
    },
    unknowns: { type: 'array', items: { type: 'string' }, description: 'What the evidence cannot tell' },
  },
} as const;

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/\r\n/g, '\n').trim().slice(0, max) : '');
const strs = (v: unknown, n: number, max: number) => (Array.isArray(v) ? v.map((x) => str(x, max)).filter(Boolean).slice(0, n) : []);

/** An answer made safe to keep: the shape enforced, lengths capped, 1–5 actions; undefined when it doesn't fit. */
export function cleanAnalysis(raw: unknown): AnalysisResult | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Record<string, any>;
  const text = str(r.rootCause?.text, 2000);
  if (!text) return undefined;
  const confidence: AnalysisConfidence = CONFIDENCES.includes(r.rootCause?.confidence) ? r.rootCause.confidence : 'low';
  const actions = (Array.isArray(r.correctiveActions) ? r.correctiveActions : [])
    .map((a: any) => ({ action: str(a?.action, 300), kind: (ACTION_KINDS.includes(a?.kind) ? a.kind : 'fix') as ActionKind, ...(str(a?.owner, 80) ? { owner: str(a?.owner, 80) } : {}) }))
    .filter((a: { action: string }) => a.action)
    .slice(0, 5);
  if (!actions.length) return undefined;
  return {
    rootCause: { text, confidence, evidence: strs(r.rootCause?.evidence, 12, 200) },
    impact: { text: str(r.impact?.text, 1000), scope: str(r.impact?.scope, 500) },
    correctiveActions: actions,
    unknowns: strs(r.unknowns, 8, 300),
  };
}

/** The impact as one line for the incident's "Other" field. */
export const impactLine = (r: AnalysisResult) => [r.impact.text, r.impact.scope ? `Scope: ${r.impact.scope}` : ''].filter(Boolean).join(' ').slice(0, 1000);

export const CONFIDENCE_LABEL: Record<AnalysisConfidence, string> = { low: 'Low confidence', medium: 'Medium confidence', high: 'High confidence' };
export const KIND_LABEL: Record<ActionKind, string> = { fix: 'Fix', prevent: 'Prevent', detect: 'Detect' };
