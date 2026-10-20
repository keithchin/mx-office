---
title: Review gate
description: Who really did what in a project's git history - each agent commits under its own name - and how the office tells you, through Needs you, when an agent's pull request merged without a real review, when something reached main without a pull request, and when a lint baseline was reset or a check waived without your decision.
weight: 3.42
---

The **review gate** keeps the project's history honest: it should show who really did what, and "reviewed" should mean reviewed. On a real project every commit read as the Project Manager's (the agents used his git identity and his GitHub sign-in), four pull requests were opened and merged by the agents themselves 12 to 25 seconds apart with no review and no checks, a handover was committed "(reviewed)" after a one-second skim, and the lint baseline was reset eight times in a day "by my call". Branch protection wasn't available on that private free-plan repository, so nothing on GitHub stopped any of it.

The office can't block anything on GitHub either. It does two things instead: it makes each agent's work carry the agent's name, and it shows you in [Needs you](command-center.md#needs-you) whatever skipped the rule, with the evidence. It uses no AI: every check is a plain rule over what the office already reads.

> [!IMPORTANT]
> **The review gate is a detector, not a gate.** It looks at pull requests **after** they merged. Nothing in the office stops a merge: an agent can run `gh pr merge` itself, and the **Merge** button in the office's pull-request window runs `gh pr merge` without asking the review gate anything. The review rule, the 10-minute wait and "merges need the Project Manager's approval" (at autonomy 1 to 3) are instructions in the agents' Playbooks and an item in Approvals, not controls. Only **branch protection** on GitHub (required reviews, required checks) can block a merge, and the office neither sets it up nor checks whether it is on.

## Each agent commits as itself

An agent's commits are authored as **`<Name> (Mx Office <role>)`**, for example *Sophie (Mx Office Lead Developer)*, with an address of its own that is no real mailbox: `<profile id>@agents.mx-office.local` for a team member with an [agent profile](agents.md), the role's id otherwise, `worker-<id>@agents.mx-office.local` for a worker hired by hand. The **committer** is the office: the commit identity set in [Connections](../administration/connections.md#git--gh), or *Mx Office* when none is set. Never the person's name, unless the person commits (a shell worker is a person typing, and keeps their own identity).

The office sets this in each agent worker's environment (`GIT_AUTHOR_NAME`, `GIT_AUTHOR_EMAIL`, `GIT_COMMITTER_NAME`, `GIT_COMMITTER_EMAIL`), so it applies to every git command the agent runs, whatever git's own settings say, from a hire's very first launch.

The author identity is only an environment setting: an agent can change it for its own commits, so it records what the office set up, not proof of who wrote a commit.

**What GitHub still shows.** GitHub names the account a pull request was opened and merged with, and agents have no GitHub accounts of their own: they use the office's agents' token (or, in an office with accounts, the GitHub sign-in of the person who hired them). So GitHub shows that one account (for example *pat-office*) as the opener and merger of every agent's pull request, and can't show which agent merged it or that anyone approved. That's why each agent starts its pull request description with **`Opened by <Name> (<role>) via Mx Office`**, and why reviews are recorded as comments that name the reviewer (below). A GitHub merge commit is authored by that account too.

## The rule in the Playbooks

Every Lead's (and the Project Coordinator's) Playbook says:

