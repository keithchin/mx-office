---
title: Workers and rankings
description: The Workers tab - every agent graded A to F, the criteria behind the grade, specialist duties for team roles, the leaderboard and grouping.
weight: 6
---

The **🤖 Workers** tab shows every agent on the floor, or on all floors, ranked by a grade from **A** to **F**.

![Worker rankings](../images/workers-ranking.png)

## The toolbar

| Control | Choices |
|---|---|
| Scope | **This floor** or **All floors** |
| Group by | No groups · **By model** · **By role** |
| Sort | Needs you first · Rank · Name · Recent |
| ☐ Gone home | Also show workers who went home |

Your choices are kept in this browser.

## What you see

- A **podium** with the top three (🥇🥈🥉).
- **Full ranking**: rank, grade, worker, role, model, floor (with All floors), score, trend and tasks.
- With grouping: a card per model or role with its average grade and its spread of A–F.
- Each worker's **card**: its grade, its live card (open the terminal, ✍️ prompt it), its rank on the floor, for its model and for its role, the trend (▲▼) and how sure the grade is.
- **Details ▾**: highlights (🏆), the standard criteria and, for team roles, their duties.

## How the grade is worked out

Grades: **A** ≥ 90, **B** ≥ 80, **C** ≥ 70, **D** ≥ 60, otherwise **F**.

**Standard criteria**, for every worker:

| Criterion | Weight |
|---|---|
| Model benchmark | 25% |
| Delivery | 30% |
| Autonomy | 25% |
| Token efficiency | 20% |

**Specialist duties** count for 30% of a team role's score:

| Role | Duties |
|---|---|
| 🧭 Project Coordinator | Plan upkeep · Standups on time · Escalation summaries · Leads unblocked · Questions batched |
| Every Lead | Review turnaround · Review quality · Escalation precision · Team throughput · Journal & handoffs |
| 🎨 Lead Designer | + Design reviews |
| 🛠️ Lead Developer | + Build health |
| 🧪 Lead Tester | + Tests & bugs caught |
| 📈 Chief Analyst | + Decisions & gates |

A Lead's **review turnaround** and **review quality** come from the reviews it records for its subagents (`office-workers subagent review`). See [Subagents](../automation/subagents.md).

**ℹ️ How workers are graded** on the tab explains this in the app too.

> [!NOTE]
> Highlights can be written by an LLM. Set `AGENT_OFFICE_RANKING_LLM=off` to keep them to the office's own records. See [Environment variables](../reference/environment-variables.md).
