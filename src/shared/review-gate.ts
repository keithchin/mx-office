// The review gate's rules (server/review-gate/, docs/site/using-the-office/review-gate.md): what counts as
// a review of an agent's pull request, and the words the Playbook gives the Leads for it. A review is a PR
// comment that starts `Review: <name> (<role>)` and lists the checks actually run (each command with its
// result) and the files read; it counts only when it was made before the merge by someone other than the
// PR's opener. GitHub can't tell agents apart (they all use the office's token, so its account opens and
// merges every PR), which is why the reviewer is named in the comment and the opener in the PR body.
// Deterministic, no LLM. Pure: the server, the Playbook and the tests import it.

/** A merge sooner than this after the PR opened is flagged, unless the person approved it. */
export const REVIEW_MIN_MINUTES = 10;

/** The domain of the agents' commit addresses: never a real mailbox, never a person's. */
export const AGENT_EMAIL_DOMAIN = 'agents.mx-office.local';

/** The first line of a PR body the agent opened: GitHub shows the token's account, this names the agent. */
export const openedByLine = (name: string, role: string) => `Opened by ${name} (${role}) via Mx Office`;

/** The agent an "Opened by … via Mx Office" line names, if the body has one. */
export function openerFromBody(body: string | undefined): string | undefined {
  const m = /^\s*_?Opened by (.+?) \([^)\n]*\) via Mx Office/im.exec(body ?? '');
  return m?.[1].trim() || undefined;
}

/** The agent a commit author written by the office names ("Sophie (Mx Office Lead Developer)"). */
export function agentFromAuthor(author: string | undefined): string | undefined {
  const m = /^(.+?) \(Mx Office\b[^)]*\)$/.exec((author ?? '').trim());
  return m?.[1].trim() || undefined;
}

export interface ParsedReview {
  reviewer: string;
  role?: string;
  /** Each check run with its result ("npm test → 42 passed"). */
  checks: string[];
  files: string[];
}

const HEADER = /^([A-Za-z][A-Za-z ]{1,24}):\s*(.*)$/;
const ITEM = /^\s*(?:[-*•]|\d+[.)])\s+(.*\S)\s*$/;
/** A check names what ran and what came of it: "cmd → result", "cmd -> result", "cmd: result", "cmd — result". */
const RESULT = /\S.*?(?:→|->|=>|:\s|\s—\s|\s–\s)\s*\S/;

/** A `Review:` comment's reviewer, checks and files, or undefined when it doesn't start with `Review:`. */
export function parseReview(body: string | undefined): ParsedReview | undefined {
  const lines = (body ?? '').replace(/\r\n?/g, '\n').split('\n');
  const first = lines.findIndex((l) => l.trim());
  if (first < 0) return undefined;
  const head = /^\s*\**Review\**:\s*(.*)$/i.exec(lines[first]);
  if (!head) return undefined;
  const who = /^\s*(.+?)\s*(?:\(([^)]*)\))?\s*(?:[—–-].*)?$/.exec(head[1]);
  const reviewer = (who?.[1] ?? '').replace(/^by\s+/i, '').replace(/[*_`]/g, '').trim();
  const out: ParsedReview = { reviewer, ...(who?.[2] ? { role: who[2].trim() } : {}), checks: [], files: [] };
  let into: string[] | undefined;
  for (const raw of lines.slice(first + 1)) {
    const line = raw.replace(/[*_`]{2,}/g, '').trimEnd();
    const h = HEADER.exec(line.trim());
    const item = ITEM.exec(line);
    if (h && !item) {
      const name = h[1].trim().toLowerCase();
      into = /^checks?( run)?$/.test(name) ? out.checks : /^files?( read)?$/.test(name) ? out.files : undefined;
      if (into && h[2].trim()) into.push(...h[2].split(/;\s*/).map((s) => s.trim()).filter(Boolean));
      continue;
    }
    if (into && item) into.push(item[1].trim());
    else if (!line.trim()) continue;
    else into = undefined;
  }
  out.checks = out.checks.filter((c) => RESULT.test(c));
  out.files = out.files.filter((f) => /\S/.test(f) && !/^(none|n\/a|-)$/i.test(f));
  return out;
}

/** Whether a parsed review lists what the rule asks: a reviewer, at least one check with its result, at least one file read. */
export const reviewComplete = (r: ParsedReview | undefined): boolean => !!r && !!r.reviewer && r.checks.length > 0 && r.files.length > 0;

/** A PR or commit title that says it was reviewed: "(reviewed)", "(reviewed, internal)", "[reviewed]". */
export const claimsReviewed = (title: string | undefined) => /[([]\s*reviewed\b/i.test(title ?? '');

/** The lint baseline the toolkit's lint gate ratchets against (project-bin/lint-gate.sh --update-baseline). */
export const LINT_BASELINE = '.claude/lint-baseline.json';
/** Where the toolkit records waivers: gate-check --waive writes the build log line and PROJECT.md's register line. */
export const BUILD_LOG = 'docs/BUILD-LOG.md';
export const REGISTER = 'PROJECT.md';

/** The Playbook's review rule, for every role that opens or merges pull requests. */
export function reviewRule(name: string, role: string, minutes = REVIEW_MIN_MINUTES): string {
  return [
    `- **Pull requests need a review by another Lead.** Start every pull request description with \`${openedByLine(name, role)}\`: GitHub shows the office's account as the opener and merger of every pull request, so that line is the only record that you opened it.`,
    `  A pull request is merged only after another Lead (or the Project Coordinator) reviewed it and recorded that on the pull request as a comment (\`gh pr comment <n> --body-file <file>\`) that starts \`Review: <their name> (<their role>)\`, then a \`Checks:\` list (each command actually run, with its result: \`- npm test → 42 passed\`), a \`Files read:\` list (each file read), a \`Head: <sha>\` line naming the exact commit reviewed (\`git rev-parse HEAD\` on the branch) and a \`Verdict: approve\` (or \`Verdict: changes requested\`) line. A skim is not a review. A review counts only for the commit it names: a later commit needs a new review, and the office's Merge button refuses a head without one. Never merge on your own review, never within ${minutes} minutes of opening unless the Project Manager approved it, and never write "(reviewed)" in a commit or pull request title without that comment. On a team with no other Lead, the Project Manager reviews: they record it in the office's pull-request window (Reviewed and approved this revision), so tell them it is ready and don't merge before it counts.`,
    `  Resetting the lint baseline (\`${LINT_BASELINE}\`) or recording a waiver (\`gate-check --waive\`, a waived fidelity or lint check) needs the Project Manager's decision: cite it in that commit (\`Decided per ESC-<id> rev <n>\`). The office checks every merged pull request, every commit on the default branch and every baseline reset or waiver against this, and shows the Project Manager what skipped it.`,
  ].join('\n');
}
