// What the brief panel does with each draft it's given while the Chief Analyst updates the brief after a chat
// message (busy 'chat'): the first one starts the update (the overlay over the brief as it was), the polls
// meanwhile are held (nothing redrawn), and the first one after settles it (one redraw, the changed items
// highlighted). No DOM here, so it's tested on its own (tests/wizard-brief-overlay.test.ts).
import { changedIds, SECTION_IDS, type Brief, type DraftView } from '../../../../shared/brief';

export type UpdateStep = 'draw' | 'start' | 'hold' | 'settle';

/**
 * The step for draft `d`, given whether an update is showing now and whether the approved (folded, locked)
 * brief is drawn already. Mapping domains (busy 'domains') is no update: the brief is folded away by then and
 * can't change, so its polls are held too, without the overlay.
 */
export function updateStep(updating: boolean, d: Pick<DraftView, 'busy' | 'brief' | 'status' | 'approved'>, lockedDrawn = false): UpdateStep {
  const busy = d.busy === 'chat' && !!d.brief && d.status !== 'drafting';
  if (busy) return updating ? 'hold' : 'start';
  if (updating) return 'settle';
  return d.busy === 'domains' && !!d.approved && lockedDrawn ? 'hold' : 'draw';
}

/** The items new or changed in `after` against the brief shown before the update, with the chat turn's own list, in the brief's order. */
export function settledChanges(before: Brief | undefined, after: Brief | undefined, turn: string[] = []): string[] {
  if (!after) return [];
  const ids = new Set([...changedIds(before, after), ...turn]);
  return SECTION_IDS.flatMap((s) => after.sections[s].map((x) => x.id)).filter((id) => ids.has(id));
}

