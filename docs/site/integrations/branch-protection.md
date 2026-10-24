---
title: Branch protection
description: How much GitHub enforces the office's review. The mx-office/review status, why requiring it alone is weak, the human review that holds, and the verdict (Enforced, Weak, None) the office shows per project. A person sets it up on GitHub; the office only reads it.
weight: 1.5
---

The office's [merge gate](../using-the-office/review-gate.md#the-merge-gate) holds back its own **Merge** button until the pull request's current head has a review that counts. It can't hold back an agent that runs `gh pr merge` itself, or anyone merging on GitHub. Only GitHub can, through **branch protection** (or a ruleset).

> [!WARNING]
> The office posts `mx-office/review` with the **agents' GitHub token**, the same token every agent is given. So any agent can post a passing `mx-office/review` itself (`gh api …/statuses/<sha>`), and GitHub can't tell it from the office's. **Requiring the status alone is weak.** What holds is a **human review required on GitHub** (required approvals, or a CODEOWNERS review), and only once you have checked its bypass paths (below).

## What the office posts

On the head commit of every open pull request it looks at, the office posts a commit status named **`mx-office/review`**:

| State | When |
|---|---|
| ✅ success | An independent review approved exactly this commit (*Reviewed ✓ by Sophie (Lead Developer) at 1a2b3c4*) |
| ⏳ pending | No review counts for this commit yet, or the reviewed commit isn't the head any more (*Stale: … changed since review: 2 commits*) |
| ❌ failure | An independent reviewer's last word on this commit asks for changes |

A new commit gets its own status, so a review never carries over to commits made after it. The status is posted with the office's agents' GitHub token (it needs permission to write commit statuses on the repository), the same token every agent has. It records the office's verdict where GitHub shows checks; it doesn't prove the office posted it. When GitHub refuses it, the office waits an hour before trying again for that project, and the PR window says the status couldn't be posted.

The office leaves its own status out of a pull request's checks (the board's check icon, *Checks are still running*, test-run records): a review isn't a test.

## Require a human review (a person, once per repository)

This is what holds while the status is posted with the agents' token. You need admin rights on the repository; the office never changes branch protection itself.

1. On GitHub, open the repository's **Settings › Branches** (or **Settings › Rules › Rulesets**) and add or edit the rule for the default branch, for example `main`.
2. Turn on **Require a pull request before merging** with **Required approvals: 1** or more. Every agent opens pull requests as the one GitHub account they share, and GitHub doesn't let an author approve their own pull request, so the approval has to come from another account: a person's.
3. Optionally add a `CODEOWNERS` file naming the people who must review, and turn on **Require review from Code Owners**.
4. Turn on **Dismiss stale pull request approvals when new commits are pushed**, so an approval doesn't carry over to later commits (the office's own review never does).
5. Turn on **Do not allow bypassing the above settings** (*Include administrators* on older pages).
6. Save. Within ten minutes the PR window and the 🔐 Security tab show the verdict **Enforced** (the office reads the protection at most every ten minutes).

**Check the bypass paths before you count on it.** The office shows *Enforced* as soon as GitHub reports a required review, but it can't see everything that weakens one. A human-review requirement counts only once you have checked on GitHub:

- **who can bypass**: repository admins (while bypassing is allowed), a ruleset's bypass list, and whether the agents' token belongs to an admin account (then it can merge anyway, unless bypassing is off);
- **who can dismiss reviews** (*Restrict who can dismiss pull request reviews*);
- **CODEOWNERS coverage**: the file's patterns cover the app's files (the model, `javasource/`, `javascriptsource/`, the theme), and the owners are people, not the agents' account;
- **who can change the rule**: anyone with admin rights on the repository. The agents' token should have no Administration permission (the token 🔌 Connections suggests has none);
- **where the reviewers sign in**: a reviewer's own GitHub sign-in (gh, Git Credential Manager, a browser profile) on the office's machine is readable by the agents, who run as the same user, so they could approve as that person. Review from another machine or account.

The office's own checks (its Merge button's gate, the review status, Needs you) protect against **mistakes**. A required human review on GitHub, with the paths above checked, is the only part that holds against an agent trying to get around it.

