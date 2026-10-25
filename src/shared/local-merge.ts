// The Project Manager's merge for local-only projects (server/local-merge/): what the banner shows and sends.
// Pure: the browser imports it too.

/** A person's review of a team branch at the exact head they saw. */
export interface LocalMergeReview {
  branch: string;
  sha: string;
  verdict: 'approve' | 'changes';
  by: string;
  byId?: string;
  at: number;
  note?: string;
}

export interface LocalMergeBranch {
  branch: string;
  sha: string;
  ahead: number;
  behind: number;
  subject: string;
  owner?: string;
  /** The review of exactly this head, when there is one. */
  review?: LocalMergeReview;
}

export interface LocalMergeView {
  floor: string;
  /** Created with "Keep this project off GitHub": only then is there anything here. */
  localOnly: boolean;
  main: string;
  branches: LocalMergeBranch[];
  /** The team's autonomy: whether merges wait on the Project Manager at its level (they may merge at any level). */
  level: number;
  levelName: string;
  pmDecides: boolean;
}

/** What a branch's row says about its review and what's next. */
export function mergeStateWords(b: LocalMergeBranch): string {
  if (!b.review) return `not reviewed at ${b.sha.slice(0, 7)}: review it first`;
  return b.review.verdict === 'approve' ? `approved by ${b.review.by} at ${b.sha.slice(0, 7)}: ready to merge` : `changes asked by ${b.review.by} at ${b.sha.slice(0, 7)}`;
}