- Start every pull request description with `Opened by <Name> (<role>) via Mx Office`.
- A pull request is merged only after **another** Lead (or the Project Coordinator) reviewed it and recorded that on the pull request as a comment that starts `Review: <name> (<role>)`, then a `Checks:` list (each command actually run, with its result) and a `Files read:` list:

  ```text
  Review: Sophie (Lead Developer)
  Checks:
  - npm test → 42 passed
  - mxcli check -p App.mpr → 0 errors
  Files read:
  - docs/client/handover.md
  - docs/team/analysis.md
  ```

  A reviewer may add a verdict or remarks below, but the review gate doesn't read them (see [What it doesn't check](#what-it-doesnt-check)).

- No merge on your own review, none within **10 minutes** of opening unless you approved it, and no "(reviewed)" in a commit or pull request title without that comment. On a team with no other Lead, you review: the agent escalates it.
- Resetting the lint baseline (`.claude/lint-baseline.json`) or recording a waiver needs your decision, cited in that commit (`Decided per ESC-<id> rev <n>`).

## What it flags

Each is an info card tagged **Review gate** (🚦) in Needs you, shown and not counted, with **Ask &lt;lead&gt; about it** (a message to whoever covers Management, after their current turn) and **Hide**.

| Card | When |
|---|---|
| *PR #5 by Katherine merged 12 s after opening, without a review by another lead* | An agent's pull request (one from an office worktree branch, or naming its agent) merged in the last 7 days with any of: no qualifying `Review:` comment made before the merge by another agent; reviewed only by its own opener; merged within 10 minutes of opening without an approval from another GitHub account; merged with failing or still-running checks; "(reviewed)" in its title or a commit title with no qualifying review. The card lists what GitHub recorded (opener and merger account), the commit authors, and the titles that claim a review. |
| *Commit 920c4e2 reached main without a pull request* | A commit on origin's default branch since the office last looked that is no pull request's merge commit and wasn't committed by GitHub's merge button. |
| *main was force-pushed: it moved from a1b2c3d to e4f5a6b, which doesn't contain it* | The default branch moved to a commit that doesn't contain where it was. |
| *Lint baseline reset 5 times and 14 waivers recorded in the last 7 days without your decision* | Commits on any branch that rewrite `.claude/lint-baseline.json`, add a `…-WAIVED` line to `docs/BUILD-LOG.md` or a `Waived …` line to `PROJECT.md` (what the toolkit's `gate-check --waive` writes), or say "waived" in their title, without citing a decision. One card lists them all. |

A review **counts** when all of these hold (`src/shared/review-gate.ts`, `src/server/review-gate/judge.ts`):

- it is a comment or review on the pull request whose **first line starts `Review:`**, followed by a reviewer name;
- the reviewer is **any agent of the project** by name (a team member ever hired, or a worker on the project), **or** the comment came from a GitHub account other than the one that opened the pull request (usually a person; in an office with accounts, also an agent hired by someone else);
- the reviewer is **not the opener**, who is read from the `Opened by … via Mx Office` line, else from whoever works on the branch, else from an agent commit author;
- it lists **at least one `Checks:` item shaped like a result** (`command → result`, `command: result`, `command — result`) and **at least one `Files read:` item**;
- it was posted **at or before the merge** (`mergedAt`). A review added after the merge doesn't count.

### What it doesn't check

The rule is about the shape of a comment, so it is easy to satisfy. The gate never checks:

- **which commit was reviewed**: the reviewed revision is never compared with the merged one, and commits pushed after the review don't make it stale;
- **the verdict**: a `Verdict: reject` (or any other remark) still counts as a review;
- **GitHub's own review decision** (approved or changes requested): it is fetched, but not used;
- **independence of roles**: any other agent's name counts, including one on the same team or with the same role;
- **whether the checks listed really ran**: they are not compared with CI or with the [claims check](claims-check.md);
- **who merged it**: shown on the card, never judged.

**Limits.** Only the 30 most recently merged pull requests, and of those only ones merged in the last 7 days, are judged. Per pull request, the first 20 comments and reviews that start `Review:` or `Approved` (or are a GitHub approval) are read, each up to 3000 characters.

**The task stays unreviewed.** A task whose pull request merged without a review that counts reads **Integrated (unreviewed)** and is never counted as delivered or *Done (verified)*, whatever its checks say later (App Insights › Testing › Verification shows it so). That mark is **never cleared**, not even by a review posted afterwards. A merge that only came too fast, with a review that counts, shows its card but doesn't hold the task back.

### On a Solo team

On a team with no other Lead (a Solo team), the Playbook says the Project Manager reviews: the agent escalates each pull request to you. There is no review flow in the office for that. You would post the `Review:` comment yourself on GitHub, with its `Checks:` and `Files read:` lists. Whether it counts depends on the account it comes from (this is read from the code, **not tested**):

- **From the office's shared GitHub account** (the one the agents use, for example through the pull-request window in an office without accounts), under your own name: probably **not counted**. Your name isn't an agent's, and the account is the opener's.
- **From your own GitHub sign-in** (an office with accounts, signed in as yourself): it comes from another account, so it should count.

Expect a Solo project to show a *Review gate* card for most merged pull requests unless you review them this way.

## Where it reads from

The office remembers where the default branch was in `<data>/review-gate/<project>.json`; its first look only records that, so older history isn't flagged. Pushes are read from the office's own copy of the project (it never fetches for this), and pull requests from the board's existing pull-request poll (merged ones now also bring who merged them, their `Review:` and approval comments, and their commit titles and authors).

Related: a GitHub issue closed as completed no longer counts as delivering a task while that task's own pull request is still open or was closed without merging; the pull request decides.

Its sibling, the [claims check](claims-check.md), compares what agents *say* they did ("✅ applied", "PASS 35/0") with what git holds: a model change only on an unmerged branch, a committed result that shows failures, evidence only in a git-ignored folder.

## See also

- [Claims check](claims-check.md)
- Architecture: [Trust and authority](../architecture/trust-and-authority.md), [Proposals](../architecture/proposals.md) (proposed pre-merge signals and branch-protection checks; **not built**)
