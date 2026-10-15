// What a person says about a dispatch whose outcome the office couldn't establish (Slice 1B-1): the card
// in Needs you reads "Couldn't confirm your answer was typed to <agent>" (or, for an issue, "The issue may
// or may not have been created") and offers:
//   - Send again: a NEW dispatch of the same revision that supersedes the old one (person-chose-resend);
//     nothing is ever replayed by the office on its own;
//   - It went through: person-confirmed-sent, confirmedBy 'person', always shown as a person's
//     confirmation, never as the system's submission, recording or execution;
//   - Abandon: person-abandoned (the decision's own record stays as it was: an escalation open, questions
//     pending, a proposal approved without an issue);
//   - for an issue: Check GitHub (one search now; only a match settles it), Create it (a new issue
//     dispatch), It exists: link #… (person-confirmed-sent with that issue).
// Admins only (http/routes/dispatch.ts checks); each is audited as dispatch.<state>.

import type { DispatchPersonAction, DispatchRecord } from '../../shared/dispatch.js';
import { human } from '../audit/index.js';
import { typeTarget } from './dispatch-send.js';
import type { Roster } from './index.js';
import { issueTarget } from './proposal-issue.js';
import type { TeamFloor } from './types.js';

/** The text a dispatch typed, without its marker line (what Send again types under a new marker). */
export const bodyOf = (r: Pick<DispatchRecord, 'payload' | 'marker'>) => {
  const p = r.payload.replace(/\s+$/, '');
  return p.endsWith(r.marker) ? p.slice(0, p.length - r.marker.length).replace(/\s+$/, '') : p;
};

/** Who a typed dispatch goes to now: its worker if it's still on the floor, else the escalation raiser's role's worker. */
function workerFor(roster: Roster, floor: TeamFloor, r: DispatchRecord) {
  const w = r.workerId ? floor.worker(r.workerId) : undefined;
  if (w) return w;
  if (!r.decision.startsWith('esc:')) return undefined;
  const d = roster.data(floor.id);
  const e = d.escalations.find((x) => `esc:${x.id}` === r.decision);
  const m = e?.role ? d.members[e.role] : undefined;
  return m ? roster.workerOf(floor, m) : undefined;
}

/** Runs a person's choice on a dispatch: the error, or a note to show (undefined when it simply went). */
export async function personAct(roster: Roster, floor: TeamFloor, id: string, action: DispatchPersonAction, by: string, o: { owner?: string; issue?: number; url?: string; env?: Record<string, string> } = {}): Promise<{ error?: string; note?: string }> {
  const d = roster.dispatch;
  await d.ready(floor.id);
  const r = d.store.get(floor.id, id);
  if (!r) return { error: 'No such dispatch' };
  if (r.state !== 'outcome-unknown') return { error: `It is ${r.state} now: nothing to settle` };
  const actor = human(by, o.owner);
  return d.claimRun(floor.id, r.decision, async () => {
    const issue = r.channel === 'github-issue';
    if (action === 'went-through' || action === 'link-issue') {
      if (action === 'link-issue' && !(Number.isInteger(o.issue) && o.issue! > 0)) return { error: 'Which issue number?' };
      if (issue && action === 'went-through' && !o.issue) return { error: 'Say which issue it is (It exists: link #…)' };
      const next = await d.settle(floor.id, r, 'person-confirmed-sent', { confirmedBy: 'person', note: issue ? `a person linked issue #${o.issue}` : 'a person said it went through', ...(issue ? { issue: { number: o.issue!, ...(o.url ? { url: o.url } : {}) } } : {}) }, by, actor);
      await d.apply(floor.id, next);
      return {};
    }
    if (action === 'abandon') {
      await d.settle(floor.id, r, 'person-abandoned', { note: 'a person abandoned it' }, by, actor);
      return {};
    }
    if (action === 'check') {
      if (!issue) return { error: 'Check GitHub is for an issue' };
      const found = await roster.deps.findIssue?.(floor.dir, r.marker).catch(() => undefined);
      if (!found) return { note: found === null ? "No issue with its marker was found yet (GitHub's search can lag a few minutes): nothing changed" : "GitHub couldn't be searched: nothing changed" };
      const next = await d.settle(floor.id, r, 'submitted', { confirmedBy: 'system', issue: { number: found.number, ...(found.url ? { url: found.url } : {}) }, note: `found issue #${found.number} by its marker` });
      await d.apply(floor.id, next);
      return { note: `Found issue #${found.number}` };
    }
    // Send again / Create it: a new dispatch of the same revision, superseding this one.
    if (action === 'create-issue') {
      if (!issue || !r.proposalId) return { error: 'Create it is for an issue' };
      const p = roster.data(floor.id).proposals.find((x) => x.id === r.proposalId);
      if (!p) return { error: 'That proposal is gone' };
      const next = await d.dispatch(floor.id, r.decision, r.answerRev, issueTarget(roster, floor, p, by, (marker) => roster.standups.makeIssue(floor, p, by, undefined, o.env, marker), r.id), r.groupId, by);
      if (typeof next === 'string') return { error: next };
      await d.settle(floor.id, r, 'person-chose-resend', { supersededBy: next.id, note: 'a person chose Create it' }, by, actor);
      if (next.state === 'submitted') await d.apply(floor.id, next);
      return next.state === 'submitted' ? {} : { note: `The new attempt is ${next.state}` };
    }
    if (issue) return { error: 'Send again is for a typed answer' };
    const w = workerFor(roster, floor, r);
    if (!w || w.kind !== 'agent') return { error: `${r.workerName ?? 'The agent'} isn't at work to send it to` };
    const next = await d.dispatch(floor.id, r.decision, r.answerRev, typeTarget(roster, floor, w, bodyOf(r), { origin: 'person', by, wake: true, hold: true, resume: true }, { supersedes: r.id, ...(r.covers ? { covers: r.covers } : {}) }), r.groupId, by);
    if (typeof next === 'string') return { error: next };
    await d.settle(floor.id, r, 'person-chose-resend', { supersededBy: next.id, note: 'a person chose Send again' }, by, actor);
    if (next.state === 'submitted' || next.state === 'held') await d.apply(floor.id, next);
    return next.state === 'refused' || next.state === 'failed' ? { error: `Sent again, but it was ${next.state}: ${next.history[next.history.length - 1]?.note ?? ''}` } : {};
  });
}
