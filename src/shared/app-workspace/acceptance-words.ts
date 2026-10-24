// What the Developer view says when accepting or reopening a version is refused (C5): the existing acceptance
// path's own answer (http/routes/progress.ts, server/acceptance/), unchanged, said plainly. Wording only: the
// decision is the server's. A refusal it doesn't know is never guessed at: it shows the server's own words, or
// says the office refused and points at Project Management's acceptance record, which shows the full reason.
// Pure.

export interface PlainRefusal {
  /** One line: what happened. */
  lead: string;
  /** Why, a line each (the security checks still missing, as the server names them). */
  reasons: string[];
  /** Nothing was recorded and trying again after looking is the way on (a stale review, a check started). */
  again?: boolean;
}

const MISSING = /Missing:\s*([^]*?)\.\s*See App Insights/;

/** The refusal of an Accept or a Reopen (`status` the HTTP status, `error` the server's words), said plainly. */
export function plainRefusal(status: number, error: string | undefined): PlainRefusal {
  const e = error ?? '';
  if (status === 0) return { lead: 'The office couldn’t be reached, so nothing was recorded. Try again.', reasons: [], again: true };
  if (status === 401) return { lead: 'Sign in again to accept from here: over phone access the office asks for your password again first.', reasons: [] };
  if (status === 403) return { lead: 'Only the Project Manager can accept or reopen a version.', reasons: [] };
  if (/security baseline/i.test(e)) {
    const m = MISSING.exec(e);
    const reasons = (m?.[1] ?? '').split(';').map((x) => x.trim()).filter(Boolean);
    const started = /has started an mx check|is running now/i.test(e);
    return { lead: 'This version can’t be accepted yet: the security checks haven’t passed on it.', reasons: [...new Set(reasons)].concat(started ? ['The office has started the security check. It takes a few minutes: try again when it has finished.'] : []), again: started };
  }
  if (/changed since it was reviewed|review the evidence before accepting/i.test(e)) return { lead: 'Something changed while you were looking (the version, what was checked on it, or the cost), so nothing was recorded. Look at it again and confirm.', reasons: [], again: true };
  if (/delivery cycle changed meanwhile/i.test(e)) return { lead: 'Someone accepted or reopened this meanwhile, so nothing was recorded. Close this and look again.', reasons: [], again: true };
  if (/is already accepted/i.test(e)) return { lead: 'This version is already accepted. Reopen it to start the next version.', reasons: [] };
  if (/isn't accepted yet: there's nothing to reopen/i.test(e)) return { lead: 'This version isn’t accepted yet, so there’s nothing to reopen.', reasons: [] };
  if (/could not be read/i.test(e)) return { lead: 'The office couldn’t read the version to accept. Ask the team to finish committing it, then try again.', reasons: [] };
  if (/version looks like|has to come after/i.test(e)) return { lead: e.replace(/\.?$/, '.'), reasons: [] };
  if (/scope note/i.test(e)) return { lead: 'Say what the next version is for.', reasons: [] };
  if (e) return { lead: e.replace(/\.?$/, '.'), reasons: [] };
  return { lead: 'The office refused, and nothing was recorded. Project Management’s acceptance record says why.', reasons: [] };
}