Branch protection on private repositories needs a paid GitHub plan (Team or Enterprise for organizations, Pro for personal accounts). On a free private repository there is no way to make GitHub enforce a review: it stays advisory outside the office.

## Require the status too (optional)

Requiring `mx-office/review` as well puts the office's verdict in GitHub's merge box and blocks a merge while the office says *changes requested* or *not reviewed*. On its own it proves nothing (see the warning above).

1. Let the office post the status once: open any pull request's window in the office (or wait for the board's next look). GitHub only offers a status check it has seen.
2. In the same rule, turn on **Require status checks to pass before merging**, search for **`mx-office/review`**, and add it. Add your CI checks here too if you want GitHub to require them.
3. Save. The PR window shows **🔒 main is protected and requires mx-office/review**, with the verdict *Weak* until a human review is required too.

## What the office shows

Under **🛡️ Review gate** in each pull request's window, one of:

| Shown | Means |
|---|---|
| 🔒 *main is protected and requires mx-office/review* | GitHub refuses a merge while the status isn't success, but the office posts it with the agents' token, so an agent can post a passing one too. On its own this is **Weak** |
| ⚠️ *main is protected, but doesn't require mx-office/review* | Agents can still merge unreviewed work with `gh`, unless a human review is required |
| ⚠️ *main isn't protected* | Only the office's own Merge button checks the gate |
| ❔ *Couldn't read main's protection* | The office's token can't see the branch (or GitHub said no); treat the gate as advisory |

And below it the **verdict**, also on the project's 🔐 Security tab (*Review enforcement on GitHub*):

| Verdict | Means |
|---|---|
| **Enforced** | GitHub requires a human review on the branch (approvals or a code owner's review), or requires `mx-office/review` from one GitHub App only. It counts only once you have checked the bypass paths above; an App restriction holds only while that App's private key is out of the agents' reach |
| **Weak** | `mx-office/review` is required, but the required status can be posted by any holder of the agents' token |
| **None** | Neither the status nor a human review is required: only the office's own Merge button checks the review |
| **Unknown** | The office couldn't read the protection |

While a project's verdict isn't *Enforced*, Needs you shows one note for it (*The review status on main can be posted by any agent*). It is one card per project, **Hide** keeps it hidden, and it goes away once the branch reads *Enforced*.

The office reads `GET repos/<owner>/<repo>/branches/<branch>` (which any reader of the repository may call), the branch's rulesets (`GET repos/<owner>/<repo>/rules/branches/<branch>`, which include a ruleset's required approvals and whether a required check is restricted to an App) and classic protection's review rule (`GET repos/<owner>/<repo>/branches/<branch>/protection/required_pull_request_reviews`, which needs Administration read: without it the office says it couldn't tell whether approvals are required). It never writes any of them.

## An admin's override, and GitHub

An admin's [override](../using-the-office/review-gate.md#the-merge-gate) only lets the **office's** Merge button through. It doesn't change the `mx-office/review` status or GitHub's required reviews, so on a branch that requires them GitHub still refuses the merge. To ship something urgent on a protected branch, review it on GitHub, or change the rule on GitHub, which GitHub records in the repository's audit log.

## Why there's no office-only identity for the status (yet)

Posting `mx-office/review` from an identity agents don't hold (a GitHub App, or a separate account's token) sounds like the fix, but on one machine it isn't one. Agents run as the same operating-system user as the office, so they can read its data folder: the 🔌 Connections store (Windows DPAPI and the macOS Keychain protect against other users, not against the same user's processes), the session secret in `config.json`, and they can call the office's local endpoints. A second credential kept there is one more secret an agent can read, or use through the office. It becomes a real boundary only when the office and its secrets run as a different operating-system user, or on another machine, from the agents. Until then, the human review above is what holds. See [Trust and authority](../architecture/trust-and-authority.md#what-holds-against-an-agent).

## See also

- [Review gate](../using-the-office/review-gate.md)
- [GitHub](github.md)
- [Trust and authority](../architecture/trust-and-authority.md)
