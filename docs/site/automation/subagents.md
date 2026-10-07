---
title: Subagents
description: Each Lead's subagents - their track record and grade, when one underperforms, and warning, benching, swapping the model and reinstating, each through the Lead's gate.
weight: 3
---

A Lead's team members are **Claude Code subagents**, running inside the Lead's session. The office keeps a **track record** for each one.

## Names

Each subagent (one per Lead and subagent type) gets a person's first name the first time the office sees it, like the Leads have: *Nia · Tester (Hedy's subagent)*. The name is kept in the floor's roster file and never changes by itself; no two on a floor share one, Leads included. A roster from before names gets them the next time the office starts, the same names every time. The name shows on the Workers tab, in the 2D view and the home page's Overview, in the Team chatter and the Team phone, in the activity and approvals, and on the Budget tab. Each Lead's Playbook names its subagents (*Nia, your Tester*), so the Lead calls them by name; it still dispatches each by its type, so `.claude/agents/<type>.md` and `office-workers subagent … <type>` are unchanged. The Project Manager can give one another name with **✏️ Rename** on its detail or the Org chart (recorded in the audit log as `subagent.rename`).

## The track record

- **Runs** come from Claude Code's hooks (subagent start and stop) and the Agent tool's results, and from the Lead's transcript for a run no hook said had ended (a background run's notification). The last 50 are kept per subagent.
- Each run is **pending** (unreviewed), **accept**, **rework** or **failed**. The verdict comes from the Lead's review: `office-workers subagent review <name> --verdict accept|rework`, which lands on its newest unreviewed run. Unreviewed runs count as runs but not toward the grade; cards say how many there are.
- The **grade** is over the last 5 reviewed runs on its current model (at least 3 needed): accepts divided by reviewed runs, with half credit when the PR's CI failed. **A** ≥ 90, **B** ≥ 80, **C** ≥ 70, **D** ≥ 60, else **F**.
- It is **underperforming** (📉) below 70, or with 2 or more reworks or failures in that window. Its Lead is told once, when idle.

See them on the [Org chart](../using-the-office/org-chart.md), the [Team boards](../using-the-office/team-boards.md), as workers of their own on the [Workers tab](../using-the-office/workers.md#subagents) and in the [2D view](../using-the-office/2d-view.md), or with `office-workers subagent list`.

## At work now

The office also follows each run live, from the moment the Lead's Agent call goes out until it ends:

- **From the hooks**: the Agent tool's PreToolUse (the subagent, its task, its model) and PostToolUse (its answer, or, for a background run, its launch with Claude Code's agent id), and SubagentStart / SubagentStop. Several runs of the same subagent at once are each their own.
- **From the Lead's transcript**, read every 10 seconds, for what no hook says: a background run finishing (its `<task-notification>`), or anything that happened while the office was down. The same run from both is counted once.
- A floor keeps its **last 50 runs** in its roster file, each linked to the run record its Lead reviews, so a card shows the verdict. A run with no word of it for 6 hours is marked lost.

## Actions

| Action | Does |
|---|---|
| **⚠️ Warn** | Adds a dated warning to its definition `.claude/agents/<name>.md`. |
| **🪑 Bench** | Moves the definition to `.claude/agents.benched/` and blocks the Lead from calling it. It comes back after the **cool-down** (24 hours by default; 0 = only by hand). |
| **🔁 Swap model** | Changes its model: haiku, sonnet, opus, or back to the Lead's. |
| **✅ Reinstate** | Undoes a bench. Warnings stay. |

**Who can do them:**

- **A Lead**, with `office-workers subagent warn|bench|swap-model|reinstate`, each through its gate for that skill (ask, propose, tell or FYI, by autonomy level). See [Skills and gates](skills.md).
- **You**, from the Org chart's buttons, with no gate.
- **The office**, which reinstates a benched subagent when its cool-down ends (checked every minute).

A Lead whose subagent was changed by someone else is told between turns.

> [!TIP]
> A subagent graded D or F on Haiku often does fine on Sonnet. Try **🔁 Swap model** before benching it.
