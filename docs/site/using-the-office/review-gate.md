---
title: Review gate
description: Who really did what in a project's git history - each agent commits under its own name - and how the office tells you, through Needs you, when an agent's pull request merged without a real review, when something reached main without a pull request, and when a lint baseline was reset or a check waived without your decision.
weight: 3.42
---

The **review gate** keeps the project's history honest: it should show who really did what, and "reviewed" should mean reviewed. On a real project every commit read as the Project Manager's (the agents used his git identity and his GitHub sign-in), four pull requests were opened and merged by the agents themselves 12 to 25 seconds apart with no review and no checks, a handover was committed "(reviewed)" after a one-second skim, and the lint baseline was reset eight times in a day "by my call". Branch protection wasn't available on that private free-plan repository, so nothing on GitHub stopped any of it.

The office can't block anything on GitHub either. It does two things instead: it makes each agent's work carry the agent's name, and it shows you in [Needs you](command-center.md#needs-you) whatever skipped the rule, with the evidence. It uses no AI: every check is a plain rule over what the office already reads.

## Each agent commits as itself

An agent's commits are authored as **`<Name> (Mx Office <role>)`**, for example *Sophie (Mx Office Lead Developer)*, with an address of its own that is no real mailbox: `<profile id>@agents.mx-office.local` for a team member with an [agent profile](agents.md), the role's id otherwise, `worker-<id>@agents.mx-office.local` for a worker hired by hand. The **committer** is the office: the commit identity set in [Connections](../administration/connections.md#git--gh), or *Mx Office* when none is set. Never the person's name, unless the person commits (a shell worker is a person typing, and keeps their own identity).

The office sets this in each agent worker's environment (`GIT_AUTHOR_NAME`, `GIT_AUTHOR_EMAIL`, `GIT_COMMITTER_NAME`, `GIT_COMMITTER_EMAIL`), so it applies to every git command the agent runs, whatever git's own settings say, from a hire's very first launch.

**What GitHub still shows.** GitHub names the account a pull request was opened and merged with, and the agents all use the office's agents' token: so GitHub shows that account (for example *keithchin*) as the opener and merger of every agent's pull request, and can't show which agent merged it or that anyone approved. That's why each agent starts its pull request description with **`Opened by <Name> (<role>) via Mx Office`**, and why reviews are recorded as comments that name the reviewer (below). A GitHub merge commit is authored by that account too.

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
  - docs/scg/handover.md
  - docs/team/analysis.md
  Verdict: approve
  ```

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

A review **counts** when it starts `Review:`, names an agent of the project (or comes from a GitHub account other than the one that opened the pull request) who isn't the opener, lists at least one check with its result and at least one file read, and was made before the merge. A review added after the merge doesn't count.

**The task stays unreviewed.** A task whose pull request merged without a review that counts reads **Integrated (unreviewed)** and is never counted as delivered or *Done (verified)*, whatever its checks say later (App Insights › Testing › Verification shows it so). A merge that only came too fast, with a review that counts, shows its card but doesn't hold the task back.

The office remembers where the default branch was in `<data>/review-gate/<project>.json`; its first look only records that, so older history isn't flagged. Pushes are read from the office's own copy of the project (it never fetches for this), and pull requests from the board's existing pull-request poll (merged ones now also bring who merged them, their `Review:` and approval comments, and their commit titles and authors).

Related: a GitHub issue closed as completed no longer counts as delivering a task while that task's own pull request is still open or was closed without merging; the pull request decides.
