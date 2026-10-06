---
title: Models and costs
description: Choosing a model per role or task, what each model was good at in our runs, where cost shows up, and the daily cost cap.
weight: 7
---

## Picking a model

You choose the model:

- **per role**: in the hire window's dropdown, or with **🧠** on the member's card (from the next hire);
- **per task**: in the hire window when you start an issue, with its reasoning effort (low, medium, high, xhigh, max);
- **per subagent**: a Lead (or you) can swap a subagent's model. See [Subagents](../automation/subagents.md).

| Model | In our runs |
|---|---|
| **Sonnet 5.5** | The best value. The default for every role. |
| **Opus 5.5** | The highest quality. Good for architecture, discovery and hard bugs. |
| **Fable 5.1** | The newest; available in the hire dropdown. |
| **Haiku 4.5** | Cheap and quick, but struggled with Mendix work. Fine for the Data Analyst. |

The [Analysis](../using-the-office/model-analysis.md) tab and **Home → 📊 Statistics** show how each model actually does on your projects.

### Haiku runs in "accept edits" mode

Claude Code's *auto* permission mode isn't available for Haiku, so a Haiku worker would otherwise stop at a permission prompt for every file it writes. The office starts it with `--permission-mode acceptEdits`: file edits in its worktree go ahead without asking. Shell commands (`git`, `gh`, builds) still follow the project's own Claude Code permission settings, so it may still ask for those. The hire window says so under the model, and the Team tab's model picker lists it as *Haiku 4.5 (accept edits)*.

The office leaves it out when `--agent-args` already set a mode of their own (`--permission-mode …` or `--dangerously-skip-permissions`): set one there to override it for every worker. Which models this applies to is the `CLAUDE_NO_AUTO_MODE` table in `src/shared/providers.ts`.

## Where cost shows up

- Every worker card: **💵 cost** and tokens.
- The board's summary line, and the Command Center: **💰 $x today · $y all told on this floor**.
- **Home → 📊 Statistics**: spent today and all-time, per project.
- **The Firm**: an audit's estimate before you call it, its spend against the budget cap while it runs, and its cost in the report. Reviewers default to Fable 5.1 ($10 / $50 per million input / output tokens). See [The Firm](../using-the-office/the-firm.md#budget-and-time).

## The daily cost cap

In [Settings](../using-the-office/settings.md) you can set a **daily dollar cap for each autonomy level**. Only the cap for the floor's current level counts.

When the floor's spend for the day reaches it:

- hiring stops on that floor, with *This floor's $X daily team cap (autonomy level N) is spent — no new hires here until tomorrow*;
- **💸 Hiring is paused** shows in Needs you, and *Daily cost cap reached* in Approvals.

The day resets at midnight in the standup's time zone (Asia/Singapore by default). Workers already running keep running.

> [!NOTE]
> There is also an office-wide daily budget, `--budget` / `AGENT_OFFICE_BUDGET`, from the original Agent Office. It's separate from the team caps. See [Server CLI](../reference/server-cli.md).
