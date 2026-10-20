---
title: Autonomy levels
description: The four autonomy levels - what each one escalates to you, what needs your approval, and what always reaches you whatever the level.
weight: 2
---

The **autonomy level** decides how often the agents on a project need you. A new project's level is chosen in the **New project** flow's required autonomy step ([Create your first project](../get-started/first-project.md#autonomy-how-much-the-team-does-without-asking-you)): nothing is preselected there, 2 Guided is only recommended. Change it later per project in [Settings](../using-the-office/settings.md). A project made another way (an older caller of the setup API, a project set up by hand, or one from before the step) works at **2 Guided** unless changed, and keeps its settings.

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
- The project's **daily cost cap** is the one set for the new level. See [Models and costs](models-and-costs.md).
- At **3 Delegated** and **4 Autonomous**, a team member's finished turn no longer puts a **✅ Review** in Needs you, dings or sends a desktop notification: the team works on its own there, and what needs you comes as an escalation. Its card still shows it done. See [Quiet turns](../concepts/workers-and-worktrees.md#quiet-turns).

## How the level was set, and changing it

**⚙️ Settings › 👥 Team** says under the levels how the project's level was set: *2 Guided, chosen by Alex Lee on 20 Oct 2026* (in the New project flow; *(shared password)* when no account was signed in), *set by your organisation's policy, acknowledged by …*, *the default for a project created without the autonomy step (older caller)*, or, for a project from before the step, *No choice recorded … It keeps its settings.* The latest change since is added: *Changed from 2 Guided to 3 Delegated by Sam Okafor on 21 Oct 2026.*

Saving a new level asks first, in a window with ✕ and Esc that gives focus back to **Save settings**. It says what the change does:

- It applies to **new work**: the proposals the Leads make at the next standups, and escalations raised from now on.
- What already **waits for you keeps its status**: pending proposals, open escalations (with the alert level they were raised with) and pending subagent actions. Raising the level never approves them. Lowering it leaves what the team already decided on its own decided.
- At **4 Autonomous** the team's open pull requests stop being listed under Approvals (the office never blocked a merge; only branch protection on GitHub does).
- Every Lead at work gets its Playbook rewritten and is told the new level in a short message, as before (not while it is asking you something, nor past the daily cap; an asleep one reads its Playbook when it wakes).
- The change is recorded: `roster.autonomy` in the audit log with who, when and both levels.

**Organisation policy.** An admin can set an office-wide **Autonomy policy for new projects** under ⚙️ Settings › 👥 Team (off by default; audited as `settings.change`): limit the levels new projects may choose, or fix one level. The New project step honours it, and a later level change on Settings that leaves the policy is refused with the reason; a project's current level is never moved by it.

## Autonomy by pipeline stage

On a toolkit project you can let the stage pick the level: **⚙️ Settings › 👥 Team → Autonomy → By pipeline stage** (`/lite?tab=settings&section=team`), off by default. The project works at the first level (2 Guided unless you pick another) while the pipeline analyses, specifies and designs, and at the second (3 Delegated) once the build plan's gate, Stage 4, has passed. The office reads the gate the way the [setup panel](../using-the-office/command-center.md) does (the verdicts gate-check wrote into `index.html`, or a confirmed Stage 4 decision) once a minute, and when the stage calls for another level it changes it exactly as if you had picked it: Playbooks rewritten, the Leads at work told, the cap for the new level applied, a line in the recent activity, and `roster.autonomy` in the audit log.

While it's on, the level buttons only show the level (the stage picks it), and the Team tab's chip reads **Autonomy 2 · by stage**. A project without a pipeline keeps the level you picked. Turn it off and the level is yours to pick again.

On a project whose level was chosen in the New project step, autonomy by stage is on only if you ticked *Let the level rise to 3 Delegated once the build plan is approved* there (or turn it on here): the [budget level](../using-the-office/budget.md#budget-levels) never turns it on or off. On a project from before the step, Lean and Fast still turn it on, as they always did.

> [!TIP]
> **2 Guided** is the level recommended for a new project (a badge in the New project step, never a preselection). Move to **3 Delegated** once the build plan is approved and the team's reviews look good on the [Workers](../using-the-office/workers.md) tab, or let [autonomy by pipeline stage](#autonomy-by-pipeline-stage) make that move for you.
