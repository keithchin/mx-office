---
title: Board
description: The floor's Kanban - columns from Backlog to Done, starting and queueing work, team filter chips and hover previews.
weight: 4
---

The **🗂 Board** tab is the floor's Kanban: GitHub issues, queued tasks, working agents and pull requests in one view.

![The board](../images/board.png)

The line on top sums it up: *🤖 N working · 🙋 N need a human · 🔀 N in review · 💰 $x on this floor's agents*.

## Columns

| Column | What's in it |
|---|---|
| 📌 **Backlog** | Open issues nobody is on. Each card has **📋 Queue** and **▶ Start**. |
| 📋 **Queued** | Tasks waiting for the next free worker. |
| 🤖 **In progress** | Workers on a task. |
| 🙋 **Needs a human** | Workers asking a question or a permission, and escalations. |
| 🔀 **In review** | Open pull requests. The stripe shows their CI checks. |
| ✅ **Done** | The latest 12 merged or finished. |

## Starting work

- **Drag** a Backlog card to **In progress**: the hire window opens, pick the model and effort. Or drag it to **Queued**: the next free agent takes it.
- The card's **▶ Start** and **📋 Queue** do the same.
- **✨ New task** at the bottom gives any task to a new worker.

## Team filter

Under **Teams**: **All**, 🧭 Management, 🎨 Design, 🛠️ Development, 🧪 Testing, 📈 Analysis, ◌ Unassigned. Pick one or more. Each column shows its count per team, and each card shows its team tag. The choice is kept in this browser and in the address (`&teams=design,testing`).

## Hover previews

On a computer, hover a card for 300 ms to see a preview beside it:

- **Issues**: labels, opened, assignees, comments and the description.
- **Workers**: what it's doing now, model, tokens, cost, branch, PR, how long it's been waiting, and a **live terminal**.
- **Pull requests**: the agent, tokens, cost, author, changes, checks, review, branch, the issue it closes, and the **CI scorecard** with screenshots. See [CI pipeline](../integrations/ci-pipeline.md).
- **⤢ Open** opens it in full.

Admins can change a card's team in the preview (**Team ▼**). That relabels `team:` on GitHub, unless [dry run](settings.md) is on.

> [!TIP]
> Each column scrolls on its own, and keeps its place when the board redraws.
