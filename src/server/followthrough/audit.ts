// The historical check of the exact-answer rule (reliability pass, docs/site/teams-and-agents/escalations.md):
// which findings the office made automatically under the old matching rule (the expected words anywhere in
// the record) read "Recorded as given" but would not now, because the record's answer value isn't exactly
// the decision. Read-only and pure: it is handed what the office kept (a floor's follow-through findings, the
// answer store's revisions, the questions book's answers) and, when it can be read, the recorded file at its
// commit; it rewrites nothing. A person's own acceptance (Accept as recorded) is never re-judged: it is
// reported as skipped. Going forward the same records read "Needs review" through judge.ts alone.

import { faithful, type RecordedOutcome, type Recording } from '../../shared/followthrough.js';
import type { AnswerRevision } from '../../shared/dispatch.js';
import { isQState, type PmAnswer, type Question } from '../../shared/questions.js';
import { citations, judgeCitation, judgeQuestion, type Judged } from './judge.js';

type Rev = Pick<AnswerRevision, 'rev' | 'kind' | 'text' | 'option' | 'supersedes' | 'basis'>;

export interface AuditFinding {
  decision: string;
  kind: 'esc' | 'q';
  /** The revision the automatic finding was for. */
  rev?: number;
  /** Whether it settled anything (as given, at the current revision, merged into main; a question marked recorded). */
  settled: boolean;
  /** What was decided (the current revision's words, or the question's expected record). */
  decided: string;
  /** What is recorded, as the office kept or re-read it. */
  recorded: string;
  /** The answer value read from the citation's line, when there is one. */
  answer?: string;
  /** What the exact rule says of it now. */
  now: RecordedOutcome;
  /** Re-read from the committed file at the recorded commit, or worked out from the text the office kept (approximate). */
  basis: 'committed-file' | 'stored-text';
  where?: Recording['location'];
}

export type AuditResult = { finding: AuditFinding } | { skip: string } | undefined;

const RANK: Record<RecordedOutcome, number> = { recorded: 4, 'needs-review': 3, 'recorded-differently': 2, 'recorded-older-rev': 1, 'not-recorded-yet': 0 };
const best = (js: readonly Judged[]) => [...js].sort((a, b) => RANK[b.outcome] - RANK[a.outcome])[0];

/**
 * One escalation's kept finding: undefined when it isn't an automatic "recorded as given" or still is one;
 * a skip when a person accepted it (or it can't be checked); else what the exact rule says now.
 */
export function auditEscalation(decision: string, rec: Recording | undefined, history: readonly Rev[], fileText?: string): AuditResult {
  if (!rec || rec.outcome !== 'recorded') return undefined;
  const current = history[history.length - 1];
  if (!current) return { skip: 'no answer revisions kept' };
  if (current.kind === 'accept-as-recorded' && rec.rev === current.rev) return { skip: 'a person accepted it as recorded (never re-judged)' };
  const id = decision.replace(/^esc:/, '');
  let basis: AuditFinding['basis'] = 'committed-file';
  let found = fileText === undefined ? [] : citations(fileText).filter((c) => c.id.toLowerCase() === id.toLowerCase());
  if (!found.length) {
    if (!rec.text) return { skip: fileText === undefined ? 'no recorded text kept and no committed file to read' : 'the citation is no longer in the recorded commit, and no text was kept' };
    // The kept text is the record with the citation taken out: read as if it were the whole answer part.
    basis = 'stored-text';
    found = citations(`Decided per ESC-${id} rev ${rec.rev ?? current.rev}: ${rec.text.replace(/\s+/g, ' ')}`);
  }
  const judged = found.map((c) => ({ c, j: judgeCitation(c, history) })).filter((x): x is { c: (typeof found)[number]; j: Judged } => !!x.j);
  const top = best(judged.map((x) => x.j));
  if (top?.outcome === 'recorded') return undefined;
  const j = top ?? { outcome: 'not-recorded-yet' as const };
  return {
    finding: { decision, kind: 'esc', ...(rec.rev !== undefined ? { rev: rec.rev } : {}), settled: faithful(rec, current.rev), decided: current.text || current.kind, recorded: j.text ?? rec.text ?? '', ...(j.answer !== undefined ? { answer: j.answer } : {}), now: j.outcome, basis, ...(rec.location ? { where: rec.location } : {}) },
  };
}

/** The BRD record a kept question finding describes (recordedOf in judge.ts, read back). */
export function questionFromText(a: Pick<PmAnswer, 'key' | 'id' | 'file'>, text: string): Question | undefined {
  const m = /^([A-Z-]+): ?([\s\S]*)$/.exec(text);
  const state = m?.[1];
  const base = { key: a.key, id: a.id, file: a.file, question: '', rawStatus: text, source: { where: 'main', committed: true } } as unknown as Question;
  if (state === 'ASSUMED') {
    const x = /^([\s\S]*?)(?: \(consent: ([^,]*)(?:, (.*))?\))?$/.exec(m![2])!;
    return { ...base, state: 'ASSUMED', rawStatus: 'ASSUMED', assumption: x[1], ...(x[2] ? { consentBy: x[2] } : {}), ...(x[3] ? { consentAt: x[3] } : {}) };
  }
  if (/^MOOT\b/.test(text)) return { ...base, state: 'MOOT' };
  if (!state || !isQState(state)) return undefined;
  return { ...base, state, rawStatus: state, answer: m![2] };
}

/** One question answer the office marked recorded (or found as given) automatically: what the exact rule says of it now. */
export function auditQuestion(decision: string, a: PmAnswer, history: readonly Rev[]): AuditResult {
  const rec = a.recording;
  if (!rec || rec.outcome !== 'recorded' || a.answerRev === undefined || !a.expected?.length) return undefined;
  const current = history[history.length - 1];
  if (current?.kind === 'accept-as-recorded' && current.rev === a.answerRev) return { skip: 'a person accepted it as recorded (never re-judged)' };
  const q = rec.text ? questionFromText(a, rec.text) : undefined;
  if (!q) return { skip: 'no recorded text kept to re-check' };
  const j = judgeQuestion(q, a);
  if (j.outcome === 'recorded') return undefined;
  const x = a.expected.find((e) => e.rev === a.answerRev) ?? a.expected[a.expected.length - 1];
  return { finding: { decision, kind: 'q', rev: a.answerRev, settled: a.status === 'recorded', decided: `${x.state}: ${x.answer ?? x.decision ?? x.reason ?? ''}`, recorded: rec.text ?? '', now: j.outcome, basis: 'stored-text', ...(rec.location ? { where: rec.location } : {}) } };
}
