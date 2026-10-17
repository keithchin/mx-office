// "main is behind the work": the Model tab and the Live app tab both show main, while the build may be on
// an agent's branch far ahead of it with model changes, in a PR nobody reviewed (PackTrack, release 56:
// main had build rows 3–14 with stub pages, Sophie's branch was 75 commits ahead in PR #6, open and
// unreviewed). The banner says so: whose branch, how far ahead, its PR and its review state from the
// review gate (a `Review:` comment by someone other than the opener, with checks and files). Pure.

export interface AheadBranch {
  branch: string;
  sha: string;
  /** The agent working on it, or who opened its PR. */
  owner?: string;
  /** Commits it has that main hasn't. */
  ahead: number;
  /** Model files it changes against where it left main (.mpr, mprcontents/, mdlsource/). */
  modelFiles: number;
  pr?: { number: number; url?: string; draft?: boolean };
  /** The review gate's view of its PR: reviewed by these, or not reviewed (no PR: nothing to review yet). */
  review: { state: 'reviewed' | 'not-reviewed' | 'no-pr'; by?: string[] };
}

export interface AheadView {
  floor: string;
  /** main as the project names it. */
  main: string;
  branches: AheadBranch[];
  /** Whoever covers Management and is at work (the [Ask … to review] button), when there is one. */
  lead?: string;
  at: number;
}

const prWords = (b: AheadBranch) => (b.pr ? `PR #${b.pr.number}, ${b.pr.draft ? 'draft' : 'open'}, ${b.review.state === 'reviewed' ? `reviewed by ${(b.review.by ?? []).join(', ')}` : 'not reviewed'}` : 'no PR yet');
const whose = (b: AheadBranch) => (b.owner ? `${b.owner}'s branch` : `branch ${b.branch}`);

/** The banner's sentence: "main is 75 commits behind Sophie's branch, which has model changes (PR #6, open, not reviewed)". */
export function aheadLine(v: Pick<AheadView, 'main' | 'branches'>): string {
  const [first, ...rest] = v.branches;
  if (!first) return '';
  const one = `${v.main} is ${first.ahead} commit${first.ahead === 1 ? '' : 's'} behind ${whose(first)}, which has model changes (${prWords(first)})`;
  if (!rest.length) return one;
  return `${one}; also ${rest.map((b) => `${whose(b)} (${b.ahead} ahead, ${prWords(b)})`).join('; ')}`;
}

/** The lead's message: review the branch per the review gate, so main can catch up. */
export function reviewAsk(main: string, b: AheadBranch): string {
  const what = b.pr ? `PR #${b.pr.number} (${b.branch})` : `the branch ${b.branch}`;
  return [
    `The Project Manager asks for a review of ${what}${b.owner ? `, ${b.owner}'s work` : ''}: it is ${b.ahead} commits ahead of ${main} with model changes (${b.modelFiles} model file${b.modelFiles === 1 ? '' : 's'}), and the Model and Live app tabs show ${main}, so nobody sees it until it merges.`,
    b.pr ? `Review it per the review gate: someone other than its opener reads the changed files, runs the checks, and posts a \`Review:\` comment on the PR naming the reviewer, each check with its result, and the files read. Then merge it, or say on the PR what blocks it.` : `Open a PR for it first (the review gate reviews PRs), then review it per the gate: a \`Review:\` comment by someone other than its opener, with checks and files read.`,
  ].join(' ');
}
