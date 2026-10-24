---
title: Review gate
description: Who really did what in a project's git history - each agent commits under its own name - how the office's merge gate holds its own Merge button until the pull request's current head has an independent review, how you record a review yourself, and how Needs you shows what merged without a real review, what reached main without a pull request, and lint baseline resets or waivers without your decision.
weight: 3.42
---

The **review gate** keeps the project's history honest: it should show who really did what, and "reviewed" should mean reviewed. On a real project every commit read as the Project Manager's (the agents used his git identity and his GitHub sign-in), four pull requests were opened and merged by the agents themselves 12 to 25 seconds apart with no review and no checks, a handover was committed "(reviewed)" after a one-second skim, and the lint baseline was reset eight times in a day "by my call". Branch protection wasn't available on that private free-plan repository, so nothing on GitHub stopped any of it.

The office does four things: it makes each agent's work carry the agent's name; it binds every review to the exact commit it reviewed; its own **Merge** button refuses a pull request whose current head has no review that counts (the [merge gate](#the-merge-gate)); and it shows you in [Needs you](command-center.md#needs-you) whatever skipped the rule, with the evidence. It uses no AI: every check is a plain rule over what the office reads.

> [!IMPORTANT]
> **What is enforced, and by whom.** The office enforces the gate on **its own** Merge button (the pull-request window). An agent that runs `gh pr merge` itself, or anyone merging on GitHub, goes around it: all agents share one GitHub account, and the office can't take a command away from an agent. The office posts its verdict on each pull request's head as the **`mx-office/review`** commit status, but it posts it with the agents' GitHub token, so any agent could post a passing status too: requiring that status on GitHub alone is **weak**. What holds is a **human review required on GitHub** (required approvals or a CODEOWNERS review), once you have checked its bypass paths. A person sets that up on GitHub: see [Branch protection](../integrations/branch-protection.md). The PR window and the 🔐 Security tab show each project's verdict, **Enforced**, **Weak** or **None**, so you know how much holds outside the office.

## Each agent commits as itself

An agent's commits are authored as **`<Name> (Mx Office <role>)`**, for example *Sophie (Mx Office Lead Developer)*, with an address of its own that is no real mailbox: `<profile id>@agents.mx-office.local` for a team member with an [agent profile](agents.md), the role's id otherwise, `worker-<id>@agents.mx-office.local` for a worker hired by hand. The **committer** is the office: the commit identity set in [Connections](../administration/connections.md#git--gh), or *Mx Office* when none is set. Never the person's name, unless the person commits (a shell worker is a person typing, and keeps their own identity).

The office sets this in each agent worker's environment (`GIT_AUTHOR_NAME`, `GIT_AUTHOR_EMAIL`, `GIT_COMMITTER_NAME`, `GIT_COMMITTER_EMAIL`), so it applies to every git command the agent runs, whatever git's own settings say, from a hire's very first launch.

The author identity is only an environment setting: an agent can change it for its own commits, so it records what the office set up, not proof of who wrote a commit.

**What GitHub still shows.** GitHub names the account a pull request was opened and merged with, and agents have no GitHub accounts of their own: they use the office's agents' token (or, in an office with accounts, the GitHub sign-in of the person who hired them). So GitHub shows that one account (for example *pat-office*) as the opener and merger of every agent's pull request, and can't show which agent merged it or that anyone approved. That's why each agent starts its pull request description with **`Opened by <Name> (<role>) via Mx Office`**, and why reviews are recorded as comments that name the reviewer (below). A GitHub merge commit is authored by that account too.

## The rule in the Playbooks

Every Lead's (and the Project Coordinator's) Playbook says:

- Start every pull request description with `Opened by <Name> (<role>) via Mx Office`.
- A pull request is merged only after **another** Lead (or the Project Coordinator) reviewed it and recorded that on the pull request as a comment that starts `Review: <name> (<role>)`, then a `Checks:` list (each command actually run, with its result), a `Files read:` list, a `Head:` line naming the exact commit reviewed, and a `Verdict:` line:

  ```text
  Review: Sophie (Lead Developer)
  Head: 1a2b3c4
  Checks:
  - npm test → 42 passed
  - mxcli check -p App.mpr → 0 errors
  Files read:
  - docs/client/handover.md
  - docs/team/analysis.md
  Verdict: approve
  ```

  `Verdict:` takes `approve`, `changes requested` or `comment`. A review counts only for the commit it names: any later commit needs a new review.

- No merge on your own review, none within **10 minutes** of opening unless you approved it, and no "(reviewed)" in a commit or pull request title without that comment. On a team with no other Lead, you review: the agent tells you the pull request is ready and waits for your review in the office.
- Resetting the lint baseline (`.claude/lint-baseline.json`) or recording a waiver needs your decision, cited in that commit (`Decided per ESC-<id> rev <n>`).

## The merge gate

### Reviews are bound to a revision

Every review the office knows about becomes a **review record**: the pull request, the **head commit it reviewed**, the **verdict** (approve, changes requested, comment), **who** reviewed it, when, and where it came from. Records are kept per project in `<data>/merge-gate/<project>.jsonl`, append only.

| Source | Reviewer | Commit it is bound to |
|---|---|---|
| A complete `Review:` comment naming an agent of the project | The agent named in it | Its `Head:` line; without one, the branch's head when the comment was posted (shown as *commit inferred from its time*) |
| A complete `Review:` comment from another GitHub account | That account (usually a person) | The same |
| A GitHub review (Approve, Request changes) from another account | That account | The commit GitHub recorded for the review |
| A review you record in the office | You, as signed in to the office | The head you saw when you recorded it |

`Review:` comments posted from 22 October 2026 on need a `Verdict:` line; without one they are a comment, not an approval. Older ones keep the old rule (a complete Review comment is an approval).

A review counts when:

- it **approves exactly the current head**. A new commit makes it **stale**: the PR window says *Stale: reviewed by Sophie at 1a2b3c4, changed since review: 2 commits* (or that the reviewed commit is no longer on the branch, after a force push);
- its reviewer is **independent**: not an author of the pull request's commits. The authors are the opener (the `Opened by … via Mx Office` line, else whoever works on the branch) and every agent or person named as a commit author;
- no independent reviewer's **last word on that head asks for changes**. *Changes requested* blocks until the same reviewer approves, or a new commit (which needs a new review anyway).

**Identity comes from the office, not GitHub.** All agents share one GitHub account, so the agent a `Review:` comment names is taken at its word: an agent could post a comment in another agent's name. The office can show which agent the comment names and refuse the author, nothing more. A review you record in the office is tied to your office sign-in, with your password typed again.

### Your review, from the PR window

Each pull request's window has a **🛡️ Review gate** panel above the conversation:

- the review status of the **current head**: *Reviewed ✓ by Sophie (Lead Developer) at 1a2b3c4*, *Changes requested by …*, *Stale: … changed since review: N commits*, or *Not reviewed yet*;
- whether the office's Merge would go ahead, and if not, why;
- whether the base branch is protected and requires `mx-office/review`, and the verdict: **Enforced** (a human review is required on GitHub), **Weak** (the status is required, but any holder of the agents' token can post it) or **None** (see [Branch protection](../integrations/branch-protection.md));
- **✅ Reviewed and approved this revision (1a2b3c4)** and **✋ Request changes**, which record your review of exactly that commit. You type your password again to sign it, and a request for changes needs a note. If the branch moved on while you looked, the office refuses and asks you to look at the new commits. If you authored commits on the pull request, it refuses too;
- the history: every review recorded for the pull request, overrides, and the reviews that don't count with the reason.

On a merged pull request whose merged revision has no counting review, the button reads **Reviewed and approved the merged revision**: a review after the fact clears the task's *unreviewed* mark (below).

On a **Solo** team (or any team with one agent hired), no other agent can review, so you are the reviewer. Needs you shows **PR #12 waits for your review of 1a2b3c4** for each open pull request whose head has no counting review (and whose checks aren't failing). It goes away once you review it, and a new head brings it back. On teams with other Leads, waiting for an agent's review is not your job, and Needs you stays quiet.

### The office's Merge button

**🔀 Merge…** in the PR window asks the gate first. It merges only when:

- an independent review approved the **current head**, with no request for changes standing on it, and
- the pull request's checks aren't failing (and aren't still running, unless you picked *Merge automatically once the requirements pass*). The checks are GitHub's check rollup, the same the board shows, without the office's own `mx-office/review` status.

Otherwise the merge dialog shows the reason and the Merge button stays disabled; if something changed in between, the office refuses the merge itself with the reason (*Not merged: No review counts for the head 1a2b3c4 yet…*). Every refusal is in the [Audit log](audit-log.md) as `pr.gate.refused`. If the office can't read the pull request from GitHub, it doesn't merge.

**An admin's override.** In the merge dialog an admin can choose **⚠️ Override…**, type why (10 characters or more) and their password. The override covers that head only, for 30 minutes, and only the office's own Merge button. It is audited as `pr.gate.override` (a warning), and the merge that uses it as `pr.gate.overriddenMerge`. It doesn't change the `mx-office/review` status, so a branch that requires it still refuses the merge on GitHub.

### The mx-office/review status

On the head of each open pull request it looks at, the office posts the commit status **`mx-office/review`**: success with a counting approval, pending without one (or when stale), failure when changes are requested. It looks when you open the PR window and when the board's pull-request list changes: only the pull requests whose head or update time moved, a few per look. A status is posted once per head and verdict; if GitHub refuses (the token can't write statuses), the project's posts wait an hour. It is posted with the agents' token, so it records the office's verdict but proves nothing on its own: an agent with the same token can post the same status. Require a human review on GitHub as well: [Branch protection](../integrations/branch-protection.md).

## What it flags

Each is an info card tagged **Review gate** (🚦) in Needs you, shown and not counted, with **Ask &lt;lead&gt; about it** (a message to whoever covers Management, after their current turn) and **Hide**.

| Card | When |
|---|---|
| *PR #5 by Katherine merged 12 s after opening, without a review by another lead* | An agent's pull request (one from an office worktree branch, or naming its agent) merged in the last 7 days with any of: no qualifying review of the merged head made before the merge by another agent (or recorded by the merge gate for that head, yours included); reviewed only by its own opener; merged within 10 minutes of opening without an approval from another GitHub account; merged with failing or still-running checks; "(reviewed)" in its title or a commit title with no qualifying review. The card lists what GitHub recorded (opener and merger account), the commit authors, the titles that claim a review, and the reviews that don't count (another revision, no approving verdict). |
| *Commit 920c4e2 reached main without a pull request* | A commit on origin's default branch since the office last looked that is no pull request's merge commit and wasn't committed by GitHub's merge button. |
| *main was force-pushed: it moved from a1b2c3d to e4f5a6b, which doesn't contain it* | The default branch moved to a commit that doesn't contain where it was. |
| *Lint baseline reset 5 times and 14 waivers recorded in the last 7 days without your decision* | Commits on any branch that rewrite `.claude/lint-baseline.json`, add a `…-WAIVED` line to `docs/BUILD-LOG.md` or a `Waived …` line to `PROJECT.md` (what the toolkit's `gate-check --waive` writes), or say "waived" in their title, without citing a decision. One card lists them all. |

After the merge, a `Review:` comment counts when (`src/shared/review-gate.ts`, `src/server/review-gate/judge.ts`):

- its **first line starts `Review:`**, followed by a reviewer name;
- the reviewer is **any agent of the project** by name, **or** the comment came from a GitHub account other than the one that opened the pull request;
- the reviewer is **not the opener**;
- it lists **at least one `Checks:` item shaped like a result** and **at least one `Files read:` item**;
- its `Head:` line, when it has one, names the **merged head**, and its verdict is an **approval** (see the cut-off above);
- it was posted **at or before the merge**.

A review the merge gate counts for the merged head (an agent's, a GitHub approval, or yours from the PR window, also after the merge) counts as well.

### What it doesn't check

- **whether the checks listed really ran**: they are not compared with CI or with the [claims check](claims-check.md);
- **who merged it**: shown on the card, never judged;
- **roles**: any other agent of the project counts as independent, including one with the same role;
- **which agent really wrote a Review comment**: they all post from the same GitHub account (see above).

**Limits.** Only the 30 most recently merged pull requests, and of those only ones merged in the last 7 days, are judged after the merge. Per pull request, the first 20 comments and reviews that start `Review:` or `Approved` (or are a GitHub approval) are read, each up to 3000 characters.

**The task stays unreviewed until a review counts.** A task whose pull request merged without a review that counts reads **Integrated (unreviewed)** and is not counted as delivered or *Done (verified)*. The mark is **cleared** once a counting review of the merged revision exists (for example yours, recorded from the PR window after the merge), or when the pull request turns out to be closed without merging. The clearing is kept in the merge gate's records and in the Audit log (`pr.review.cleared`), with what the mark said. A merge that only came too fast, with a review that counts, shows its card but doesn't hold the task back.

## Where it reads from

The office remembers where the default branch was in `<data>/review-gate/<project>.json`, so it outlives a restart: the first look after the office starts compares with it and flags every commit that skipped a pull request while the office was down. A project's very first look has no earlier record: it says so, in one Needs-you card (*Direct-push check: no earlier record of main. Commits up to 1a2b3c4 weren't checked*) and on the 🔐 Security tab under **Direct-push check**, and the state stays until someone reconciles it there: **Check the last 50 commits** (anyone signed in; what it finds becomes the usual direct-push cards, older commits stay unchecked and the record says so) or, for an admin, **Accept 1a2b3c4 as the starting point** (nothing before it will be checked). Both are in the Audit log (`pushes.baseline.scan`, `pushes.baseline.accept`). A renamed default branch starts unchecked the same way. If the office no longer has the commit it last saw (history rewritten and cleaned up), it says it can't tell which commits skipped a pull request instead of quietly starting again. Pushes are read from the office's own copy of the project. The **push watch** keeps that copy current: a minute after the office starts, and then every 2 minutes for a project whose pull-request list isn't coming back from GitHub (every 10 minutes when it is), it asks GitHub for the default branch's head (`git ls-remote`, a few hundred bytes), fetches only when it moved, and looks. At most two projects a minute, one at a time; a project something else just fetched is skipped, and local-only projects are never asked.

The direct-push check is a check against **mistakes** (someone pushing to main by hand, a script that skipped the pull request). It isn't a security boundary against an agent acting on purpose: an agent runs as the office's user and could edit what the office keeps. Only branch protection on GitHub stops a push; see [Trust and authority](../architecture/trust-and-authority.md#what-holds-against-an-agent). Merged pull requests come from the board's existing pull-request poll (who merged them, their `Review:` and approval comments, and their commit titles and authors). The merge gate reads an open pull request's commits, comments, reviews and checks with `gh pr view` when you open its window, when you merge, and when its head or update time moves on the board's list; its records are in `<data>/merge-gate/<project>.jsonl`.

Related: a GitHub issue closed as completed no longer counts as delivering a task while that task's own pull request is still open or was closed without merging; the pull request decides.

Its sibling, the [claims check](claims-check.md), compares what agents *say* they did ("✅ applied", "PASS 35/0") with what git holds: a model change only on an unmerged branch, a committed result that shows failures, evidence only in a git-ignored folder.

## See also

- [Branch protection](../integrations/branch-protection.md)
- [Claims check](claims-check.md)
- Architecture: [Trust and authority](../architecture/trust-and-authority.md), [Proposals](../architecture/proposals.md)
