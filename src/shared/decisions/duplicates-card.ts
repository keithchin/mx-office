// Needs you's clean-up card as a decision-card candidate (./duplicates.ts groups, ./group.ts folds): one
// card, "Likely duplicates: 9 asks repeat 5 others", listing each group, with Close duplicates (the person
// confirms; server/decisions/duplicates.ts) and Review one by one. Built from what the page already has
// (the team's escalations and proposals, the Separate choices): no fetch, no timer. Pure.

import type { NeedItem } from '../needsyou.js';
import type { RosterView } from '../roster/types.js';
import type { Candidate } from './candidates.js';
import { duplicateGroups, duplicatesWords } from './duplicates.js';
import type { DecisionSplit } from './types.js';

/** The card's id (and its compact row's key). */
export const DUPLICATES_CARD = 'duplicates';

// The grouping compares the same role's asks pairwise, and Needs you redraws often (every store change, every
// project switch): it's worked out once per roster snapshot and set of Separate choices, and reused until either changes.
const memo = new WeakMap<RosterView, { splits: readonly DecisionSplit[]; groups: ReturnType<typeof duplicateGroups> }>();

function groupsOf(r: RosterView, splits: readonly DecisionSplit[]) {
  const had = memo.get(r);
  if (had && (had.splits === splits || (!had.splits.length && !splits.length))) return had.groups;
  const groups = duplicateGroups(r.escalations ?? [], r.proposals ?? [], splits);
  memo.set(r, { splits, groups });
  return groups;
}

/** The clean-up card, when there are likely duplicates in the project. */
export function duplicatesCandidate(r: RosterView, splits: readonly DecisionSplit[] = []): Candidate | undefined {
  const groups = groupsOf(r, splits);
  if (!groups.length) return undefined;
  const { title, lines } = duplicatesWords(groups);
  const need: NeedItem = { key: DUPLICATES_CARD, kind: 'approval', icon: '🧹', text: title, level: 'warn', action: 'Review', target: { to: 'approvals' } };
  return {
    need,
    source: { id: DUPLICATES_CARD, type: 'other', label: 'Needs you’s clean-up', target: need.target },
    keys: [],
    kind: 'decision',
    prio: 2,
    body: {
      question: title,
      detail: 'The same ask was filed more than once (reworded by the same agent, or the same proposal harvested twice). Close duplicates keeps the newest of each group and closes the rest as superseded by it, recorded in the audit log; nothing is sent to the agents. Nothing closes until you confirm.',
      evidence: lines.map((label) => ({ label })),
      blocks: [],
      owner: 'the office',
      notes: [],
      duplicates: groups,
    },
  };
}
