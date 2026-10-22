---
title: Branch protection
description: Make GitHub refuse any merge without a review the office counts, by requiring the office's mx-office/review status on the default branch. A person sets it up on GitHub; the office only reads whether it is on.
weight: 1.5
---

The office's [merge gate](../using-the-office/review-gate.md#the-merge-gate) holds back its own **Merge** button until the pull request's current head has a review that counts. It can't hold back an agent that runs `gh pr merge` itself, or anyone merging on GitHub. Only GitHub can, through **branch protection** (or a ruleset) that requires the office's status check.

## What the office posts

On the head commit of every open pull request it looks at, the office posts a commit status named **`mx-office/review`**:

| State | When |
|---|---|
| ✅ success | An independent review approved exactly this commit (*Reviewed ✓ by Sophie (Lead Developer) at 1a2b3c4*) |
| ⏳ pending | No review counts for this commit yet, or the reviewed commit isn't the head any more (*Stale: … changed since review: 2 commits*) |
| ❌ failure | An independent reviewer's last word on this commit asks for changes |

A new commit gets its own status, so a review never carries over to commits made after it. The status is posted with the office's agents' GitHub token (it needs permission to write commit statuses on the repository). When GitHub refuses it, the office waits an hour before trying again for that project, and the PR window says the status couldn't be posted.

The office leaves its own status out of a pull request's checks (the board's check icon, *Checks are still running*, test-run records): a review isn't a test.

## Require it on GitHub (a person, once per repository)

You need admin rights on the repository. The office never changes branch protection itself.

1. Let the office post the status once: open any pull request's window in the office (or wait for the board's next look). GitHub only offers a status check it has seen.
2. On GitHub, open the repository's **Settings › Branches** (or **Settings › Rules › Rulesets**).
3. Add a rule (or edit the existing one) for the default branch, for example `main`.
4. Turn on **Require status checks to pass before merging**, search for **`mx-office/review`**, and add it. Add your CI checks here too if you want GitHub to require them.
5. Turn on **Do not allow bypassing the above settings** (*Include administrators* on older pages) if the agents' token belongs to an admin: otherwise GitHub lets that account merge anyway, and every agent uses that account.
6. Save. Back in the office, the PR window shows **🔒 main is protected and requires mx-office/review** within ten minutes (it reads the protection at most every ten minutes).

Branch protection on private repositories needs a paid GitHub plan (Team or Enterprise for organizations, Pro for personal accounts). On a free private repository there is no way to make GitHub enforce the gate: it stays advisory outside the office.

## What the office shows

Under **🛡️ Review gate** in each pull request's window, one of:

| Shown | Means |
|---|---|
| 🔒 *main is protected and requires mx-office/review* | GitHub refuses a merge without a counting review, whoever merges |
| ⚠️ *main is protected, but doesn't require mx-office/review* | Agents can still merge unreviewed work with `gh`; the gate is advisory outside the office |
| ⚠️ *main isn't protected* | Only the office's own Merge button checks the gate |
| ❔ *Couldn't read main's protection* | The office's token can't see the branch (or GitHub said no); treat the gate as advisory |

The office reads `GET repos/<owner>/<repo>/branches/<branch>` (which any reader of the repository may call) and the branch's rulesets (`GET repos/<owner>/<repo>/rules/branches/<branch>`). It never writes either.

## An admin's override, and GitHub

An admin's [override](../using-the-office/review-gate.md#the-merge-gate) only lets the **office's** Merge button through. It doesn't change the `mx-office/review` status, so on a branch that requires it GitHub still refuses the merge. To ship something urgent on a protected branch, review it (you can record your own review in the office), or change the rule on GitHub, which GitHub records in the repository's audit log.

## See also

- [Review gate](../using-the-office/review-gate.md)
- [GitHub](github.md)
- [Trust and authority](../architecture/trust-and-authority.md)
