// "Review and merge @C" on a Developer change's receipt (app-workspace/dock/cards.ts), for a local-only project:
// the candidate's commit on dev/DC-n goes through the same confirm step and server path as the merge panel
// (./confirm.ts, server/local-merge/): your approval of exactly that commit, then a --no-ff merge of it, so the
// PM doesn't have to go to Project Management. Admins only (the view's mayMerge), at any autonomy level (the
// confirm step says whose merges they are). A candidate seen after cancel or supersede ("late") never offers it.

import type { DevChangeView } from '../../../shared/dev-changes';
import { h } from '../dom';
import { openMergeConfirm } from './confirm';
import { devFeed } from '../dev-changes/feed';

/** The candidate a receipt may merge: the newest one that counts, while the change is on a candidate. */
export function mergeCandidate(c: Pick<DevChangeView, 'state' | 'candidates'>): { sha: string; branch: string } | undefined {
  if (c.state !== 'candidate') return undefined;
  const cand = c.candidates.filter((x) => !x.late).at(-1);
  return cand ? { sha: cand.sha, branch: cand.branch } : undefined;
}

/** The receipt's button, or nothing. */
export function receiptMergeButton(floor: string, c: DevChangeView, mayMerge: boolean | undefined): HTMLElement | '' {
  const cand = mayMerge ? mergeCandidate(c) : undefined;
  if (!cand) return '';
  const btn = h('button.aw-btn.dk-merge', { type: 'button', 'data-act': 'review-merge', 'data-sha': cand.sha, title: `Review exactly @${cand.sha.slice(0, 7)} of ${cand.branch} and merge it into main, after a confirm step` }, `Review and merge @${cand.sha.slice(0, 7)}`) as HTMLButtonElement;
  btn.addEventListener('click', () => void openMergeConfirm({ floor, branch: cand.branch, sha: cand.sha, opener: btn, reviewFirst: true, onDone: () => devFeed.now(floor) }));
  return btn;
}
