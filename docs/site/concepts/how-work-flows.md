---
title: How work flows
description: From a GitHub issue to a merged pull request and the live app - and where the Project Manager comes in.
weight: 4
---

```text
 GitHub issue ──▶ Backlog ──drag──▶ Queued / In progress ──▶ agent in its worktree
                                                                 │  (mxcli: MDL → model)
   Live app ◀── merge ◀── 🔀 In review: PR + CI scorecard ◀──────┘
 (restarts on new main)          ▲
                                 └── 🙋 Needs a human: questions, permissions, escalations
```

## 1. Work is a GitHub issue

Every piece of work starts as an issue in the project's repository. It lands in **📌 Backlog**. Each card carries a **team tag**, from its `team:` label: `team:design`, `team:development`, `team:testing`, `team:analysis` or `team:management`. Jeff · Router can suggest or set the team of an unlabelled issue. See [Jeff · Router](../automation/jeff-router.md).

## 2. Someone starts it

- **You** drag it to **🤖 In progress** (the hire window opens: pick the model) or to **📋 Queued** (the next free agent takes it).
- **The Leads** pick up their team's work, and dispatch subagents to it.
- **The Project Coordinator** turns plans and approved standup proposals into issues.

## 3. The agent works in its own worktree

It drafts **MDL** scripts, checks them with `mxcli check`, and (for the Lead Developer only) applies them to the Mendix model with `mxcli exec`. It writes tests, runs them, and opens a **pull request**. See [mxcli](../integrations/mxcli.md).

## 4. Its Lead reviews

When a subagent finishes, its Lead reviews the result, records the verdict, and **continues, sends it back, or escalates**. See [The review loop](../teams-and-agents/review-loop.md).

## 5. CI checks the pull request

Every PR runs the **pr-checks** workflow: Studio Pro `mx check`, `mxcli lint`, a best-practice score, unit tests and Playwright UI tests, then posts one **scorecard** comment. You see it when you hover the PR card. See [CI pipeline](../integrations/ci-pipeline.md).

## 6. Merge

You, or the Lead (depending on the [autonomy level](../teams-and-agents/autonomy.md)), merge. The Playbooks ask for a review by another agent first, but **nothing in the office blocks a merge**: the [review gate](../using-the-office/review-gate.md) looks after the merge and flags a PR merged without a `Review:` comment of the right shape in Needs you. Use GitHub's branch protection if you need a hard stop.

When the **🌐 Live app** is running, it updates itself to the new `main` within about a minute (the app is down while it rebuilds). A stopped live app stays as it is until someone starts it.

Merging doesn't make a task *delivered*: it's *integrated*. It counts as delivered once it's *verified*, its required checks passed on the merge commit, and the office judges that only while the Testing switch **Judge merged tasks against checks** is on (off by default; see [Testing](../using-the-office/testing.md#verification)).

## Where you come in

Anything that needs a human shows up in three places:

- **🙋 Needs a human** on the board;
- the **🚨 Needs you** strip and **🚩 Escalations** on the Command Center;
- **✅ Approvals**.

How often that happens depends on the autonomy level. Whatever the level, you have the final say, and anything critical always reaches you.
