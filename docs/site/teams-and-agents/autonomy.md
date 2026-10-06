---
title: Autonomy levels
description: The four autonomy levels - what each one escalates to you, what needs your approval, and what always reaches you whatever the level.
weight: 2
---

The **autonomy level** decides how often the agents on a floor need you. Set it per floor in [Settings](../using-the-office/settings.md). The default is **2 Guided**.

## The levels

| Level | Leads escalate to you… | Needs your approval | Revision rounds before escalating | Quietest urgency that still alerts you |
|---|---|---|---|---|
| **1 Directive** | every outcome that changes plan, scope, design or architecture, revisions used up, anything blocked, milestones, repeated failures, budget risk; and they ask before every next step | every kind of decision | 2 | info |
| **2 Guided** *(default)* | scope, design or architecture changes; work failing review twice; anything blocking | everything except routine tasks | 2 | important |
| **3 Delegated** | milestones, repeated failures, budget risk | merges, milestones, client milestones, budget | 3 | urgent |
| **4 Autonomous** | only critical things | client milestones, budget | 3 | critical |

## Always escalated

Whatever the level, these always reach you: **security**, **data loss**, **client milestone**, **budget overrun**, and **blocked with no way forward**. And whatever the level, **you have the final say**.

## FYI escalations

An escalation that your level wouldn't stop for becomes an **FYI**. It is kept and shown on the Command Center with **✓ Noted**, but makes no toast or desktop alert. Critical ones are never FYI.

## What changing the level does

- Every hired member's Playbook is rewritten for the new level, and the ones at work are told.
- Default **gates** of skills change with the level. For example, benching a subagent is *ask* at level 1, *propose* at 2, *tell* at 3 and *FYI* at 4. See [Skills and gates](../automation/skills.md).
- The floor's **daily cost cap** is the one set for the new level. See [Models and costs](models-and-costs.md).
- At **3 Delegated** and **4 Autonomous**, a team member's finished turn no longer puts a **✅ Review** in Needs you, dings or sends a desktop notification: the team works on its own there, and what needs you comes as an escalation. Its card still shows it done. See [Quiet turns](../concepts/workers-and-worktrees.md#quiet-turns).

## Autonomy by pipeline stage

On a toolkit project you can let the stage pick the level: **Settings → Autonomy → By pipeline stage**, off by default. The floor works at the first level (2 Guided unless you pick another) while the pipeline analyses, specifies and designs, and at the second (3 Delegated) once the build plan's gate, Stage 4, has passed. The office reads the gate the way the [setup panel](../using-the-office/command-center.md) does (the verdicts gate-check wrote into `index.html`, or a confirmed Stage 4 decision) once a minute, and when the stage calls for another level it changes it exactly as if you had picked it: Playbooks rewritten, the Leads at work told, the cap for the new level applied, a line in the recent activity, and `roster.autonomy` in the audit log.

While it's on, the level buttons only show the level (the stage picks it), and the Team tab's chip reads **Autonomy 2 · by stage**. A project without a pipeline keeps the level you picked. Turn it off and the level is yours to pick again.

> [!TIP]
> Start a new project at **2 Guided**. Move to **3 Delegated** once the build plan is approved and the team's reviews look good on the [Workers](../using-the-office/workers.md) tab, or let [autonomy by pipeline stage](#autonomy-by-pipeline-stage) make that move for you.
