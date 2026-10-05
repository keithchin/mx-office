---
title: Subagents
description: Each Lead's subagents - their track record and grade, when one underperforms, and warning, benching, swapping the model and reinstating, each through the Lead's gate.
weight: 3
---

A Lead's team members are **Claude Code subagents**, running inside the Lead's session. The office keeps a **track record** for each one.

## The track record

- **Runs** come from Claude Code's hooks (subagent start and stop) and the Agent tool's results. The last 50 are kept per subagent.
- Each run is **pending**, **accept**, **rework** or **failed**. The verdict comes from the Lead's review: `office-workers subagent review <name> --verdict accept|rework`.
- The **grade** is over the last 5 reviewed runs on its current model (at least 3 needed): accepts divided by reviewed runs, with half credit when the PR's CI failed. **A** ≥ 90, **B** ≥ 80, **C** ≥ 70, **D** ≥ 60, else **F**.
- It is **underperforming** (📉) below 70, or with 2 or more reworks or failures in that window. Its Lead is told once, when idle.

See them on the [Org chart](../using-the-office/org-chart.md), the [Team boards](../using-the-office/team-boards.md), or with `office-workers subagent list`.

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
