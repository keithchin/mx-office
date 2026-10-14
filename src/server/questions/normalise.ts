// The toolkit's normaliser (bin/open-questions.sh, its mapping table) for a BRD openQuestion, used only
// when the script can't run: the page then says it read the BRD files itself. The rules are the script's,
// in its order, on the leading token of the lowercased status, never "contains". The script stays the
// authority: when it runs, its verdict is the one shown.

import type { QState } from '../../shared/questions.js';

export interface RawQuestion {
  status?: unknown;
  answer?: unknown;
  resolution?: unknown;
  decision?: unknown;
  assumption?: unknown;
  consentBy?: unknown;
  consentAt?: unknown;
}

const str = (v: unknown) => (v === null || v === undefined ? '' : String(v)).replace(/[\t\n\r]/g, ' ').replace(/ {2,}/g, ' ').trim();

/** The status's leading text, lowercased, with the script's markdown and quotes taken off. */
const leading = (s: string) =>
  s
    .toLowerCase()
    .replace(/^[ \t*_>-]+/, '')
    .replace(/[`"]/g, '');

/** What follows the leading word(s). */
const nextClause = (s: string) =>
  leading(s)
    .replace(/^[a-z/ ]*/, '')
    .replace(/^[ \t.,;:\-—()]+/, '');

/** The toolkit's state for one BRD question, and why (the script's words). */
export function normalise(q: RawQuestion): { state: QState; reason: string; assumedNoConsent?: boolean } {
  const raw = str(q.status);
  const L = leading(raw);
  const answer = str(q.answer) || str(q.resolution);
  const assumption = str(q.decision) || str(q.assumption);
  const consented = !!str(q.consentBy) && !!str(q.consentAt);
  if (!L) return { state: 'UNRAISED', reason: 'verdict column present but blank (rule 1)' };
  if (/^(resolved|closed|answered|decided|confirmed)/.test(L)) return answer || assumption ? { state: 'ANSWERED', reason: 'resolved with a recorded answer (rule 2)' } : { state: 'UNRECOGNISED', reason: 'claims resolved but records no answer/decision/resolution (rule 3)' };
  if (/^assumed/.test(L)) return consented ? { state: 'ASSUMED', reason: 'assumed with consent (rule 4)' } : { state: 'UNRAISED', reason: 'ASSUMED with no consentBy/consentAt — a position taken the user never saw (rule 5)', assumedNoConsent: true };
  if (/^unraised/.test(L)) return { state: 'UNRAISED', reason: 'explicitly unraised — never put to the user (rule 5b)' };
  if (/^(raised|awaiting)/.test(L)) return { state: 'RAISED', reason: 'raised, awaiting the user (rule 6)' };
  if (/^(moot|n\/a|not applicable|not relevant|irrelevant|does not apply|withdrawn)/.test(L)) return { state: 'MOOT', reason: nextClause(raw) ? 'moot — marked not relevant (rule 7)' : 'moot, no reason given (rule 7)' };
  if (/^(open|carried forward)/.test(L)) return /^moot/.test(nextClause(raw)) ? { state: 'MOOT', reason: 'open but explicitly moot (rule 8)' } : { state: 'UNRAISED', reason: 'open — never put to the user (rule 9)' };
  return { state: 'UNRECOGNISED', reason: 'no rule matched leading token (rule 11)' };
}

/** Written ASSUMED with no consent: what the script normalises to UNRAISED, and the page warns about. */
export const assumedWithoutConsent = (q: RawQuestion) => /^assumed/.test(leading(str(q.status))) && !(str(q.consentBy) && str(q.consentAt));
