// Approving a proposal makes its GitHub issue as a durable dispatch (Slice 1B-1, plan §2.4): the approval
// is appended to the answer store, the dispatch intent (channel github-issue, the marker
// `office-proposal: <id> rev <n>` that goes into the issue body) is written, and, still before makeIssue,
// the proposal is set to `approved` with no issue and that is flushed to disk: a status release 47 never
// offers for approval again, so neither it nor a restart can make a second issue. Success records the
// issue → submitted. A failure or a timeout from gh may have made the issue anyway, so it is
// outcome-unknown, never retried by itself: reconcile searches for the marker (only a match is conclusive),
// and the person sees Check GitHub / Create it / It exists: link #… (dispatch/person.ts).

import type { Proposal } from '../../shared/roster/types.js';
import type { DispatchRecord } from '../../shared/dispatch.js';
import type { IssueDraft } from '../../shared/roster/journal.js';
import type { Outcome, Target } from '../dispatch/service.js';
import type { MadeIssue } from './issues.js';
import type { Roster } from './index.js';
import type { TeamFloor } from './types.js';
import { taskLine } from '../../shared/tasks.js';

/** The issue body with the proposal's marker as its last line. */
export const withIssueMarker = (draft: IssueDraft, marker: string): IssueDraft => ({ ...draft, body: `${draft.body}\n\n---\n${marker}` });

/** The github-issue target: the conservative status on disk first, then the issue. */
export function issueTarget(roster: Roster, floor: TeamFloor, p: Proposal, by: string, make: (marker: string) => Promise<MadeIssue>, supersedes?: string): Target {
  return {
    channel: 'github-issue',
    workerName: 'GitHub',
    proposalId: p.id,
    ...(supersedes ? { supersedes } : {}),
    payload: (marker) => `${p.title}\n\n${marker}`,
    act: async (r): Promise<Outcome> => {
      const was = { status: p.status, issue: p.issue };
      p.status = 'approved';
      delete p.issue;
      p.dispatchId = r.id;
      // Its work is a task from now on (Slice 1B-4): the task id rides in the issue body, under the marker. The
      // task's record and the proposal pointing at it are both on disk before the issue is made.
      const store = roster.tasks.ids.of(floor.id);
      const hadTask = p.taskId;
      try {
        p.taskId ??= (await store.createDurable(floor.id, { source: 'proposal', text: p.title })).id;
        await store.durable(floor.id, p.taskId);
      } catch (err) {
        Object.assign(p, was);
        if (hadTask) p.taskId = hadTask;
        else delete p.taskId;
        return { state: 'failed', note: `the task's record couldn't be saved before making the issue (${(err as Error).message}), so no issue was made` };
      }
      try {
        await roster.file(floor.id).flushCritical();
      } catch (err) {
        Object.assign(p, was);
        return { state: 'failed', note: `the approval couldn't be saved before making the issue (${(err as Error).message}), so no issue was made` };
      }
      let made: MadeIssue;
      try {
        // The marker stays the body's last line (reconcile and people look for it there), the task line just above it.
        made = await make(`${taskLine(p.taskId)}\n${r.marker}`);
      } catch (err) {
        return { state: 'outcome-unknown', note: `gh failed (${(err as Error).message.slice(0, 160)}): the issue may or may not exist` };
      }
      if (made.error) return { state: 'outcome-unknown', note: `gh said: ${made.error.slice(0, 160)} (the issue may or may not exist)` };
      if (made.dryRun) return { state: 'submitted', note: 'dry run: no issue made' };
      if (made.number) store.setIssue(floor.id, p.taskId, made.number);
      return { state: 'submitted', issue: { ...(made.number ? { number: made.number } : {}), ...(made.url ? { url: made.url } : {}) }, note: made.number ? `issue #${made.number}` : 'made' };
    },
  };
}

/**
 * The Project Manager's approval with its issue: the error, or undefined once approved (an issue whose
 * outcome is unknown is an error the person settles on the card; the proposal stays approved, no issue).
 */
export async function approveWithIssue(roster: Roster, floor: TeamFloor, p: Proposal, by: string, why: string | undefined, make: (marker: string) => Promise<MadeIssue>, expectedRev?: number): Promise<string | undefined> {
  let dry = false;
  const r = await roster.dispatch.answer(floor.id, {
    decision: `proposal:${p.id}`,
    expectedRev,
    current: () => ({ rev: p.answerRev ?? 0, state: p.status, ...(p.status !== 'pending' && p.status !== 'change' ? { open: `Already ${p.status === 'auto' ? 'decided by the team' : p.status}` } : {}) }),
    revision: { kind: 'approve', text: why ?? '', by },
    targets: () => [issueTarget(roster, floor, p, by, make)],
    apply: (rev, records) => {
      const rec = records[0];
      p.answerRev = rev;
      if (rec) applyIssue(p, rec);
      dry = rec?.history[rec.history.length - 1]?.note === 'dry run: no issue made';
      if (dry) p.issue = { dryRun: true };
    },
  });
  if (!r.ok) return r.error;
  const rec = r.results[0]?.records[0];
  if (!rec) return 'Not approved';
  if (rec.state === 'failed') return `Couldn't make the issue: ${rec.history[rec.history.length - 1]?.note ?? 'failed'}`;
  if (r.results[0].pending) {
    p.answerRev = r.results[0].rev;
    roster.touch(floor);
    return `Couldn't confirm the issue was made (${rec.history[rec.history.length - 1]?.note ?? 'unclear'}). It is approved without an issue: check GitHub, then say on the card in Needs you (Create it, or It exists)`;
  }
  return undefined;
}

/** The issue a settled github-issue dispatch made (or a person linked) on its proposal. */
export function applyIssue(p: Proposal, r: DispatchRecord) {
  p.status = 'approved';
  p.dispatchId = r.id;
  if (r.issue?.number || r.issue?.url) p.issue = { ...(r.issue.number ? { number: r.issue.number } : {}), ...(r.issue.url ? { url: r.issue.url } : {}) };
}

/** The applier for proposal:<id> records settled later (reconcile found the issue, a person linked one). */
export function hookProposals(roster: Roster) {
  roster.dispatch.appliers.set('proposal', async (floorId, r) => {
    const p = roster.data(floorId).proposals.find((x) => `proposal:${x.id}` === r.decision);
    if (!p) return;
    applyIssue(p, r);
    if (p.taskId && r.issue?.number) roster.tasks.ids.of(floorId).setIssue(floorId, p.taskId, r.issue.number);
    const floor = roster.deps.floors().find((f) => f.id === floorId);
    if (floor) roster.touch(floor);
    await roster
      .file(floorId)
      .flushCritical()
      .catch(() => undefined);
  });
}
